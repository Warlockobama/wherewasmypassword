import { openDB, type DBSchema } from 'idb'
import type { KdfParams } from '../crypto/kdf.ts'

/** Everything in this record is safe to store in plaintext: ciphertext,
 *  salt, and KDF params reveal nothing without the passphrase. */
export interface StoredVault {
  version: 1
  salt: string // base64
  kdfParams: KdfParams
  iv: string // base64
  ciphertext: string // base64
  createdAt: number
  updatedAt: number
}

/** Non-secret practice metadata — reveals nothing about the phrase. */
export interface PracticeMeta {
  createdAt: number
  practicedAt: number[]
}

interface WwmpDB extends DBSchema {
  vault: { key: string; value: StoredVault }
  meta: { key: string; value: PracticeMeta }
}

const DB_NAME = 'wherewasmypassword'
const VAULT_KEY = 'primary'
const PREVIOUS_VAULT_KEY = 'previous'
const META_KEY = 'practice'

function db() {
  return openDB<WwmpDB>(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore('vault')
      database.createObjectStore('meta')
    },
  })
}

export async function saveVault(record: StoredVault): Promise<void> {
  await (await db()).put('vault', record, VAULT_KEY)
}

/**
 * Copy the current vault aside before something overwrites it (a restore).
 * Restoring the wrong file would otherwise destroy the only copy, and the
 * archived record is still ciphertext — it is no more sensitive than the live
 * one, and it is the difference between a mistake and a permanent loss.
 */
export async function archiveCurrentVault(): Promise<void> {
  const database = await db()
  const current = await database.get('vault', VAULT_KEY)
  if (current) await database.put('vault', current, PREVIOUS_VAULT_KEY)
}

export async function loadArchivedVault(): Promise<StoredVault | undefined> {
  return (await db()).get('vault', PREVIOUS_VAULT_KEY)
}

export async function loadVault(): Promise<StoredVault | undefined> {
  return (await db()).get('vault', VAULT_KEY)
}

export async function deleteVault(): Promise<void> {
  const database = await db()
  await database.delete('vault', VAULT_KEY)
  await database.delete('vault', PREVIOUS_VAULT_KEY)
  await database.delete('meta', META_KEY)
}

export async function savePracticeMeta(meta: PracticeMeta): Promise<void> {
  await (await db()).put('meta', meta, META_KEY)
}

export async function loadPracticeMeta(): Promise<PracticeMeta | undefined> {
  return (await db()).get('meta', META_KEY)
}

/** Ask the browser not to evict our storage under pressure. */
export async function requestPersistence(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return navigator.storage.persist()
  }
  return false
}
