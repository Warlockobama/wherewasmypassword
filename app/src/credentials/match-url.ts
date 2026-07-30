/**
 * Check whether a stored credential URL matches a page URL.
 * Comparison is origin-based: scheme + host must match.
 */
export function urlMatches(storedUrl: string, pageUrl: string): boolean {
  // Uses the same canonical form as `credentialOrigin`, so this and autofill
  // cannot disagree about what counts as the same site.
  const a = credentialOrigin(storedUrl)
  const b = credentialOrigin(pageUrl)
  return a !== '' && a === b
}

/**
 * The origin a stored credential belongs to, or '' if it has no usable URL.
 * This is what travels with an autofill request and what the content script
 * compares against the page it is about to type into.
 *
 * A leading `www.` is dropped, and the content script drops it from the page
 * origin too. Exact-origin comparison would put the phishing warning in front
 * of the user every time they saved `example.com` and logged in at
 * `www.example.com` — and a warning that is wrong most weeks is a warning
 * people learn to click through. Nothing broader than `www.` is folded in:
 * `accounts.example.com` really is a different origin, and deciding otherwise
 * needs the public suffix list.
 */
export function credentialOrigin(storedUrl: string): string {
  if (!storedUrl.trim()) return ''
  try {
    const url = new URL(storedUrl.includes('://') ? storedUrl : `https://${storedUrl}`)
    url.hostname = canonicalHost(url.hostname)
    return url.origin
  } catch {
    return ''
  }
}

/** Strip a single leading `www.` label. Shared with the content script. */
export function canonicalHost(hostname: string): string {
  return hostname.replace(/^www\./i, '')
}
