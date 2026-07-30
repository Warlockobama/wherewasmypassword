/**
 * Check whether a stored credential URL matches a page URL.
 * Comparison is origin-based: scheme + host must match.
 */
export function urlMatches(storedUrl: string, pageUrl: string): boolean {
  try {
    const a = new URL(storedUrl)
    const b = new URL(pageUrl)
    return a.origin === b.origin
  } catch {
    // If either URL is unparseable, fall back to substring match on hostname.
    const hostA = extractHost(storedUrl)
    const hostB = extractHost(pageUrl)
    return hostA !== '' && hostA === hostB
  }
}

function extractHost(raw: string): string {
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
  } catch {
    return ''
  }
}
