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

/**
 * Practice metadata, stored in plaintext beside the ciphertext.
 *
 * It deliberately holds a count and a single date rather than the list of
 * unlock timestamps it used to. The list revealed nothing about the passphrase,
 * but it was a millisecond-resolution activity timeline — sleep schedule,
 * working hours, travel, absences — readable by anyone with the profile
 * directory, and it grew forever. The practice schedule only ever consulted the
 * length and the maximum, so these two fields serve it identically.
 */
export interface PracticeMeta {
  createdAt: number
  practiceCount: number
  /** null until the first practice unlock. */
  lastPracticedAt: number | null
}

/** The pre-privacy-fix shape, kept only so old records can be migrated. */
interface LegacyPracticeMeta {
  createdAt: number
  practicedAt?: number[]
}

/** A brand-new practice record for a vault created (or restored) at `createdAt`. */
export function freshPracticeMeta(createdAt: number): PracticeMeta {
  return { createdAt, practiceCount: 0, lastPracticedAt: null }
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
  const database = await db()
  const stored = await database.get('meta', META_KEY)
  if (!stored) return undefined
  const migrated = migratePracticeMeta(stored)
  // Rewrite immediately when the shape changed: the point of the fix is that
  // the old timeline stops being on disk, not that we stop reading it.
  if (migrated !== stored) await database.put('meta', migrated, META_KEY)
  return migrated
}

/**
 * Collapse a legacy timestamp list down to a count and a last date. The
 * timeline is discarded on the next save, which is the point: the fix is only
 * worth anything if existing records stop carrying it too.
 */
export function migratePracticeMeta(stored: PracticeMeta | LegacyPracticeMeta): PracticeMeta {
  if ('practiceCount' in stored && typeof stored.practiceCount === 'number') {
    return stored
  }
  const legacy = (stored as LegacyPracticeMeta).practicedAt ?? []
  return {
    createdAt: stored.createdAt,
    practiceCount: legacy.length,
    lastPracticedAt: legacy.length ? legacy.reduce((a, b) => Math.max(a, b)) : null,
  }
}

/** Ask the browser not to evict our storage under pressure. */
export async function requestPersistence(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return navigator.storage.persist()
  }
  return false
}
