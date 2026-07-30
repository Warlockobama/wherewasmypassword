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
  /** Origin of the stored credential; the page must match it to be filled. */
  expectedOrigin?: string
  /** Set only after the user was shown the mismatch and chose to continue. */
  overrideOrigin?: boolean
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
