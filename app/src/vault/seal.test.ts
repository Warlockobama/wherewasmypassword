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
vi.mock('../storage/db.ts', () => ({
  saveVault: async (record: StoredVault) => {
    if (saveFails) throw new Error('storage quota exceeded')
    saved.push(record)
  },
}))

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
  saveFails = false
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
    const { rawKey, stored } = await rekeyVault(PHRASE, data, oldVault.createdAt)
    expect(stored.kdfParams).toEqual(DEFAULT_KDF_PARAMS)
    expect(stored.salt).not.toBe(oldVault.salt)
    expect(stored.version).toBe(2)
    expect(await readBack(stored, rawKey)).toEqual(data)
  }, 30_000)

  it('gives an unrelated key even for the very same phrase', async () => {
    // The salt is what makes this true, and it is why "change your passphrase"
    // and "raise the settings" can be one code path without the second one
    // quietly being a no-op.
    const a = await rekeyVault(PHRASE, data, oldVault.createdAt)
    const b = await rekeyVault(PHRASE, data, oldVault.createdAt)
    expect(a.stored.salt).not.toBe(b.stored.salt)
    expect(Array.from(a.rawKey)).not.toEqual(Array.from(b.rawKey))
  }, 60_000)
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
    return {
      rawKey,
      stored: { ...oldVault, iv: toBase64(iv), ciphertext: toBase64(ciphertext) },
    }
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
    const rawKey = new Uint8Array(32).fill(5)
    const brought = await upgradeOnUnlock(PHRASE, rawKey, data, current)
    expect(brought.upgraded).toBe('format')
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
    const rawKey = new Uint8Array(32).fill(5)
    const brought = await upgradeOnUnlock(PHRASE, rawKey, data, current)
    expect(brought.upgraded).toBe('none')
    expect(brought.rawKey).toBe(rawKey)
    expect(brought.stored).toBe(current)
    // And the key they are carrying on with is still usable, not zeroed by a
    // half-finished re-key.
    expect(Array.from(rawKey)).not.toEqual(Array(32).fill(0))
  })
})
