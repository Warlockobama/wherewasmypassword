import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptVault, fromBase64, type VaultData } from '../crypto/vault.ts'
import type { StoredVault } from '../storage/db.ts'

// The persistence path is the only place the vault is re-encrypted after
// creation, and it had no coverage at all. IndexedDB does not exist under the
// node test environment, so the save is captured here instead — which also
// lets each test read back exactly what would have hit disk.
const saved: StoredVault[] = []
vi.mock('../storage/db.ts', () => ({
  saveVault: async (record: StoredVault) => {
    saved.push(record)
  },
}))

const { addCredential, editCredential, deleteCredential } = await import('./vault-credentials.ts')

const key = new Uint8Array(32).fill(4)

const baseData: VaultData = {
  version: 1,
  words: ['abacus', 'zebra', 'lantern', 'kettle', 'harbour', 'violin'],
  associations: [],
  createdAt: 1700000000000,
  entries: [],
}

const baseStored: StoredVault = {
  version: 1,
  salt: 'c2FsdA==',
  kdfParams: { algorithm: 'argon2id', memoryKiB: 8 * 1024, iterations: 2, parallelism: 1 },
  iv: 'aXY=',
  ciphertext: 'Y3Q=',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

const readBack = (record: StoredVault) =>
  decryptVault(key, { iv: fromBase64(record.iv), ciphertext: fromBase64(record.ciphertext) })

const fields = {
  label: 'Example',
  url: 'https://example.com',
  username: 'me',
  password: 's3cret',
  notes: '',
}

beforeEach(() => {
  saved.length = 0
})

describe('credential persistence', () => {
  it('adds a credential and writes it back encrypted', async () => {
    const [data, stored] = await addCredential(key, baseData, baseStored, fields)
    expect(data.entries).toHaveLength(1)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toBe(stored)

    const roundTripped = await readBack(stored)
    expect(roundTripped.entries[0].label).toBe('Example')
    expect(roundTripped.entries[0].password).toBe('s3cret')
    // The master phrase rides along in the same ciphertext, untouched.
    expect(roundTripped.words).toEqual(baseData.words)
  })

  it('carries the salt and KDF parameters through unchanged', async () => {
    // A save that regenerated the salt would silently make the vault
    // unopenable with the passphrase that created it.
    const [, stored] = await addCredential(key, baseData, baseStored, fields)
    expect(stored.salt).toBe(baseStored.salt)
    expect(stored.kdfParams).toEqual(baseStored.kdfParams)
    expect(stored.createdAt).toBe(baseStored.createdAt)
  })

  it('uses a fresh IV on every save', async () => {
    // Reusing a nonce under one AES-GCM key is catastrophic, and every
    // credential edit is another encryption under the same key.
    let data = baseData
    let stored = baseStored
    for (let i = 0; i < 5; i++) {
      ;[data, stored] = await addCredential(key, data, stored, { ...fields, label: `Example ${i}` })
    }
    const ivs = new Set(saved.map((s) => s.iv))
    expect(ivs.size).toBe(saved.length)
    // And the ciphertext really did change, not just the header.
    expect(new Set(saved.map((s) => s.ciphertext)).size).toBe(saved.length)
  })

  it('edits by id without letting a patch rewrite identity or creation time', async () => {
    const [added, storedAfterAdd] = await addCredential(key, baseData, baseStored, fields)
    const original = added.entries[0]
    const hostilePatch = {
      id: original.id,
      password: 'rotated',
      // Not part of CredentialPatch, but nothing stops it arriving at runtime.
      createdAt: 0,
    } as { id: string; password: string }

    const [edited] = await editCredential(key, added, storedAfterAdd, hostilePatch)
    expect(edited.entries[0].password).toBe('rotated')
    expect(edited.entries[0].id).toBe(original.id)
    expect(edited.entries[0].createdAt).toBe(original.createdAt)
    expect(edited.entries[0].updatedAt).toBeGreaterThanOrEqual(original.updatedAt)
  })

  it('leaves other credentials alone when editing or deleting one', async () => {
    let [data, stored] = await addCredential(key, baseData, baseStored, { ...fields, label: 'One' })
    ;[data, stored] = await addCredential(key, data, stored, { ...fields, label: 'Two' })
    const [first, second] = data.entries

    const [afterEdit, storedAfterEdit] = await editCredential(key, data, stored, {
      id: first.id,
      label: 'One edited',
    })
    expect(afterEdit.entries[1]).toEqual(second)

    const [afterDelete, storedAfterDelete] = await deleteCredential(
      key,
      afterEdit,
      storedAfterEdit,
      first.id,
    )
    expect(afterDelete.entries).toHaveLength(1)
    expect(afterDelete.entries[0].id).toBe(second.id)

    const roundTripped = await readBack(storedAfterDelete)
    expect(roundTripped.entries).toHaveLength(1)
    expect(roundTripped.entries[0].label).toBe('Two')
  })

  it('deleting an unknown id is a no-op that still re-encrypts', async () => {
    const [data, stored] = await addCredential(key, baseData, baseStored, fields)
    const [after, storedAfter] = await deleteCredential(key, data, stored, 'no-such-id')
    expect(after.entries).toHaveLength(1)
    expect(storedAfter.iv).not.toBe(stored.iv)
  })
})
