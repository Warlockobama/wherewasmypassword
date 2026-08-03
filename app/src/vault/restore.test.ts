import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveKey, type KdfParams } from '../crypto/kdf.ts'
import { randomBytes } from '../crypto/random.ts'
import {
  VAULT_FORMAT_VERSION,
  WrongPassphraseError,
  encryptVault,
  toBase64,
  type VaultData,
} from '../crypto/vault.ts'
import type { StoredVault } from '../storage/db.ts'

/**
 * The gate in front of "Restore from a backup file instead" (`decisions/0019`).
 *
 * Before it, that button sat on a locked screen, asked for nothing, and wrote
 * the vault record — and pressing it twice consumed the single archive slot, so
 * the vault the device started with left disk without a passphrase being typed
 * at any point. James's ruling was both proofs, configurable: the incoming
 * backup's phrase says the file is one you can open, the live vault's says the
 * vault being pushed aside is yours to push.
 *
 * What is worth pinning is mostly the negatives — that a refusal leaves *both*
 * records exactly where they were, that the proofs are not interchangeable, and
 * that a preference nobody can read still refuses. Real Argon2id and real
 * AES-GCM on deliberately cheap settings, as in `undo.test.ts`: the gate is a
 * decryption, so a stubbed one would test nothing.
 */

const store = new Map<string, Map<string, unknown>>()

function objectStore(name: string) {
  return {
    get: async (key: string) => store.get(name)?.get(key),
    put: async (value: unknown, key: string) => {
      if (!store.has(name)) store.set(name, new Map())
      store.get(name)!.set(key, value)
    },
    delete: async (key: string) => {
      store.get(name)?.delete(key)
    },
  }
}

vi.mock('idb', () => ({
  openDB: async () => ({
    get: async (name: string, key: string) => store.get(name)?.get(key),
    put: async (name: string, value: unknown, key: string) => {
      if (!store.has(name)) store.set(name, new Map())
      store.get(name)!.set(key, value)
    },
    delete: async (name: string, key: string) => {
      store.get(name)?.delete(key)
    },
    transaction: (name: string | string[]) => ({
      store: objectStore(Array.isArray(name) ? name[0] : name),
      objectStore,
      done: Promise.resolve(),
    }),
  }),
}))

const { loadArchivedVault, loadVault, saveVault, saveVaultSettings, VaultSupersededError } =
  await import('../storage/db.ts')
const {
  awaitingProof,
  NO_PROOFS,
  proveNextForRestore,
  requiredProofs,
  RestoreGateError,
  restoreVaultWithProof,
} = await import('./restore.ts')

const t0 = 1700000000000

/** Cheap enough to run a dozen times in a suite; the algorithm is the real one. */
const TEST_KDF: KdfParams = {
  algorithm: 'argon2id',
  memoryKiB: 8 * 1024,
  iterations: 1,
  parallelism: 1,
}

/** A genuinely encrypted vault record: only a real phrase opens it. */
async function sealed(passphrase: string, word: string, updatedAt: number): Promise<StoredVault> {
  const salt = randomBytes(16)
  const rawKey = await deriveKey(passphrase, salt, TEST_KDF)
  const data: VaultData = {
    version: 1,
    words: [word],
    associations: [],
    createdAt: t0,
    entries: [],
  }
  const header = { salt: toBase64(salt), kdfParams: TEST_KDF }
  const blob = await encryptVault(rawKey, data, header)
  return {
    version: VAULT_FORMAT_VERSION,
    salt: header.salt,
    kdfParams: TEST_KDF,
    iv: toBase64(blob.iv),
    ciphertext: toBase64(blob.ciphertext),
    createdAt: t0,
    updatedAt,
  }
}

const MINE = 'mailbox zeppelin thicket'
const THEIRS = 'anvil marmalade lantern'

/** The vault on this device, and the backup file someone wants to restore. */
let mine: StoredVault
let theirs: StoredVault

beforeEach(async () => {
  store.clear()
  mine = await sealed(MINE, 'mine', t0)
  theirs = await sealed(THEIRS, 'theirs', t0 + 1000)
  await saveVault(mine)
})

