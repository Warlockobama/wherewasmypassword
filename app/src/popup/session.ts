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
 * Refusing an expired session and *deleting* it were not always the same
 * moment. Refusal is immediate — past the deadline nothing here hands the key
 * back — but deleting needs something to be running, and at the deadline the
 * popup that parked the key is long destroyed and an MV3 worker is killed after
 * about thirty idle seconds, so a `setTimeout` does not survive to do it. That
 * left a key nobody could use sitting in browser memory until the extension was
 * next touched. `decisions/0017` bought one small permission to close it: every
 * park arms a one-shot `chrome.alarms` wake-up for the deadline, and the worker
 * deletes the record when it fires (`public/background.js`). Every lock cancels
 * it. Belt and braces remain — the worker also sweeps on every start, and the
 * browser closing empties this storage area outright.
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

/**
 * Kept in step with the sweep in `public/background.js`, which cannot import
 * this module — a worker that disagreed about the item name would never clear
 * anything.
 */
const SESSION_ITEM = 'popup-session'
const PREFERENCE_ITEM = 'popup-session-enabled'

/**
 * The one-shot wake-up that deletes the parked key at its deadline. Also kept
 * in step with `public/background.js`, which is the side that handles it — a
 * worker listening for a different name would never delete anything.
 */
const DEADLINE_ALARM = 'popup-session-deadline'

/**
 * Bumped by every clear.
 *
 * Parking a key is not one operation: it reads the preference, then writes.
 * A "Lock" landing between those two would be undone by the write that follows
 * it, and the next popup would open unlocked after the user explicitly locked.
 * The counter is what lets the write notice that it was overtaken.
 *
 * It reaches as far as one document and no further. The memory house is a
 * separate page with its own copy of this module and its own counter, so a
 * "Lock now" there, landing inside a park here, is not seen — the two are
 * ordinary racing writers of one storage area, and the last one wins. That is
 * why the park arms its alarm on both sides of the write and why resuming
 * arms it again: whatever the interleaving leaves parked has a deadline.
 */
let clearGeneration = 0

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

/**
 * Absent for the same reason the storage areas are — the hosted build has no
 * `chrome` at all — and absent too on a browser too old for the API. Both mean
 * the same thing here: no wake-up, so the key waits for the worker's next start
 * exactly as it did before the alarm existed. Never a reason to refuse to park.
 */
function alarmsApi(): typeof chrome.alarms | null {
  return isExtensionContext() ? (chrome.alarms ?? null) : null
}

/**
 * Arm the wake-up that deletes the parked key at `expiresAt`.
 *
 * Always the same alarm name, so parking a second key replaces the first one's
 * wake-up rather than leaving two: at most one alarm exists, and it belongs to
 * whatever is parked now.
 *
 * Chrome will not fire an alarm less than thirty seconds out however near the
 * deadline is, so a key parked with seconds left on it — the user ticking the
 * box four and a half minutes into a session — can outlive its deadline by that
 * much. It is refused throughout, and this is a floor on the browser's side
 * rather than something to work around.
 */
async function armDeadlineAlarm(expiresAt: number): Promise<void> {
  const alarms = alarmsApi()
  if (!alarms) return
  try {
    // Not kept across a browser restart, where the browser understands that:
    // the storage area this alarm exists to sweep is emptied when the browser
    // closes, so a surviving alarm can only wake the worker to find nothing —
    // and Chrome keeps a persisted alarm on disk, which would leave a note of
    // the minute a vault was unlocked in a profile that otherwise writes down
    // nothing about when it is used.
    await alarms.create(DEADLINE_ALARM, { when: expiresAt, persistAcrossSessions: false })
  } catch {
    try {
      // Older browsers reject an alarm description carrying a property they do
      // not know, and a persisted alarm is much better than no wake-up at all.
      await alarms.create(DEADLINE_ALARM, { when: expiresAt })
    } catch {
      // A browser that will not take the alarm still has the worker's sweep and
      // the browser-close wipe; failing to park the key over this would trade a
      // narrowed window for a feature the user asked for.
    }
  }
}

