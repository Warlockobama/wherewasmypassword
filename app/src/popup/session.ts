import { fromBase64, toBase64 } from '../crypto/vault.ts'
import { isExtensionContext } from '../platform.ts'
import type { StoredVault } from '../storage/db.ts'

/**
 * The opt-in five-minute popup session (`decisions/0015`).
 *
 * By default the popup asks for the master passphrase every time it opens, and
 * the key it derives dies with the popup — the browser tears a popup down the
 * moment it loses focus. That is the strongest version of the local-only
 * posture, and it is what still happens unless the user turns this on.
 *
 * When they do turn it on, the key is parked in `chrome.storage.session`, which
 * lives in browser memory and is never written to disk, so the *next* popup can
 * pick it up instead of asking again. Two things bound the exposure, and both
 * are enforced here rather than left to the UI:
 *
 * - Nothing is ever parked unless the preference is on. Every write goes
 *   through `startPopupSession`, which checks it, so no future call site can
 *   opt the user in by forgetting to.
 * - The deadline is an absolute wall-clock timestamp fixed at the unlock that
 *   derived the key, and reading a session never extends it. A duration-based
 *   timer would forgive a suspended laptop the entire time it was asleep, which
 *   is the bug `decisions/0008` already fixed once for the full tab.
 *
 * What this gives up is stated plainly in `0015`: for those five minutes a
 * laptop left unattended will fill passwords without the phrase, and anything
 * that can run code in the extension's own context can read the key. Against a
 * browser already running the attacker's code neither design survives, so this
 * weakens an unattended-machine property, not the malware one.
 */

/**
 * How long an unlocked popup may hold its key, measured from the unlock that
 * derived it. Not extended by activity: "stay unlocked for five minutes" is a
 * promise about a deadline, and a sliding window would make it unbounded.
 *
 * This is a ceiling on the popup's own in-memory key as well as on the parked
 * one, so it applies whether or not the preference is on — a popup that somehow
 * keeps focus (devtools attached to it, say) no longer holds the key forever.
 */
export const POPUP_SESSION_MS = 5 * 60 * 1000

const SESSION_ITEM = 'popup-session'
const PREFERENCE_ITEM = 'popup-session-enabled'

/** What is parked in `chrome.storage.session`. */
interface SessionRecord {
  /** Base64 of the raw AES key. */
  key: string
  /**
   * The vault salt this key was derived against. A key outlives its vault when
   * something re-keys in between — a passphrase change, or the KDF upgrade an
   * unlock performs — and that stale key opens nothing. Checking the salt turns
   * a puzzling "wrong passphrase" into a plain request to type it again.
   */
  salt: string
  /** Wall-clock moment the session ends. */
  expiresAt: number
}

/** A session that was still valid when it was read. */
export interface PopupSession {
  rawKey: Uint8Array
  /** Carried forward unchanged — resuming must not buy another five minutes. */
  expiresAt: number
}

/**
 * `chrome.storage` is absent when the same bundle is served as a plain web page
 * (see `platform.ts`), and every function here degrades to "no session" rather
 * than throwing — the popup then behaves exactly as it did before this existed.
 */
function sessionArea(): chrome.storage.StorageArea | null {
  return isExtensionContext() ? (chrome.storage?.session ?? null) : null
}

function localArea(): chrome.storage.StorageArea | null {
  return isExtensionContext() ? (chrome.storage?.local ?? null) : null
}

/** Whether the user has opted in. Anything unreadable counts as off. */
export async function popupSessionEnabled(): Promise<boolean> {
  const store = localArea()
  if (!store) return false
  try {
    return (await store.get(PREFERENCE_ITEM))[PREFERENCE_ITEM] === true
  } catch {
    return false
  }
}

/**
 * Turn the session on or off.
 *
 * Turning it off ends the session that is running, rather than only stopping
 * the next one from being made: a user reaching for this switch is asking for
 * the key to stop being parked, and "from now on" would be the wrong reading.
 */
