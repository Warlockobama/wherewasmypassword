import { describe, expect, it } from 'vitest'
import { rankCredentials } from './rank.ts'
import type { Credential } from './types.ts'

function cred(partial: Partial<Credential> & { label: string }): Credential {
  return {
    id: partial.label,
    url: '',
    username: '',
    password: 'secret',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

const VAULT: Credential[] = [
  cred({ label: 'GitHub', url: 'https://github.com', username: 'octo@example.com' }),
  cred({ label: 'Bank', url: 'https://bank.example.com', username: 'jl' }),
  cred({ label: 'Router', url: '', username: 'admin' }),
  cred({ label: 'apex mail', url: 'https://www.apex.test', username: 'james' }),
]

const labels = (ranked: ReturnType<typeof rankCredentials>) => ranked.map((r) => r.cred.label)

describe('rankCredentials', () => {
  it('puts the entry for the page in front of the user first', () => {
    const ranked = rankCredentials(VAULT, 'https://github.com', '')
    expect(labels(ranked)[0]).toBe('GitHub')
    expect(ranked[0].matchesPage).toBe(true)
    // Everything else is still listed, alphabetically, so search is never the
    // only way to reach an entry.
    expect(labels(ranked).slice(1)).toEqual(['apex mail', 'Bank', 'Router'])
  })

  it('matches the same page through a www. prefix', () => {
    const ranked = rankCredentials(VAULT, 'https://apex.test', '')
    expect(ranked[0].cred.label).toBe('apex mail')
    expect(ranked[0].matchesPage).toBe(true)
  })

  it('never marks an entry with no saved site as matching the page', () => {
    // Both sides canonicalise a missing URL to '', and '' === '' would put the
    // router password at the top of the list on every site the user visits.
    for (const origin of ['https://github.com', 'https://anything.test', '']) {
      const router = rankCredentials(VAULT, origin, 'router')[0]
      expect(router.cred.label).toBe('Router')
      expect(router.matchesPage).toBe(false)
    }
  })

  it('marks nothing when the page has no usable origin', () => {
    const ranked = rankCredentials(VAULT, '', '')
    expect(ranked.every((r) => !r.matchesPage)).toBe(true)
  })

  it('does not treat a look-alike origin as a match', () => {
    const ranked = rankCredentials(VAULT, 'https://github.com.evil.test', '')
    expect(ranked.every((r) => !r.matchesPage)).toBe(true)
  })

  it('filters on label, url and username, case-insensitively', () => {
    expect(labels(rankCredentials(VAULT, '', 'GITHUB'))).toEqual(['GitHub'])
    expect(labels(rankCredentials(VAULT, '', 'octo'))).toEqual(['GitHub'])
    expect(labels(rankCredentials(VAULT, '', 'bank.example'))).toEqual(['Bank'])
  })

  it('narrows on every term rather than widening', () => {
    expect(labels(rankCredentials(VAULT, '', 'apex james'))).toEqual(['apex mail'])
    expect(labels(rankCredentials(VAULT, '', 'apex octo'))).toEqual([])
    // Stray whitespace is not a term.
    expect(labels(rankCredentials(VAULT, '', '   '))).toHaveLength(VAULT.length)
  })

  it('does not search the notes field', () => {
    const withNote = [cred({ label: 'Bank', notes: 'recovery code: zebra' })]
    expect(rankCredentials(withNote, '', 'zebra')).toHaveLength(0)
  })

  it('keeps the page match first even when the search also matches others', () => {
    const ranked = rankCredentials(
      [
        cred({ label: 'Zed archive', url: 'https://old.example.test', username: 'a@example.com' }),
        cred({ label: 'Example live', url: 'https://example.test', username: 'a@example.com' }),
      ],
      'https://example.test',
      'example',
    )
    expect(labels(ranked)).toEqual(['Example live', 'Zed archive'])
  })
})
