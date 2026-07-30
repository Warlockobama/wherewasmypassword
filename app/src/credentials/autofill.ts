export interface AutofillResult {
  ok: boolean
  filled?: boolean
  reason?: string
  detail?: string
}

/**
 * Ask the background worker to relay credentials to the active tab's content
 * script for direct field injection (no clipboard involved).
 */
export function requestAutofill(username: string, password: string): Promise<AutofillResult> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      resolve({ ok: false, reason: 'not-in-extension' })
      return
    }
    chrome.runtime.sendMessage(
      { type: 'wwmp-autofill-relay', username, password },
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
