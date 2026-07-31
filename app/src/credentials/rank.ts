import type { Credential } from './types.ts'
import { credentialOrigin } from './match-url.ts'

export interface RankedCredential {
  cred: Credential
  /** True when this entry's stored site IS the page the popup is pointed at. */
  matchesPage: boolean
}

/**
 * Order the vault for the toolbar popup: entries saved for the page in front of
 * the user first, then everything else, filtered by what they have typed.
 *
 * The popup is a small window with no room to scroll a whole vault, and the
 * user opened it while looking at a login form — so the entry for that form has
 * to be the first thing they see, without typing anything at all.
 */
export function rankCredentials(
  credentials: Credential[],
  pageOrigin: string,
  query: string,
): RankedCredential[] {
  // Every whitespace-separated term must match somewhere, so "git work" narrows
  // rather than widening the way a single substring search would.
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

  return credentials
    .filter((cred) => {
      if (terms.length === 0) return true
      // Notes are deliberately not searched: they are not shown on the row, so
      // a hit there looks like the list matching nothing at all — and they are
      // where recovery codes and second secrets tend to end up.
      const haystack = `${cred.label} ${cred.url} ${cred.username}`.toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
    .map((cred) => {
      const stored = credentialOrigin(cred.url)
      // An entry with no site saved must not "match" every page: both sides
      // canonicalise an empty URL to '', and '' === '' would put a router
      // password at the top of the list on every site the user visits.
      return { cred, matchesPage: stored !== '' && pageOrigin !== '' && stored === pageOrigin }
    })
    .sort((a, b) => {
      if (a.matchesPage !== b.matchesPage) return a.matchesPage ? -1 : 1
      const byLabel = a.cred.label.localeCompare(b.cred.label, undefined, { sensitivity: 'base' })
      return byLabel !== 0 ? byLabel : a.cred.username.localeCompare(b.cred.username)
    })
}