/** Cancel it. Every lock goes through here, via `clearPopupSession`. */
async function clearDeadlineAlarm(): Promise<void> {
  const alarms = alarmsApi()
  if (!alarms) return
  try {
    await alarms.clear(DEADLINE_ALARM)
  } catch {
    // An alarm that outlives the record it was armed for wakes the worker once
    // to find nothing parked, which is a no-op.
  }
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
 * Call `onChange` whenever the preference is changed anywhere, and return the
 * function that stops watching.
 *
 * The switch exists in two places — the popup and the memory house — and a
 * security setting that shows one answer in one window and the opposite in
 * another is worse than only offering it once.
 */
export function watchPopupSessionPreference(onChange: (enabled: boolean) => void): () => void {
  if (!isExtensionContext() || !chrome.storage?.onChanged) return () => {}
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local' || !(PREFERENCE_ITEM in changes)) return
    onChange(changes[PREFERENCE_ITEM].newValue === true)
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
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
  // Encoded before anything is awaited. The popup can be torn down mid-call,
  // and the `pagehide` wipe zeroes this array in place — encoding afterwards
  // would park thirty-two zero bytes that open nothing.
  const key = toBase64(rawKey)
  const generation = clearGeneration
  // The opt-in is checked here, at the only place that writes, so that it
  // cannot be bypassed by a caller that forgets.
  if (!(await popupSessionEnabled())) return
  if (!withinLimit(expiresAt)) return
  // A lock that landed while the preference was being read has already had its
  // say. Writing now would quietly undo it.
  if (generation !== clearGeneration) return
  // Armed either side of the write, and before it above all. A popup is
  // destroyed the instant it loses focus, and this call is not awaited by
  // anything (`Popup.tsx`), so it can be cut off between any two lines here.
  // Of the two halves, an alarm with no record only ever wakes the worker to
  // find nothing, where a record with no alarm is exactly the gap `0017`
  // closed — so the alarm goes first and the record cannot outlive it.
  await armDeadlineAlarm(expiresAt)
  await store.set({ [SESSION_ITEM]: { key, salt, expiresAt } })
  // And once more after the write, since the same race runs across it.
  if (generation !== clearGeneration) {
    await clearPopupSession()
    return
  }
  // The second arming is not redundant: the counter above only sees locks in
  // *this* document, and the memory house has its own copy of this module with
  // its own counter. A "Lock now" there, landing across this park, cancels the
  // alarm armed above; this puts it back for the record that is now on disk.
  await armDeadlineAlarm(expiresAt)
}

/**
 * Whether a deadline is one this code could have written: in the future, and
 * no further off than a whole session.
 *
 * The upper bound is the part that does real work. Without it the promise on
 * the checkbox is only as good as whoever wrote the record — a clock stepped
 * backwards (an NTP correction after a suspend, a dual-boot machine disagreeing
 * about the RTC) would leave a live session running for the length of the step,
 * with the countdown in the popup cheerfully showing sixty-five minutes.
 */
function withinLimit(expiresAt: number): boolean {
  if (!Number.isFinite(expiresAt)) return false
  const now = Date.now()
  return expiresAt > now && expiresAt <= now + POPUP_SESSION_MS
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
  if (!record || record.salt !== stored.salt || !withinLimit(record.expiresAt)) {
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
  // Opening the popup is the one moment this code gets to repair a session
  // whose wake-up went missing — a lock in the memory house landing across a
  // park can cancel an alarm this document's counter never saw. Arming again
  // for the deadline the record already carries costs one call and cannot
  // extend anything: the deadline is read from the record, never recomputed.
  await armDeadlineAlarm(record.expiresAt)
  return { rawKey, expiresAt: record.expiresAt }
}

/**
 * End the parked session.
 *
 * Called by every lock a person asked for, wherever they asked for it — the
 * popup's Lock button, "Lock now" in the memory house, a passphrase change, a
 * restored or deleted vault. Deliberately *not* by a lock broadcast being
 * received: an idle timer in some other tab is that tab minding its own key,
 * and the tab whose user pressed Lock clears this itself before broadcasting.
 *
 * A broadcast could not carry this anyway. It reaches only pages that happen to
 * be open, and the whole point of the parked key is that it survives with none.
 *
 * The bytes cannot be zeroed the way an in-process key can — they are a string
 * in storage the browser owns — so the record is removed and the browser is
 * left to collect it.
 */
export async function clearPopupSession(): Promise<void> {
  // Bumped even when there is no storage area to clear, so that a caller
  // racing a park is stopped in every context.
  clearGeneration++
  const store = sessionArea()
  if (store) {
    try {
      await store.remove(SESSION_ITEM)
    } catch {
      // Nothing useful to do: the caller is locking, and a storage area that
      // refuses a remove will not accept a fallback either.
    }
  }
  // Last, and whatever the removal did: the alarm exists only to delete a
  // record, so cancelling it before the record was gone would be the one order
  // that can leave a key parked with nothing left to sweep it.
  await clearDeadlineAlarm()
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