export async function setPopupSessionEnabled(enabled: boolean): Promise<void> {
  const store = localArea()
  if (!store) return
  await store.set({ [PREFERENCE_ITEM]: enabled })
  if (!enabled) await clearPopupSession()
}

/**
 * Park the key for the rest of the session, if the user has opted in.
 *
 * `expiresAt` is the deadline of the popup that is calling, so a popup which
 * enables the preference two minutes into its session parks a key with three
 * minutes left on it rather than a fresh five.
 */
export async function startPopupSession(
  rawKey: Uint8Array,
  salt: string,
  expiresAt: number,
): Promise<void> {
  const store = sessionArea()
  if (!store) return
  // The opt-in is checked here, at the only place that writes, so that it
  // cannot be bypassed by a caller that forgets.
  if (!(await popupSessionEnabled())) return
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return
  await store.set({ [SESSION_ITEM]: { key: toBase64(rawKey), salt, expiresAt } })
}

/**
 * The still-valid session for this vault, or null — in which case the popup
 * asks for the passphrase, which is always a safe answer.
 *
 * Every rejection also clears the record. A session that is expired, stale, or
 * malformed has no second chance, and leaving key bytes parked for a reader
 * that will never accept them again is the one outcome with no upside.
 */
export async function resumePopupSession(stored: StoredVault): Promise<PopupSession | null> {
  const store = sessionArea()
  if (!store) return null
  // Checked again on the way out as well as on the way in: if the write that
  // turned the preference off landed but the clear that follows it did not,
  // this is what stops the session outliving the switch.
  if (!(await popupSessionEnabled())) {
    await clearPopupSession()
    return null
  }

  let record: SessionRecord | null = null
  try {
    record = asSessionRecord((await store.get(SESSION_ITEM))[SESSION_ITEM])
  } catch {
    record = null
  }
  if (!record || record.salt !== stored.salt || record.expiresAt <= Date.now()) {
    await clearPopupSession()
    return null
  }

  let rawKey: Uint8Array
  try {
    rawKey = fromBase64(record.key)
  } catch {
    await clearPopupSession()
    return null
  }
  // AES-256, or it is not a key this vault was sealed with. A short buffer
  // would otherwise reach `importKey` and fail there as a decryption error.
  if (rawKey.length !== 32) {
    rawKey.fill(0)
    await clearPopupSession()
    return null
  }
  return { rawKey, expiresAt: record.expiresAt }
}

/**
 * End the parked session.
 *
 * Called by every lock, wherever it happens — the popup's own Lock button, a
 * lock broadcast from a memory-house tab, a passphrase change, a deleted vault.
 * The `wwmp-lock` broadcast alone would not do: it only reaches pages that
 * happen to be open, and the whole point of the parked key is that it survives
 * with no page open at all.
 *
 * The bytes cannot be zeroed the way an in-process key can — they are a string
 * in the browser's own storage — so the record is removed and the browser is
 * left to collect it. That is the honest limit of this, and the reason the
 * deadline is short.
 */
export async function clearPopupSession(): Promise<void> {
  const store = sessionArea()
  if (!store) return
  try {
    await store.remove(SESSION_ITEM)
  } catch {
    // Nothing useful to do: the caller is locking, and a storage area that
    // refuses a remove will not accept a fallback either.
  }
}

/**
 * Validate a record read back from storage.
 *
 * Storage is only writable from our own extension contexts, so this is not a
 * trust boundary — it is about a record left behind by an older version of this
 * code, which would otherwise reach `fromBase64` as `undefined`.
 */
function asSessionRecord(value: unknown): SessionRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<SessionRecord>
  if (typeof record.key !== 'string' || record.key === '') return null
  if (typeof record.salt !== 'string' || record.salt === '') return null
  if (typeof record.expiresAt !== 'number' || !Number.isFinite(record.expiresAt)) return null
  return record as SessionRecord
}
