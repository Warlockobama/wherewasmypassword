/**
 * The same bundle runs as an MV3 extension page and as a plain static page
 * (see the README). Autofill needs the extension APIs, so the UI has to know
 * which one it is in and fall back to the clipboard when it isn't.
 */

/** True when running inside our browser extension (not as a plain web page). */
export function isExtensionContext(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.id === 'string'
  )
}
