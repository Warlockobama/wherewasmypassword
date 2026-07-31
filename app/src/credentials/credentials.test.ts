import { describe, expect, it } from 'vitest'
import { generateSitePassword } from './generate-password.ts'
import { newCredentialId } from './credential-id.ts'
import {
  urlMatches,
  credentialOrigin,
  canonicalHost,
  fillablePageOrigin,
} from './match-url.ts'

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

describe('credentialOrigin', () => {
  it('reduces a stored URL to the origin autofill compares against', () => {
    expect(credentialOrigin('https://github.com/login')).toBe('https://github.com')
    expect(credentialOrigin('github.com')).toBe('https://github.com')
    expect(credentialOrigin('https://mail.example.com:8443/x')).toBe('https://mail.example.com:8443')
  })

  it('is empty when there is nothing to compare', () => {
    // NOTE: an empty origin means "unknown", NOT "matches nothing". The
    // content script treats it as a refusal to fill without an explicit
    // confirmation — it used to skip the origin check altogether, which made
    // the URL-less entry the one with no protection at all.
    expect(credentialOrigin('')).toBe('')
    expect(credentialOrigin('   ')).toBe('')
    expect(credentialOrigin('not a url at all')).toBe('')
  })

  it('does not treat a look-alike host as the real one', () => {
    const real = credentialOrigin('https://github.com')
    expect(credentialOrigin('https://github.com.evil.test')).not.toBe(real)
    expect(credentialOrigin('http://github.com')).not.toBe(real)
  })

  it('folds away a leading www. so the phishing warning stays rare', () => {
    // A warning that fires every time someone saved `example.com` and logs in
    // at `www.example.com` is a warning people learn to click through.
    expect(credentialOrigin('https://www.example.com/login')).toBe('https://example.com')
    expect(credentialOrigin('www.example.com')).toBe(credentialOrigin('example.com'))
  })

  it('folds away nothing else — a different subdomain is a different site', () => {
    const real = credentialOrigin('https://example.com')
    expect(credentialOrigin('https://accounts.example.com')).not.toBe(real)
    expect(credentialOrigin('https://wwwexample.com')).not.toBe(real)
    expect(credentialOrigin('https://www.example.com.evil.test')).not.toBe(real)
    // The port and scheme stay strict.
    expect(credentialOrigin('https://www.example.com:8443')).not.toBe(real)
  })
})

describe('canonicalHost', () => {
  it('strips one leading www. label and nothing more', () => {
    expect(canonicalHost('www.example.com')).toBe('example.com')
    expect(canonicalHost('WWW.Example.com')).toBe('Example.com')
    expect(canonicalHost('www.www.example.com')).toBe('www.example.com')
    expect(canonicalHost('example.com')).toBe('example.com')
    expect(canonicalHost('wwwexample.com')).toBe('wwwexample.com')
    expect(canonicalHost('accounts.example.com')).toBe('accounts.example.com')
  })
})

describe('fillablePageOrigin', () => {
  it('accepts http(s) pages and canonicalises them exactly like a stored URL', () => {
    expect(fillablePageOrigin('https://www.example.com/login?next=/x')).toEqual({
      origin: 'https://example.com',
      host: 'example.com',
    })
    // http is not refused: a router admin page or a local test server is a
    // legitimate login page, and the origin check still pins the scheme.
    expect(fillablePageOrigin('http://127.0.0.1:5189/login')).toEqual({
      origin: 'http://127.0.0.1:5189',
      host: '127.0.0.1',
    })
    // The two sides of the origin check must never disagree about a page.
    expect(fillablePageOrigin('https://www.example.com/login')?.origin).toBe(
      credentialOrigin('https://example.com'),
    )
  })

  it('refuses everything that is not a web page', () => {
    // `new URL('chrome://settings').origin` is the STRING "null", which would
    // otherwise sail through an equality check against a credential saved with
    // no site at all.
    expect(fillablePageOrigin('chrome://settings')).toBeNull()
    expect(fillablePageOrigin('about:blank')).toBeNull()
    expect(fillablePageOrigin('file:///C:/secrets.html')).toBeNull()
    expect(fillablePageOrigin('chrome-extension://abcdefghijklmnop/index.html')).toBeNull()
    expect(fillablePageOrigin('javascript:alert(1)')).toBeNull()
    expect(fillablePageOrigin('not a url')).toBeNull()
    expect(fillablePageOrigin('')).toBeNull()
    // What `tabs.query` returns when the activeTab grant never arrived.
    expect(fillablePageOrigin(undefined)).toBeNull()
  })
})
