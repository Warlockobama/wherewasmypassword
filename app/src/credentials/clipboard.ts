const CLEAR_DELAY_MS = 30_000

let clearTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Copy text to the clipboard, then automatically clear it after 30 seconds.
 * This is the fallback for sites where autofill can't reliably match the
 * login field — passwords should be kept off the clipboard when possible.
 */
export async function copyWithAutoClear(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)

  if (clearTimer !== undefined) clearTimeout(clearTimer)

  clearTimer = setTimeout(async () => {
    // Only clear if the clipboard still holds what we wrote — the user may
    // have copied something else in the meantime.
    try {
      const current = await navigator.clipboard.readText()
      if (current === text) {
        await navigator.clipboard.writeText('')
      }
    } catch {
      // Clipboard read can fail if the document lost focus; safe to ignore.
    }
    clearTimer = undefined
  }, CLEAR_DELAY_MS)
}
