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
 * The undo offer is the only vault-altering control on a locked device, so
 * `decisions/0018` put the archived vault's own passphrase in front of it. What
 * is worth pinning is the negative: a phrase that does not open the vault being
 * put back leaves *both* records exactly where they were — including the phrase
 * of the vault that is live, which is the one an attacker at a locked machine
 * is least likely to have and a curious housemate most likely to.
 *
 * Real Argon2id and real AES-GCM, on deliberately cheap KDF settings: the gate
 * is a decryption, so a stubbed one would test nothing.
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

const { archiveCurrentVault, loadArchivedVault, loadVault, saveVault } = await import(
  '../storage/db.ts'
)
const { undoRestoreWithPassphrase } = await import('./undo.ts')

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

/** The vault this device had, and the one a restore put in its place. */
let mine: StoredVault
let theirs: StoredVault

beforeEach(async () => {
  store.clear()
  mine = await sealed(MINE, 'mine', t0)
  theirs = await sealed(THEIRS, 'theirs', t0 + 1000)
  // What a restore leaves behind: the outgoing vault set aside, the new one live.
  await saveVault(mine)
  await archiveCurrentVault()
  await saveVault(theirs)
})

describe('putting the previous vault back', () => {
  it('swaps the records for the phrase that opens the one set aside', async () => {
    expect(await undoRestoreWithPassphrase(MINE, mine)).toEqual(mine)

    expect(await loadVault()).toEqual(mine)
    expect(await loadArchivedVault()).toEqual(theirs)
  })

  it('leaves both records exactly where they were for a wrong phrase', async () => {
    await expect(undoRestoreWithPassphrase('not the phrase', mine)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    )

    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toEqual(mine)
  })

  it('is not opened by the phrase of the vault that is live', async () => {
    // The restore that needs undoing is usually someone else's backup, and its
    // phrase is the one thing whoever performed the restore does have. It must
    // not be a key to the vault they displaced.
    await expect(undoRestoreWithPassphrase(THEIRS, mine)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    )

    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toEqual(mine)
  })

  it('refuses key-derivation settings it will not run, without touching anything', async () => {
    // The archived record is as rewritable as the live one by anyone with the
    // profile directory, and `memoryKiB: 2 GiB` would wedge the browser on a
    // press. The guard is in `deriveKey`; what matters here is that failing it
    // stops before the swap.
    const absurd = { ...mine, kdfParams: { ...TEST_KDF, memoryKiB: 2 * 1024 * 1024 } }

    await expect(undoRestoreWithPassphrase(MINE, absurd)).rejects.toThrow()

    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toEqual(mine)
  })

  it('changes nothing when another context already took the archive', async () => {
    store.get('vault')?.delete('previous')

    expect(await undoRestoreWithPassphrase(MINE, mine)).toBeUndefined()

    expect(await loadVault()).toEqual(theirs)
  })

  it('puts back the vault it authenticated, not whatever is in the slot by then', async () => {
    // The derive in front of this takes about a second, and a restore in
    // another copy of the UI replaces the archive slot. Proving one vault and
    // swapping in a different one would be this gate answering the wrong
    // question — which is the whole of what it is for.
    const somebodyElses = await sealed('third phrase entirely', 'theirs-too', t0 + 2000)
    store.get('vault')?.set('previous', somebodyElses)

    expect(await undoRestoreWithPassphrase(MINE, mine)).toBeUndefined()

    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toEqual(somebodyElses)
  })
})
