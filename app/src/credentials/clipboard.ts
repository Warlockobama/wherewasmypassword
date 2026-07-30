const CLEAR_DELAY_MS = 30_000

/**
 * The password we put on the clipboard and the wall-clock moment it should
 * come off again. A deadline rather than a bare timer: `setTimeout` counts
 * suspended time as if it never happened, so a laptop that sleeps for eight
 * hours would otherwise wake with the password still there and 20 seconds
 * left to run.
 */
let pending: { text: string; deadline: number; generation: number } | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let listening = false
/** Bumped on every copy, so a clear that started earlier can tell it is stale. */
let generation = 0

/**
 * Copy text to the clipboard and take it off again after 30 seconds.
 *
 * This is the fallback for pages autofill cannot reach — passwords are kept
 * off the clipboard when there is any choice about it.
 *
 * The hard part is that the browser only lets a document touch the clipboard
 * while it is focused, and the whole point of copying a password is to go
 * somewhere else and paste it. So the clear cannot simply be a timer: it has
 * to survive the user being away, and run the moment they come back.
 */
export async function copyWithAutoClear(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  pending = { text, deadline: Date.now() + CLEAR_DELAY_MS, generation: ++generation }
  listen()
  schedule()
}

/**
 * What the vault calls when it locks. Until this runs the plaintext password
 * is still reachable from the pending record, even though the key has been
 * zeroed.
 *
 * If the document is not focused the clipboard cannot be touched at all, and
 * the record is left armed rather than discarded: actually clearing the
 * password when the user comes back matters more than dropping our reference
 * to it a few minutes earlier. Locking is usually *caused* by the user being
 * away, so this is the common case, not the corner one.
 */
export async function clearClipboardOnLock(): Promise<void> {
  if (!pending) return
  if (typeof document !== 'undefined' && !document.hasFocus()) {
    pending.deadline = Date.now()
    // Re-arm: the original timer may already have fired and returned, in which
    // case nothing would be left to try again except a focus event.
    schedule()
    return
  }
  await clearClipboardNow()
}

/**
 * Clear now and forget the password, whatever the deadline said.
 *
 * The clipboard is overwritten without first reading it back to confirm it is
 * still ours. That check is not available: `navigator.clipboard.readText()`
 * needs the `clipboardRead` permission, which this extension deliberately does
 * not request — "read data you copy and paste" is a large thing to ask for on
 * behalf of a password manager. Writing regardless is what other password
 * managers do, and the alternative is not clearing at all, which is the bug
 * this whole path exists to fix. A copy the user makes inside our own UI still
 * cancels the pending clear, via the `copy` listener below.
 */
export async function clearClipboardNow(): Promise<void> {
  const current = pending
  pending = null
  clearTimeout(timer)
  timer = undefined
  if (!current) return
  try {
    // A newer copy may have landed while an earlier clear was in flight;
    // blanking the clipboard then would take the password the user is about
    // to paste.
    if (current.generation !== generation) return
    await navigator.clipboard.writeText('')
  } catch {
    // Refused — no focus, most likely. The next focus tries again if armed.
  }
}

function schedule(): void {
  clearTimeout(timer)
  if (!pending) return
  timer = setTimeout(() => void attempt(), Math.max(0, pending.deadline - Date.now()))
}

async function attempt(): Promise<void> {
  if (!pending) return
  // Re-check against the clock, not against the timer having fired.
  if (Date.now() < pending.deadline) {
    schedule()
    return
  }
  // Without focus the clipboard is untouchable. Leave the record armed; the
  // focus and visibility listeners will call straight back here.
  if (typeof document !== 'undefined' && !document.hasFocus()) return
  await clearClipboardNow()
}

function listen(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  const recheck = () => void attempt()
  window.addEventListener('focus', recheck)
  document.addEventListener('visibilitychange', recheck)
  // The user copying something themselves means the clipboard is theirs again
  // and we should not wipe it out from under them.
  const released = () => {
    pending = null
    clearTimeout(timer)
    timer = undefined
  }
  document.addEventListener('copy', released)
  document.addEventListener('cut', released)
}