const BOTH = { incoming: true, live: true }

/** One turn of the lock screen's field: type a phrase, get back what is proven. */
const answer = (passphrase: string, incoming: StoredVault, live: StoredVault, proofs = NO_PROOFS) =>
  proveNextForRestore(passphrase, incoming, live, BOTH, proofs)

describe('what a restore has to prove', () => {
  it('asks for both passphrases by default', () => {
    expect(requiredProofs('both', true)).toEqual({ incoming: true, live: true })
  })

  it('asks for nothing when there is no vault to replace', () => {
    // Both proofs exist to protect a vault that is on this device. On a browser
    // with none, a restore displaces nobody — and the first-run screen would
    // otherwise spend an Argon2id derive immediately before the unlock that
    // derives the same key from the same words.
    for (const gate of ['both', 'incoming', 'off'] as const) {
      expect(requiredProofs(gate, false)).toEqual({ incoming: false, live: false })
    }
  })

  it('names the outstanding proof in the order the screen asks for them', () => {
    expect(awaitingProof(BOTH, NO_PROOFS)).toBe('incoming')
    expect(awaitingProof(BOTH, { incoming: theirs, live: null })).toBe('live')
    expect(awaitingProof(BOTH, { incoming: theirs, live: mine })).toBeNull()
    // A live proof alone does not let the backup through: the file still has to
    // be one that opens, which is the half that stops a wrong file replacing a
    // good vault with something nobody can ever read.
    expect(awaitingProof(BOTH, { incoming: null, live: mine })).toBe('incoming')
  })

  it('does not hand out a proof it was not given the phrase for', () => {
    // `NO_PROOFS` is handed straight into React state and into the commit. If
    // anything ever mutated it, every restore in the process would start out
    // half-authorised.
    expect(Object.isFrozen(NO_PROOFS)).toBe(true)
    expect(NO_PROOFS).toEqual({ incoming: null, live: null })
  })
})

/**
 * The sequencing the lock screen's passphrase field drives. It used to live
 * inline in the component, where no test could reach it — which is where a
 * regression in a two-step gate would actually land.
 */
describe('answering the gate one phrase at a time', () => {
  it('takes the backup’s phrase first, and asks for the live one next', async () => {
    const first = await answer(THEIRS, theirs, mine)

    expect(first).toEqual({ incoming: theirs, live: null })
    expect(awaitingProof(BOTH, first)).toBe('live')

    const second = await answer(MINE, theirs, mine, first)

    expect(second).toEqual({ incoming: theirs, live: mine })
    expect(awaitingProof(BOTH, second)).toBeNull()
  })

  it('settles both halves at once when one phrase opens both', async () => {
    // Restoring your own newer export: the phrase that opened the file is tried
    // against the live vault before a second field is put in front of anyone.
    const ownBackup = await sealed(MINE, 'mine-yesterday', t0 - 1000)

    expect(await answer(MINE, ownBackup, mine)).toEqual({ incoming: ownBackup, live: mine })
  })

  it('refuses a phrase that opens neither, proving nothing', async () => {
    await expect(answer('not either phrase', theirs, mine)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    )
  })

  it('refuses the live vault’s phrase while the backup is what is being asked for', async () => {
    // The order matters: an attacker's own file plus this device's phrase is
    // not a combination that should get anywhere, and neither is the reverse.
    await expect(answer(MINE, theirs, mine)).rejects.toBeInstanceOf(WrongPassphraseError)
  })

  it('refuses the backup’s phrase when the live vault is what is being asked for', async () => {
    const first = await answer(THEIRS, theirs, mine)

    await expect(answer(THEIRS, theirs, mine, first)).rejects.toBeInstanceOf(WrongPassphraseError)
  })

  it('surfaces a live vault it cannot even attempt, rather than asking again', async () => {
    // The opportunistic second try swallows a wrong phrase and nothing else.
    // Key-derivation parameters this browser will not run are a real failure of
    // the live record, and turning that into "type it again" would leave the
    // user retyping a correct phrase forever.
    const absurd = { ...mine, kdfParams: { ...TEST_KDF, memoryKiB: 2 * 1024 * 1024 } }

    await expect(answer(THEIRS, theirs, absurd)).rejects.toThrow(
      /unsupported key-derivation settings/,
    )
  })

  it('does nothing when the gate is already satisfied', async () => {
    const done = { incoming: theirs, live: mine }

    expect(await proveNextForRestore('anything', theirs, mine, BOTH, done)).toBe(done)
  })

  it('does not go looking for the live vault when only the backup is wanted', async () => {
    const only = { incoming: true, live: false }

    expect(await proveNextForRestore(THEIRS, theirs, mine, only, NO_PROOFS)).toEqual({
      incoming: theirs,
      live: null,
    })
  })
})

