export interface AutofillResult {
  ok: boolean
  filled?: boolean
  reason?: string
  detail?: string
  /** Present on an origin mismatch, so the UI can name both sides. */
  pageOrigin?: string
  expectedOrigin?: string
}

export interface AutofillRequest {
  username: string
  password: string
  /**
   * The tab to fill. The popup resolves this once, up front, and shows the user
   * its origin — so the fill lands in the page they were told about rather than
   * in whatever happens to be active a few seconds later. Omitted by callers
   * that have no tab in hand, which falls back to the active tab.
   */
  tabId?: number
  /** Origin of the stored credential; the page must match it to be filled. */
  expectedOrigin?: string
  /**
   * The origin the user was shown and explicitly approved. Carrying the origin
   * rather than a boolean is what stops the approval being reusable: a page
   * that navigates between the warning and the click no longer matches it.
   */
  overrideOrigin?: string
}

/**
 * Ask the background worker to relay credentials to the active tab's content
 * script for direct field injection (no clipboard involved).
 */
export function requestAutofill(request: AutofillRequest): Promise<AutofillResult> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      resolve({ ok: false, reason: 'not-in-extension' })
      return
    }
    chrome.runtime.sendMessage(
      { type: 'wwmp-autofill-relay', ...request },
      (response: AutofillResult | undefined) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: 'send-failed', detail: chrome.runtime.lastError.message })
        } else {
          resolve(response ?? { ok: false, reason: 'no-response' })
        }
      },
    )
  })
}
