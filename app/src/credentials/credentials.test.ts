import { describe, expect, it } from 'vitest'
import { generateSitePassword } from './generate-password.ts'
import { newCredentialId } from './credential-id.ts'
import { urlMatches } from './match-url.ts'

describe('generateSitePassword', () => {
  it('produces a string of the requested length', () => {
    expect(generateSitePassword(20)).toHaveLength(20)
    expect(generateSitePassword(32)).toHaveLength(32)
  })

  it('rejects lengths below 4', () => {
    expect(() => generateSitePassword(3)).toThrow(RangeError)
  })

  it('contains at least one upper, lower, digit, and symbol', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateSitePassword(12)
      expect(pw).toMatch(/[A-Z]/)
      expect(pw).toMatch(/[a-z]/)
      expect(pw).toMatch(/[0-9]/)
      expect(pw).toMatch(/[!@#$%^&*\-_=+?]/)
    }
  })

  it('generates distinct passwords', () => {
    const set = new Set<string>()
    for (let i = 0; i < 50; i++) set.add(generateSitePassword(20))
    expect(set.size).toBe(50)
  })
})

describe('newCredentialId', () => {
  it('generates a non-empty URL-safe string', () => {
    const id = newCredentialId()
    expect(id.length).toBeGreaterThan(0)
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('generates unique ids', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) ids.add(newCredentialId())
    expect(ids.size).toBe(100)
  })
})

describe('urlMatches', () => {
  it('matches same origin', () => {
    expect(urlMatches('https://github.com', 'https://github.com/login')).toBe(true)
  })

  it('rejects different origins', () => {
    expect(urlMatches('https://github.com', 'https://gitlab.com')).toBe(false)
  })

  it('rejects different schemes', () => {
    expect(urlMatches('http://example.com', 'https://example.com')).toBe(false)
  })

  it('handles bare hostnames via fallback', () => {
    expect(urlMatches('github.com', 'https://github.com/settings')).toBe(true)
  })

  it('returns false for empty or garbage', () => {
    expect(urlMatches('', '')).toBe(false)
  })
})