describe('restoring a backup over the vault on this device', () => {
  it('goes through when both phrases have been proven', async () => {
    let proofs = await answer(THEIRS, theirs, mine)
    proofs = await answer(MINE, theirs, mine, proofs)

    await restoreVaultWithProof(theirs, proofs)

    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toEqual(mine)
  })

  it('takes one phrase for both when one phrase opens both', async () => {
    const ownBackup = await sealed(MINE, 'mine-yesterday', t0 - 1000)

    await restoreVaultWithProof(ownBackup, await answer(MINE, ownBackup, mine))

    expect(await loadVault()).toEqual(ownBackup)
    expect(await loadArchivedVault()).toEqual(mine)
  })

  it('refuses, and changes nothing, with only the backup’s phrase', async () => {
    // The two-restore path `0019` is about: someone with their own backup file
    // at a locked machine. Under the old behaviour this went through twice and
    // took the archive slot with it.
    const proofs = await answer(THEIRS, theirs, mine)

    await expect(restoreVaultWithProof(theirs, proofs)).rejects.toBeInstanceOf(RestoreGateError)
    await expect(restoreVaultWithProof(theirs, proofs)).rejects.toMatchObject({ missing: 'live' })

    expect(await loadVault()).toEqual(mine)
    expect(await loadArchivedVault()).toBeUndefined()
  })

  it('refuses, and changes nothing, with only this device’s phrase', async () => {
    await expect(
      restoreVaultWithProof(theirs, { incoming: null, live: mine }),
    ).rejects.toMatchObject({ missing: 'incoming' })

    expect(await loadVault()).toEqual(mine)
  })

  it('refuses a press with nothing proven at all', async () => {
    await expect(restoreVaultWithProof(theirs, NO_PROOFS)).rejects.toMatchObject({
      missing: 'incoming',
    })

    expect(await loadVault()).toEqual(mine)
  })

  it('refuses to install a file other than the one that was proven', async () => {
    // A proof of one backup does not authorise writing another. The screen
    // holds one staged record and cannot reach this, which is exactly why the
    // rule is worth making structural rather than a property of one caller.
    const somebodyElses = await sealed('third phrase entirely', 'theirs-too', t0 + 2000)
    const proofs = { incoming: theirs, live: mine }

    await expect(restoreVaultWithProof(somebodyElses, proofs)).rejects.toMatchObject({
      missing: 'incoming',
    })

    expect(await loadVault()).toEqual(mine)
    expect(await loadArchivedVault()).toBeUndefined()
  })
})

