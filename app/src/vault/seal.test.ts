import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_KDF_PARAMS, deriveKey, type KdfParams } from '../crypto/kdf.ts'
import {
  decryptVault,
  fromBase64,
  toBase64,
  WrongPassphraseError,
  type VaultData,
} from '../crypto/vault.ts'
import type { StoredVault } from '../storage/db.ts'

// IndexedDB does not exist under the node test environment, so the writes are
// captured here — which also lets each test read back exactly what would have
// hit disk, header and all.
const saved: StoredVault[] = []
let saveFails = false
/** What another context has already left in the vault slot, for the guard to see. */
let onDisk: StoredVault | undefined
/** Every precondition asked for, in order, so a caller that asks for none shows up. */
const preconditions: (StoredVault | 'no-vault' | undefined)[] = []
class FakeAlreadyExists extends Error {}
class FakeSuperseded extends Error {}
vi.mock('../storage/db.ts', () => ({
  VaultAlreadyExistsError: FakeAlreadyExists,
  VaultSupersededError: FakeSuperseded,
  // The real check is transactional and lives in `storage/db.ts`, tested there.
  // What this stand-in is for is which callers ask for it, and with what
  // (`decisions/0020`) — so it refuses on the same terms.
  saveVault: async (record: StoredVault, expecting?: StoredVault | 'no-vault') => {
    if (saveFails) throw new Error('storage quota exceeded')
    preconditions.push(expecting)
    if (expecting === 'no-vault') {
      if (onDisk) throw new FakeAlreadyExists()
    } else if (expecting && (!onDisk || onDisk.salt !== expecting.salt)) {
      throw new FakeSuperseded()
    }
    saved.push(record)
    onDisk = record
  },
}))

/**
 * Real Argon2id, with the derived key kept where a test can look at it. The
 * create path can now fail *after* deriving, and a key for a vault that will
 * never exist must not be left sitting in the heap of a screen the user is
 * about to walk away from.
 *
 * `vi.hoisted` because this file imports the real module for its own use, so
 * the mock factory runs before an ordinary `const` on this line would exist.
 */
const derived = vi.hoisted(() => [] as Uint8Array[])
vi.mock('../crypto/kdf.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crypto/kdf.ts')>()
  return {
    ...actual,
    deriveKey: async (...args: Parameters<typeof actual.deriveKey>) => {
      const key = await actual.deriveKey(...args)
      derived.push(key)
      return key
    },
  }
})

const { sealVault, rekeyVault, upgradeNeeded, upgradeOnUnlock } = await import('./seal.ts')

/**
 * Argon2id at the shipped 256 MiB would make this suite take minutes. The
 * upgrade logic under test does not care what the numbers are, only how they
 * compare, so the "old vault" here is old in exactly the way a real one is:
 * weaker than `DEFAULT_KDF_PARAMS`.
 */
const WEAK_KDF: KdfParams = {
  algorithm: 'argon2id',
  memoryKiB: 8 * 1024,
  iterations: 2,
  parallelism: 1,
}

const PHRASE = 'abacus zebra lantern kettle harbour violin'

const data: VaultData = {
  version: 1,
  words: PHRASE.split(' '),
  associations: [{ locusId: 'mailbox', word: 'abacus', imagery: 'an abacus in the mailbox' }],
  createdAt: 1700000000000,
  entries: [
    {
      id: 'a',
      label: 'Bank',
      url: 'https://bank.example',
      username: 'me',
      password: 's3cret',
      notes: '',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    },
  ],
}

