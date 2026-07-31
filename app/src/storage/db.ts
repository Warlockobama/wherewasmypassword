import { openDB, type DBSchema } from 'idb'
import type { KdfParams } from '../crypto/kdf.ts'
import type { VaultFormatVersion } from '../crypto/vault.ts'

/** Everything in this record is safe to store in plaintext: ciphertext,
 *  salt, and KDF params reveal nothing without the passphrase. */
export interface StoredVault {
  /** On-disk format; see `VaultFormatVersion`. Old vaults are still readable. */
  version: VaultFormatVersion
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

export class VaultSupersededError extends Error {
  constructor() {
    super('This vault was re-encrypted somewhere else. Lock and unlock to continue.')
    this.name = 'VaultSupersededError'
  }
}

/**
 * Write the vault record.
 *
 * When `expecting` is given, the write is refused if the salt on disk is no
 * longer the one the caller derived its key from. That is the difference
 * between two contexts racing over the *contents* — last write wins, as it
 * always has — and one of them quietly reverting a change of *key*.
 *
 * The scenario it exists for: two copies of the UI are open, one changes the
 * master passphrase (or upgrades an old vault's KDF settings), and the other,
 * still holding the retired key and salt, saves a credential. The record it
 * would write is perfectly self-consistent, so it fails open rather than
 * closed — the vault silently goes back to opening with the phrase the user was
 * just told is dead. If they have let that phrase go, everything inside is lost.
 */
export async function saveVault(record: StoredVault, expecting?: StoredVault): Promise<void> {
  const database = await db()
  const tx = database.transaction('vault', 'readwrite')
  if (expecting) {
    const current = await tx.store.get(VAULT_KEY)
    // Compared inside the transaction, so nothing can land between the read
    // and the write. A different salt means a different key.
    if (current && current.salt !== expecting.salt) {
      tx.abort()
      throw new VaultSupersededError()
    }
  }
  await tx.store.put(record, VAULT_KEY)
  await tx.done
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

/**
 * Drop the archived copy.
 *
 * Changing the master passphrase is the one operation where keeping it would
 * defeat the point: the archive is still encrypted under the *old* phrase, so
 * leaving it on disk after a phrase has been burned hands an attacker with the
 * profile directory exactly the vault the user was trying to retire.
 */
export async function deleteArchivedVault(): Promise<void> {
  await (await db()).delete('vault', PREVIOUS_VAULT_KEY)
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
 * Collapse a legacy timestamp list down to a count and a last date, returning
 * the record unchanged if it has already been collapsed. The caller rewrites
 * the store when it changes, so the timeline leaves disk on the next load
 * rather than lingering until the next practice unlock.
 */
export function migratePracticeMeta(stored: PracticeMeta | LegacyPracticeMeta): PracticeMeta {
  if (
    'practiceCount' in stored &&
    typeof stored.practiceCount === 'number' &&
    (stored.lastPracticedAt === null || typeof stored.lastPracticedAt === 'number')
  ) {
    return stored
  }
  const legacy = (stored as LegacyPracticeMeta).practicedAt ?? []
  const partial = stored as Partial<PracticeMeta>
  return {
    createdAt: typeof stored.createdAt === 'number' ? stored.createdAt : Date.now(),
    practiceCount: legacy.length || (typeof partial.practiceCount === 'number' ? partial.practiceCount : 0),
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
