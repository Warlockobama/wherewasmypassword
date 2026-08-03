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
 * Replace the live vault with `incoming`, setting the outgoing one aside.
 *
 * Restoring the wrong file would otherwise destroy the only copy, and the
 * archived record is still ciphertext — it is no more sensitive than the live
 * one, and it is the difference between a mistake and a permanent loss.
 *
 * One transaction, and that is the whole reason this function exists rather
 * than the archive-then-save pair it replaces. Between those two writes the
 * archive slot holds the vault that is *still live*, and `undoRestore` in
 * another tab can swap underneath: the undo puts the proven vault back, then
 * this restore's second write drops the new vault on top of it and the vault
 * whose passphrase was just proven is gone from disk with no other copy. The
 * gate in `vault/undo.ts` closed the read side of that second-wide window
 * (`decisions/0018`); this is the write side, and a gate the write side can
 * walk around is not a gate.
 */
export async function restoreVault(incoming: StoredVault): Promise<void> {
  const database = await db()
  const tx = database.transaction('vault', 'readwrite')
  const current = await tx.store.get(VAULT_KEY)
  if (current) await tx.store.put(current, PREVIOUS_VAULT_KEY)
  await tx.store.put(incoming, VAULT_KEY)
  await tx.done
}

export async function loadArchivedVault(): Promise<StoredVault | undefined> {
  return (await db()).get('vault', PREVIOUS_VAULT_KEY)
}

/**
 * Swap the vault set aside with the live one: the archived record becomes the
 * vault this device opens, and the record it displaces takes the archive slot.
 * Returns the record that is now live, or undefined if nothing was set aside.
 *
 * This is what makes the archive worth writing. Until `decisions/0016` nothing
 * ever read it back, so the restore dialog's promise that "the current vault is
 * kept aside" was true on disk and unreachable from the UI: one wrong file and
 * a vault with no other copy was gone.
 *
 * A swap rather than a one-way move, because the offer outlives the restore
 * that produced it. The archive survives until the next restore or a passphrase
 * change, so the button is still on the lock screen months later — by which
 * time the live vault holds credential edits that exist in no backup file.
 * Consuming the archive would make one curious press destroy them, which is the
 * same unrecoverable loss this decision exists to remove, pointed the other
 * way. Swapping means the worst a mistaken press can do is put the wrong vault
 * on screen, and pressing again puts it back.
 *
 * Both halves happen in one transaction, so there is no instant where either
 * record is missing — a crash in the middle of *that* would lose one of them.
 *
 * This is the storage half only. Nothing in the UI may call it directly: the
 * swap is offered on a locked device, so it goes through
 * `vault/undo.ts`, which proves the archived vault's passphrase first
 * (`decisions/0018`).
 */
export async function undoRestore(
  /**
   * The record the caller proved the passphrase of. The swap is refused if the
   * archive slot no longer holds it — a restore in another copy of the UI
   * replaces the slot, and the Argon2id derive in front of this is a second
   * wide. Authorising one vault and putting back a different one is exactly
   * what the gate in `vault/undo.ts` exists to prevent, so the check
   * belongs inside the transaction that does the swap.
   *
   * Required, not optional. It was optional for one commit, which meant the
   * "nothing in the UI may call this directly" above was a comment the compiler
   * would never enforce — a future caller writing `undoRestore()` would get the
   * ungated swap and a clean build. Now the only way to reach this is to hold a
   * record you have something to say about.
   */
  expecting: StoredVault,
): Promise<StoredVault | undefined> {
  const database = await db()
  const tx = database.transaction('vault', 'readwrite')
  const archived = await tx.store.get(PREVIOUS_VAULT_KEY)
  if (!archived || !sameRecord(archived, expecting)) {
    await tx.done
    return undefined
  }
  const live = await tx.store.get(VAULT_KEY)
  await tx.store.put(archived, VAULT_KEY)
  // The displaced vault takes the archive slot. With no live record to displace
  // the slot is cleared instead, so it can never be left pointing at the record
  // that is now live — which would offer to "put back" the vault already open.
  if (live) await tx.store.put(live, PREVIOUS_VAULT_KEY)
  else await tx.store.delete(PREVIOUS_VAULT_KEY)
  await tx.done
  return archived
}

/**
 * Whether two records are the same vault record, header and all.
 *
 * Ciphertext and IV alone would identify one write of one vault — the IV is
 * fresh random bytes every time — and that is all the first version compared.
 * The header is compared too because the caller's claim is "I opened this
 * record", and what it opened was the header as much as the body: the salt and
 * KDF parameters are the derive's inputs, and since `decisions/0014` the whole
 * header is bound into the ciphertext as additional data.
 *
 * The record it rules out: same ciphertext, same IV, `memoryKiB` rewritten to
 * something no browser will run. Anyone who can write the archive slot can
 * write that, the proof upstream would derive against the sane parameters held
 * in memory and succeed, and the swap would install the tampered header as the
 * live vault — leaving a vault that no passphrase can open, from a press whose
 * whole purpose was to prove one.
 */
function sameRecord(a: StoredVault, b: StoredVault): boolean {
  return (
    a.version === b.version &&
    a.salt === b.salt &&
    a.iv === b.iv &&
    a.ciphertext === b.ciphertext &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    sameKdfParams(a.kdfParams, b.kdfParams)
  )
}

/** Field by field, because these are the derive's inputs and part of the AAD. */
function sameKdfParams(a: KdfParams, b: KdfParams): boolean {
  return (
    a.algorithm === b.algorithm &&
    a.memoryKiB === b.memoryKiB &&
    a.iterations === b.iterations &&
    a.parallelism === b.parallelism
  )
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

/**
 * Erase the vault, the copy set aside, and the practice schedule.
 *
 * One transaction across both stores rather than three deletes in a row: an
 * interruption between them could leave the archive behind with no live vault,
 * and since `decisions/0016` the lock screen would then offer to put a vault
 * the user had just deleted back — over whatever they created next.
 */
export async function deleteVault(): Promise<void> {
  const database = await db()
  const tx = database.transaction(['vault', 'meta'], 'readwrite')
  await tx.objectStore('vault').delete(VAULT_KEY)
  await tx.objectStore('vault').delete(PREVIOUS_VAULT_KEY)
  await tx.objectStore('meta').delete(META_KEY)
  await tx.done
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