describe('the gate the device is set to', () => {
  it('asks only for the backup’s phrase when set to that', async () => {
    await saveVaultSettings({ restoreGate: 'incoming' })

    await restoreVaultWithProof(theirs, { incoming: theirs, live: null })

    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toEqual(mine)
  })

  it('leaves the two-restore loss wide open when set to that, which is the cost', async () => {
    // The exact harm `0019` opened with, and the reason this is not the
    // default: two files of someone else's, two presses, and the vault this
    // device started with is gone from disk with no phrase of its owner's
    // typed. Pinned rather than described, because the README makes a claim
    // about it that has to stay true.
    await saveVaultSettings({ restoreGate: 'incoming' })
    const second = await sealed('their other phrase', 'theirs-too', t0 + 2000)

    await restoreVaultWithProof(theirs, { incoming: theirs, live: null })
    await restoreVaultWithProof(second, { incoming: second, live: null })

    expect(await loadVault()).toEqual(second)
    expect(await loadArchivedVault()).toEqual(theirs)
  })

  it('closes that path at the default, at the first press', async () => {
    await restoreVaultWithProof(theirs, { incoming: theirs, live: null }).catch(() => {})

    expect(await loadVault()).toEqual(mine)
    expect(await loadArchivedVault()).toBeUndefined()
  })

  it('still wants the backup’s phrase when set to that', async () => {
    await saveVaultSettings({ restoreGate: 'incoming' })

    await expect(restoreVaultWithProof(theirs, NO_PROOFS)).rejects.toMatchObject({
      missing: 'incoming',
    })

    expect(await loadVault()).toEqual(mine)
  })

  it('asks for nothing when turned off', async () => {
    await saveVaultSettings({ restoreGate: 'off' })

    await restoreVaultWithProof(theirs, NO_PROOFS)

    expect(await loadVault()).toEqual(theirs)
  })

  it('is read at the commit, not when the screen was drawn', async () => {
    // A gate raised in another tab has to apply to the restore that is midway
    // through being confirmed here, not to the next page load. This is the
    // reason `restoreVaultWithProof` reads the preference itself rather than
    // taking it from the caller.
    await saveVaultSettings({ restoreGate: 'off' })
    await saveVaultSettings({ restoreGate: 'both' })

    await expect(restoreVaultWithProof(theirs, NO_PROOFS)).rejects.toBeInstanceOf(RestoreGateError)

    expect(await loadVault()).toEqual(mine)
  })

  it('refuses when the preference cannot be read as anything', async () => {
    // Anyone who can write this record can write rubbish into it, and a
    // validator that failed open would make turning the gate off cheaper than
    // getting past it.
    store.set('meta', new Map([['settings', { restoreGate: 'nonsense' }]]))

    await expect(restoreVaultWithProof(theirs, NO_PROOFS)).rejects.toBeInstanceOf(RestoreGateError)

    expect(await loadVault()).toEqual(mine)
  })
})

describe('the vault being replaced changing underneath', () => {
  it('refuses when the live vault was re-keyed after the phrase was proven', async () => {
    // Proving a phrase takes about a second, and a passphrase change in another
    // tab inside it leaves a vault this proof says nothing about. Replacing it
    // anyway would be the gate answering a question nobody asked.
    const proofs = { incoming: theirs, live: mine }
    const reKeyed = await sealed('an entirely new phrase', 'mine', t0 + 5000)
    await saveVault(reKeyed)

    await expect(restoreVaultWithProof(theirs, proofs)).rejects.toBeInstanceOf(
      VaultSupersededError,
    )

    expect(await loadVault()).toEqual(reKeyed)
    expect(await loadArchivedVault()).toBeUndefined()
  })

  it('allows a vault whose contents changed but whose key did not', async () => {
    // Saving a credential in another tab rewrites the ciphertext of the same
    // vault under the same key. The phrase that was typed still opens it, so
    // refusing here would be pedantry that costs the user the restore.
    const proofs = { incoming: theirs, live: mine }
    const edited = { ...mine, ciphertext: btoa('one more credential'), updatedAt: t0 + 5000 }
    await saveVault(edited)

    await restoreVaultWithProof(theirs, proofs)

    expect(await loadVault()).toEqual(theirs)
    // The record set aside is the one that was actually there, not the stale
    // copy the caller proved against.
    expect(await loadArchivedVault()).toEqual(edited)
  })
})

describe('a browser with no vault yet', () => {
  it('restores without proving anything, whatever the gate says', async () => {
    // The welcome screen's "already have a backup? restore it". There is
    // nothing to displace, so there is nothing for a proof to protect.
    store.clear()

    await restoreVaultWithProof(theirs, NO_PROOFS)

    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toBeUndefined()
  })
})
