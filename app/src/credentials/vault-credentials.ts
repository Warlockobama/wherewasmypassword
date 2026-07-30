import type { Credential } from './types.ts'
import { newCredentialId } from './credential-id.ts'
import { encryptVault, toBase64, type VaultData } from '../crypto/vault.ts'
import { saveVault, type StoredVault } from '../storage/db.ts'

/** Fields the caller supplies when adding a new credential. */
export type NewCredential = Omit<Credential, 'id' | 'createdAt' | 'updatedAt'>

/** Fields the caller supplies when editing — id is required, rest optional. */
export type CredentialPatch = Partial<NewCredential> & { id: string }

/**
 * Re-encrypt the vault and persist it to IndexedDB.
 * Returns the updated StoredVault for callers that track it in state.
 */
async function persistVault(rawKey: Uint8Array, data: VaultData, stored: StoredVault): Promise<StoredVault> {
  const blob = await encryptVault(rawKey, data)
  const next: StoredVault = {
    ...stored,
    iv: toBase64(blob.iv),
    ciphertext: toBase64(blob.ciphertext),
    updatedAt: Date.now(),
  }
  await saveVault(next)
  return next
}

/** Add a credential, re-encrypt, and persist. Returns updated [data, stored]. */
export async function addCredential(
  rawKey: Uint8Array,
  data: VaultData,
  stored: StoredVault,
  fields: NewCredential,
): Promise<[VaultData, StoredVault]> {
  const now = Date.now()
  const cred: Credential = {
    ...fields,
    id: newCredentialId(),
    createdAt: now,
    updatedAt: now,
  }
  const nextData: VaultData = { ...data, entries: [...data.entries, cred] }
  const nextStored = await persistVault(rawKey, nextData, stored)
  return [nextData, nextStored]
}

/** Edit a credential by id, re-encrypt, and persist. */
export async function editCredential(
  rawKey: Uint8Array,
  data: VaultData,
  stored: StoredVault,
  patch: CredentialPatch,
): Promise<[VaultData, StoredVault]> {
  // Only the editable fields are copied across. Spreading the whole patch let
  // anything that happened to be on it — `id`, `createdAt` — overwrite the
  // credential's identity, which the type discouraged but did not prevent.
  const entries = data.entries.map((c) => {
    if (c.id !== patch.id) return c
    const next: Credential = { ...c, updatedAt: Date.now() }
    if (patch.label !== undefined) next.label = patch.label
    if (patch.url !== undefined) next.url = patch.url
    if (patch.username !== undefined) next.username = patch.username
    if (patch.password !== undefined) next.password = patch.password
    if (patch.notes !== undefined) next.notes = patch.notes
    return next
  })
  const nextData: VaultData = { ...data, entries }
  const nextStored = await persistVault(rawKey, nextData, stored)
  return [nextData, nextStored]
}

/** Delete a credential by id, re-encrypt, and persist. */
export async function deleteCredential(
  rawKey: Uint8Array,
  data: VaultData,
  stored: StoredVault,
  credentialId: string,
): Promise<[VaultData, StoredVault]> {
  const entries = data.entries.filter((c) => c.id !== credentialId)
  const nextData: VaultData = { ...data, entries }
  const nextStored = await persistVault(rawKey, nextData, stored)
  return [nextData, nextStored]
}
