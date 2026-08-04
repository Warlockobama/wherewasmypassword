import { openDB, type DBSchema } from 'idb'
import type { KdfParams } from '../crypto/kdf.ts'
import type { VaultFormatVersion } from '../crypto/vault.ts'
import { asVaultSettings, DEFAULT_SETTINGS, type VaultSettings } from './settings.ts'

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

/**
 * The `meta` store holds two unrelated records under two keys — the practice
 * schedule and the device preferences — rather than one shape. It is named for
 * the only thing it held first; see `settings.ts` for why a store of its own
 * was not worth a schema version bump.
 */
interface WwmpDB extends DBSchema {
  vault: { key: string; value: StoredVault }
  meta: { key: string; value: PracticeMeta | VaultSettings }
}

const DB_NAME = 'wherewasmypassword'
const VAULT_KEY = 'primary'
const PREVIOUS_VAULT_KEY = 'previous'
const META_KEY = 'practice'
const SETTINGS_KEY = 'settings'

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
 * A write that would have created a vault found one already there
 * (`decisions/0020`).
 *
 * Distinct from `VaultSupersededError` because the answer is different. That one
 * says "what you are holding is stale, open it again"; this one says "this
 * device already has a vault, and it is not the one you just built". Nothing was
 * written either way.
 */
export class VaultAlreadyExistsError extends Error {
  constructor() {
    super('This browser already has a vault. Open that one, or delete it before making another.')
    this.name = 'VaultAlreadyExistsError'
  }
}

/**
 * What the caller believes is in the vault slot — either a record, meaning "this
 * vault, still under the key I found it under", or `'no-vault'`, meaning nothing
 * at all. Checked inside the write transaction, so nothing can land between the
 * look and the write.
 */
export type VaultPrecondition = StoredVault | 'no-vault'

/**
 * Write the vault record.
 *
 * When `expecting` is a record, the write is refused if the salt on disk is no
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
 *
 * When `expecting` is `'no-vault'` the write is refused if there is anything in
 * the slot at all. That is onboarding's, and it is the one case where a salt
 * comparison would be no use: a vault sealed at the end of a tutorial has a
 * brand-new salt by definition, so every record on disk looks like somebody
 * else's. Two tabs of a fresh install, each finishing its own memory house,
 * ended with the second silently writing over the first — no archive, no undo,
 * nothing to offer back (`decisions/0020`).
 */
export async function saveVault(record: StoredVault, expecting?: VaultPrecondition): Promise<void> {
  const database = await db()
  const tx = database.transaction('vault', 'readwrite')
  if (expecting) {
    const current = await tx.store.get(VAULT_KEY)
    // Compared inside the transaction, so nothing can land between the read
    // and the write. A different salt means a different key.
    if (expecting === 'no-vault') {
      if (current) {
        tx.abort()
        throw new VaultAlreadyExistsError()
      }
    } else if (current && current.salt !== expecting.salt) {
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
 *
 * This is the storage half only. Nothing in the UI may call it directly: since
 * `decisions/0019` a restore is gated too, and the policy lives in
 * `vault/restore.ts`.
 */
export async function restoreVault(
  incoming: StoredVault,
  /**
   * Called inside the transaction with the record about to be displaced —
   * `undefined` when there is no live vault — and expected to throw if this
   * restore is not allowed to happen. Nothing has been written when it runs, so
   * throwing leaves both slots exactly as they were.
   *
   * The check is a callback rather than a value the caller compares beforehand
   * because what it has to judge is the record actually being replaced. A
   * caller that read the live vault, decided, and then called in would be
   * deciding about a record another context can swap out in between — and the
   * whole of `0019` is that a restore must not overwrite a vault nobody
   * authenticated.
   *
   * Required, not optional, for the reason `undoRestore`'s `expecting` is: a
   * future caller writing `restoreVault(file)` would otherwise get the ungated
   * write and a clean build, and the comment above would be a rule the compiler
   * never enforces.
   *
   * It must decide *synchronously*. An `await` here would end the transaction —
   * IndexedDB commits one the moment its microtask queue drains — and the two
   * writes below would then land outside it, which is the un-atomic
   * archive-then-save this function exists to replace.
   */
  authorize: (live: StoredVault | undefined) => void,
): Promise<void> {
  const database = await db()
  const tx = database.transaction('vault', 'readwrite')
  const current = await tx.store.get(VAULT_KEY)
  // Before either write. A transaction with no requests outstanding commits
  // nothing, so an exception here is simply a restore that did not happen.
  const returned: unknown = authorize(current)
  // TypeScript accepts an `async` function where a `void` return is expected —
  // a promise is assignable to `void`. Held that way this would be the worst
  // shape it could take: a refusal would become a rejected promise nobody
  // awaits, surfacing as an unhandled error somewhere else entirely, while both
  // writes below went ahead as though the restore had been approved. Anything
  // coming back at all means the caller is not the shape this needs, and the
  // safe reading of "I cannot tell whether this was authorised" is no.
  if (returned !== undefined) {
    throw new TypeError('restoreVault: authorize must decide synchronously')
  }
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
  // The store holds settings under another key as well, so what comes back here
  // is only a practice record because of the key it was asked for.
  const stored = (await database.get('meta', META_KEY)) as PracticeMeta | undefined
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

/**
 * The device preferences, or the strictest defaults.
 *
 * Never throws and never returns "no gate": a database that will not open, a
 * record that is not there yet, and a record someone rewrote all resolve to
 * `DEFAULT_SETTINGS`. The caller is a security decision on the lock screen, and
 * the one answer it must not get from a failure is the permissive one.
 *
 * Deliberately not cached. It is read again at the moment a restore is
 * committed rather than once when the screen mounted, so a gate that was raised
 * in another tab is the gate that applies.
 */
export async function loadVaultSettings(): Promise<VaultSettings> {
  try {
    return asVaultSettings(await (await db()).get('meta', SETTINGS_KEY))
  } catch {
    return DEFAULT_SETTINGS
  }
}

/**
 * Write the device preferences.
 *
 * Not touched by `deleteVault`. "Delete vault & start over" erases the vault,
 * the copy set aside and the practice schedule — everything about a particular
 * vault — and a preference about how this browser behaves is not about any
 * vault. Clearing it would also silently re-arm a gate the user had turned off,
 * on the screen they would next meet.
 */
export async function saveVaultSettings(settings: VaultSettings): Promise<void> {
  await (await db()).put('meta', settings, SETTINGS_KEY)
}

/** Ask the browser not to evict our storage under pressure. */
export async function requestPersistence(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return navigator.storage.persist()
  }
  return false
}
