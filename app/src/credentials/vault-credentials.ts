import type { Credential } from './types.ts'
import { newCredentialId } from './credential-id.ts'
import type { VaultData } from '../crypto/vault.ts'
import { sealVault } from '../vault/seal.ts'
import type { StoredVault } from '../storage/db.ts'

/** Fields the caller supplies when adding a new credential. */
export type NewCredential = Omit<Credential, 'id' | 'createdAt' | 'updatedAt'>

/** Fields the caller supplies when editing — id is required, rest optional. */
export type CredentialPatch = Partial<NewCredential> & { id: string }

/**
 * Re-encrypt the vault and persist it to IndexedDB.
 * Returns the updated StoredVault for callers that track it in state.
 *
 * The key and salt are unchanged — only the contents moved — but the record is
 * rewritten in the current format, so a vault still on an old one is upgraded
 * by the first credential the user saves.
 */
function persistVault(rawKey: Uint8Array, data: VaultData, stored: StoredVault): Promise<StoredVault> {
  return sealVault(
    rawKey,
    data,
    { salt: stored.salt, kdfParams: stored.kdfParams, createdAt: stored.createdAt },
    // This write keeps the existing key, so it must not land on a vault that
    // has since been re-keyed elsewhere — that would put the retired key back.
    stored,
  )
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