/** A vault as it was stored before decisions 0013 and 0014: format 1, weak KDF. */
const oldVault: StoredVault = {
  version: 1,
  salt: 'b2xkc2FsdG9sZHNhbHQ=',
  kdfParams: WEAK_KDF,
  iv: 'aXY=',
  ciphertext: 'Y3Q=',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

const readBack = (record: StoredVault, rawKey: Uint8Array) =>
  decryptVault(
    rawKey,
    { iv: fromBase64(record.iv), ciphertext: fromBase64(record.ciphertext) },
    record,
  )

beforeEach(() => {
  saved.length = 0
  derived.length = 0
  preconditions.length = 0
  saveFails = false
  onDisk = undefined
})

describe('what a vault needs bringing forward to', () => {
  it('asks for a re-key when the stored parameters are weaker than today’s', () => {
    expect(upgradeNeeded(oldVault)).toBe('rekey')
    expect(upgradeNeeded({ ...oldVault, version: 2 })).toBe('rekey')
  })

  it('asks only for a rewrite when the key is fine and the format is not', () => {
    expect(upgradeNeeded({ ...oldVault, kdfParams: DEFAULT_KDF_PARAMS })).toBe('format')
  })

  it('leaves a current vault alone', () => {
    expect(upgradeNeeded({ ...oldVault, version: 2, kdfParams: DEFAULT_KDF_PARAMS })).toBe('none')
  })

  it('leaves a vault stronger than the defaults alone rather than weakening it', () => {
    const strong = { ...DEFAULT_KDF_PARAMS, memoryKiB: 512 * 1024 }
    expect(upgradeNeeded({ ...oldVault, version: 2, kdfParams: strong })).toBe('none')
  })
})

describe('sealing', () => {
  it('writes the current format and binds the header it stores', async () => {
    const rawKey = new Uint8Array(32).fill(1)
    const record = await sealVault(rawKey, data, {
      salt: oldVault.salt,
      kdfParams: WEAK_KDF,
      createdAt: oldVault.createdAt,
    })
    expect(record.version).toBe(2)
    expect(saved).toEqual([record])
    expect(await readBack(record, rawKey)).toEqual(data)
  })

  it('keeps the vault’s birthday and moves only its modified time', async () => {
    const record = await sealVault(new Uint8Array(32).fill(1), data, {
      salt: oldVault.salt,
      kdfParams: WEAK_KDF,
      createdAt: oldVault.createdAt,
    })
    expect(record.createdAt).toBe(oldVault.createdAt)
    expect(record.updatedAt).toBeGreaterThanOrEqual(oldVault.updatedAt)
  })
})

describe('re-keying', () => {
  it('derives under a fresh salt at the current parameters, and opens', async () => {
    onDisk = oldVault
    const { rawKey, stored } = await rekeyVault(PHRASE, data, oldVault.createdAt, {
      replacing: oldVault,
    })
    expect(stored.kdfParams).toEqual(DEFAULT_KDF_PARAMS)
    expect(stored.salt).not.toBe(oldVault.salt)
    expect(stored.version).toBe(2)
    expect(await readBack(stored, rawKey)).toEqual(data)
  }, 30_000)

  it('gives an unrelated key even for the very same phrase', async () => {
    // The salt is what makes this true, and it is why "change your passphrase"
    // and "raise the settings" can be one code path without the second one
    // quietly being a no-op.
    onDisk = oldVault
    const a = await rekeyVault(PHRASE, data, oldVault.createdAt, { replacing: oldVault })
    const b = await rekeyVault(PHRASE, data, oldVault.createdAt, { replacing: a.stored })
    expect(a.stored.salt).not.toBe(b.stored.salt)
    expect(Array.from(a.rawKey)).not.toEqual(Array.from(b.rawKey))
  }, 60_000)
})

/**
 * Onboarding sealing a vault over one that is already there (`decisions/0020`).
 *
 * Two tabs of a fresh install, or two tabs after "Delete vault & start over":
 * the second to finish its memory house used to write its vault over the first
 * with an unconditional put. Not set aside — gone, with no archive and nothing
 * for the lock screen to offer back. `rekeyVault` is the door every re-key goes
 * through, and each of the three arrives with a brand-new salt — the one thing
 * `saveVault`'s ordinary check cannot judge — which is why it now has to say
 * what it is allowed to land on.
 */
describe('creating the first vault on a device', () => {
  it('refuses when this browser already has one, and writes nothing', async () => {
    onDisk = oldVault

    await expect(rekeyVault(PHRASE, data, Date.now(), 'create')).rejects.toBeInstanceOf(
      FakeAlreadyExists,
    )

    expect(saved).toHaveLength(0)
    // The point of the whole exercise: the vault that was there is the vault
    // that is there.
    expect(onDisk).toBe(oldVault)
  }, 60_000)

  it('wipes the key it derived for a vault that will never exist', async () => {
    // The derive happens before the write is refused, so a refusal that just
    // threw would leave a live vault key in the heap of a screen the user is
    // about to walk away from.
    onDisk = oldVault

    await expect(rekeyVault(PHRASE, data, Date.now(), 'create')).rejects.toBeInstanceOf(
      FakeAlreadyExists,
    )

    // `at(-1)`, not `[0]`: this test derives exactly once today, and the next
    // one added here should not have to know that.
    expect(Array.from(derived.at(-1)!)).toEqual(Array(32).fill(0))
  }, 60_000)

  it('seals the vault when the slot is empty', async () => {
    const { rawKey, stored } = await rekeyVault(PHRASE, data, oldVault.createdAt, 'create')

    expect(saved).toEqual([stored])
    expect(preconditions).toEqual(['no-vault'])
    expect(await readBack(stored, rawKey)).toEqual(data)
    // And the key the caller carries into the unlocked screen is a live one.
    expect(Array.from(rawKey)).not.toEqual(Array(32).fill(0))
  }, 60_000)

  it('a passphrase change still writes over the vault it named', async () => {
    // The other side of the same argument: a re-key that names the record it is
    // replacing must go through when that is still the record on disk, or the
    // guard would have broken the flow it has nothing to do with.
    onDisk = oldVault

    const { stored } = await rekeyVault(PHRASE, data, oldVault.createdAt, { replacing: oldVault })

    expect(saved).toEqual([stored])
    expect(preconditions).toEqual([oldVault])
    expect(onDisk).toBe(stored)
  }, 60_000)

  it('refuses a passphrase change onto a vault that was swapped underneath it', async () => {
    // The half the first cut of `0020` missed. `ChangePassphrase` walks the user
    // through placement and quizzes — minutes — holding the record it read at
    // the start, and another tab can delete that vault and create or restore
    // another inside that window. The unconditional write destroyed it with no
    // archive, which is the same harm one screen over.
    const somebodyElses = { ...oldVault, salt: 'YW5vdGhlci1zYWx0LWVudGlyZWx5' }
    onDisk = somebodyElses

    await expect(
      rekeyVault(PHRASE, data, oldVault.createdAt, { replacing: oldVault }),
    ).rejects.toBeInstanceOf(FakeSuperseded)

    expect(saved).toHaveLength(0)
    expect(onDisk).toBe(somebodyElses)
    // And the key for the vault that was never written does not linger.
    expect(Array.from(derived.at(-1)!)).toEqual(Array(32).fill(0))
  }, 60_000)

  it('forwards a record precondition from a caller that keeps its key', async () => {
    // Credential saves do not re-key; they seal under the existing header and
    // pass the record they read. Nothing else in this suite covers that the
    // precondition survives `sealVault` on its way to storage.
    onDisk = oldVault

    await sealVault(
      new Uint8Array(32).fill(1),
      data,
      { salt: oldVault.salt, kdfParams: WEAK_KDF, createdAt: oldVault.createdAt },
      oldVault,
    )

    expect(preconditions).toEqual([oldVault])
  })
})

describe('bringing a vault forward at unlock', () => {
  /** Build a genuine old record: format 1 bytes under a weakly derived key. */
  const buildOldVault = async (): Promise<{ stored: StoredVault; rawKey: Uint8Array }> => {
    const rawKey = await deriveKey(PHRASE, fromBase64(oldVault.salt), WEAK_KDF)
    const iv = new Uint8Array(12).fill(9)
    const subtle = await crypto.subtle.importKey('raw', rawKey as BufferSource, 'AES-GCM', false, [
      'encrypt',
    ])
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        subtle,
        new TextEncoder().encode(JSON.stringify(data)),
      ),
    )
    const stored = { ...oldVault, iv: toBase64(iv), ciphertext: toBase64(ciphertext) }
    // It is the vault on this device, so put it in the slot. Until the guard
    // reached this path the slot could stay empty and every upgrade still wrote
    // — which is exactly how an upgrade with the wrong precondition passed the
    // whole suite.
    onDisk = stored
    return { rawKey, stored }
  }

  it('re-keys an old vault in place, and the result opens with the same phrase', async () => {
    const { stored, rawKey } = await buildOldVault()
    // It opens as it stands — this is the "existing vaults still open" half.
    expect(await readBack(stored, rawKey)).toEqual(data)

    const brought = await upgradeOnUnlock(PHRASE, rawKey, data, stored)
    expect(brought.upgraded).toBe('rekey')
    expect(brought.stored.version).toBe(2)
    expect(brought.stored.kdfParams).toEqual(DEFAULT_KDF_PARAMS)
    expect(saved).toHaveLength(1)

    // And the upgraded record opens with the phrase the user still knows —
    // which is the whole promise, since they were never asked for a new one.
    const rederived = await deriveKey(PHRASE, fromBase64(brought.stored.salt), brought.stored.kdfParams)
    expect(await readBack(brought.stored, rederived)).toEqual(data)
  }, 60_000)

  it('does not restamp the vault: a re-key changes no contents', async () => {
    // The unlocked screen shows `updatedAt` as the vault's last change, so a
    // record the user does not recognise is the one signal that an old vault
    // was planted in place of theirs (`decisions/0016`). An old record is
    // exactly the kind this upgrade rewrites — stamping it now would print
    // today's date on precisely the vault that signal exists to catch.
    const { stored, rawKey } = await buildOldVault()

    const brought = await upgradeOnUnlock(PHRASE, rawKey, data, stored)

    expect(brought.upgraded).toBe('rekey')
    expect(brought.stored.updatedAt).toBe(stored.updatedAt)
  }, 60_000)

  it('wipes the superseded key rather than leaving it in the heap', async () => {
    const { stored, rawKey } = await buildOldVault()
    const brought = await upgradeOnUnlock(PHRASE, rawKey, data, stored)
    expect(Array.from(rawKey)).toEqual(Array(32).fill(0))
    expect(Array.from(brought.rawKey)).not.toEqual(Array(32).fill(0))
  }, 60_000)

  it('the old ciphertext no longer opens under the new header', async () => {
    const { stored, rawKey } = await buildOldVault()
    const brought = await upgradeOnUnlock(PHRASE, rawKey, data, stored)
    await expect(
      decryptVault(
        brought.rawKey,
        { iv: fromBase64(stored.iv), ciphertext: fromBase64(stored.ciphertext) },
        brought.stored,
      ),
    ).rejects.toBeInstanceOf(WrongPassphraseError)
  }, 60_000)

  it('rewrites the format without re-deriving when only the format is behind', async () => {
    const current = { ...oldVault, kdfParams: DEFAULT_KDF_PARAMS }
    onDisk = current
    const rawKey = new Uint8Array(32).fill(5)
    const brought = await upgradeOnUnlock(PHRASE, rawKey, data, current)
    expect(brought.upgraded).toBe('format')
    expect(preconditions).toEqual([current])
    // Same key, same salt: nothing was stretched, which is why this path can
    // afford to run on a vault that is only a format behind.
    expect(brought.rawKey).toBe(rawKey)
    expect(brought.stored.salt).toBe(current.salt)
    expect(brought.stored.version).toBe(2)
    expect(await readBack(brought.stored, rawKey)).toEqual(data)
  })

  it('does nothing at all to a current vault', async () => {
    const current = { ...oldVault, version: 2 as const, kdfParams: DEFAULT_KDF_PARAMS }
    const rawKey = new Uint8Array(32).fill(5)
    const brought = await upgradeOnUnlock(PHRASE, rawKey, data, current)
    expect(brought.upgraded).toBe('none')
    expect(brought.stored).toBe(current)
    expect(saved).toHaveLength(0)
  })

  it('a failed upgrade still lets the user in with the vault they opened', async () => {
    // The user typed the right phrase; a housekeeping step that cannot write is
    // no reason to bounce them off their own vault. It retries next unlock.
    saveFails = true
    const current = { ...oldVault, kdfParams: DEFAULT_KDF_PARAMS }
    onDisk = current
    const rawKey = new Uint8Array(32).fill(5)
    const brought = await upgradeOnUnlock(PHRASE, rawKey, data, current)
    expect(brought.upgraded).toBe('none')
    expect(brought.rawKey).toBe(rawKey)
    expect(brought.stored).toBe(current)
    // And the key they are carrying on with is still usable, not zeroed by a
    // half-finished re-key.
    expect(Array.from(rawKey)).not.toEqual(Array(32).fill(0))
  })

  it('a failed re-key hands back a key that still works, not a zeroed one', async () => {
    // The branch above takes the `format` path, which never re-derives. This one
    // reaches the re-key, where `rekeyVault` wipes the key it derived on any
    // failure — the key it must NOT wipe is the caller's, which is still open on
    // this session's vault.
    const { stored, rawKey } = await buildOldVault()
    saveFails = true

    const brought = await upgradeOnUnlock(PHRASE, rawKey, data, stored)

    expect(brought.upgraded).toBe('none')
    expect(brought.rawKey).toBe(rawKey)
    expect(await readBack(stored, brought.rawKey)).toEqual(data)
  }, 60_000)

  it('refuses to upgrade a vault that was replaced under the lock screen', async () => {
    // The lock screen holds the record it read when the page opened, and never
    // looks again. A tab left sitting there while another deletes the vault and
    // creates a new one would, on the next successful unlock, write the old
    // vault back over the new one — re-keyed, with no archive, nobody having
    // asked for any of it. Silence is the right outcome: the user typed a phrase
    // that opened the record this tab was holding, so let them in, and let the
    // superseded check refuse the write.
    const { stored, rawKey } = await buildOldVault()
    const somebodyElses = { ...oldVault, salt: 'YW5vdGhlci1zYWx0LWVudGlyZWx5' }
    onDisk = somebodyElses

    const brought = await upgradeOnUnlock(PHRASE, rawKey, data, stored)

    expect(brought.upgraded).toBe('none')
    expect(saved).toHaveLength(0)
    expect(onDisk).toBe(somebodyElses)
  }, 60_000)

  it('refuses a format rewrite onto a vault that was replaced under it', async () => {
    // Same window, the cheaper branch: no re-derive, but the same stale record
    // and the same unconditional write before this.
    const current = { ...oldVault, kdfParams: DEFAULT_KDF_PARAMS }
    const somebodyElses = { ...current, salt: 'YW5vdGhlci1zYWx0LWVudGlyZWx5' }
    onDisk = somebodyElses

    const brought = await upgradeOnUnlock(PHRASE, new Uint8Array(32).fill(5), data, current)

    expect(brought.upgraded).toBe('none')
    expect(saved).toHaveLength(0)
    expect(onDisk).toBe(somebodyElses)
  })
})
