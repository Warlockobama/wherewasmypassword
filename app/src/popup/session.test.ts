import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  POPUP_SESSION_MS,
  clearPopupSession,
  popupSessionEnabled,
  resumePopupSession,
  setPopupSessionEnabled,
  startPopupSession,
} from './session.ts'
import type { StoredVault } from '../storage/db.ts'

/**
 * The popup session is the one place in this app where a derived key is written
 * anywhere at all, so its rules are worth pinning down in tests rather than in
 * prose: it is off unless the user turned it on, it ends at a wall-clock
 * deadline that reading it cannot push back, and any lock takes it away.
 */

const KEY = new Uint8Array(32).fill(7)
const OTHER_KEY = new Uint8Array(32).fill(9)

/** Only the two fields the session cares about have to be real. */
function vault(salt = 'salt-one'): StoredVault {
  return {
    version: 2,
    salt,
    kdfParams: { algorithm: 'argon2id', memoryKiB: 256 * 1024, iterations: 3, parallelism: 1 },
    iv: 'aXY=',
    ciphertext: 'Y3Q=',
    createdAt: 0,
    updatedAt: 0,
  }
}

/** The two storage areas, as maps, so a test can look at what was written. */
let session: Map<string, unknown>
let local: Map<string, unknown>

function area(store: Map<string, unknown>) {
  return {
    get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) store.set(k, v)
    },
    remove: async (key: string) => {
      store.delete(key)
    },
  }
}

function installChrome() {
  session = new Map()
  local = new Map()
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension' },
    storage: { session: area(session), local: area(local) },
  })
}

beforeEach(installChrome)

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('popup session', () => {
  it('is off until the user turns it on', async () => {
    expect(await popupSessionEnabled()).toBe(false)

    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)

    // Not merely refused on the way back out — never written. This is the test
    // that fails if the opt-in check is ever moved out of the writing path.
    expect([...session.keys()]).toEqual([])
    expect(await resumePopupSession(vault())).toBeNull()
  })

  it('carries the key to the next popup once it is on', async () => {
    await setPopupSessionEnabled(true)
    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)

    const resumed = await resumePopupSession(vault())
    expect(resumed?.rawKey).toEqual(KEY)
  })

  it('does not buy another five minutes each time it is read', async () => {
    vi.useFakeTimers()
    const start = new Date('2026-08-02T09:00:00Z').getTime()
    vi.setSystemTime(start)
    await setPopupSessionEnabled(true)
    await startPopupSession(KEY, 'salt-one', start + POPUP_SESSION_MS)

    // Four minutes in: still open, and still ending when it always was.
    vi.setSystemTime(start + 4 * 60 * 1000)
    const midway = await resumePopupSession(vault())
    expect(midway?.expiresAt).toBe(start + POPUP_SESSION_MS)

    // A minute later it is over, however many times it was picked up.
    vi.setSystemTime(start + POPUP_SESSION_MS + 1)
    expect(await resumePopupSession(vault())).toBeNull()
  })

  it('is over when the deadline passed while the machine was asleep', async () => {
    vi.useFakeTimers()
    const start = new Date('2026-08-02T09:00:00Z').getTime()
    vi.setSystemTime(start)
    await setPopupSessionEnabled(true)
    await startPopupSession(KEY, 'salt-one', start + POPUP_SESSION_MS)

    // No timer ran here — the laptop's lid was shut. Only the clock moved.
    vi.setSystemTime(start + 8 * 60 * 60 * 1000)

    expect(await resumePopupSession(vault())).toBeNull()
    expect(session.has('popup-session')).toBe(false)
  })

  it('refuses a key derived against a salt the vault no longer has', async () => {
    // What a passphrase change or a KDF upgrade in another context leaves
    // behind. The key opens nothing, so asking for the phrase is the honest
    // answer rather than a decryption failure.
    await setPopupSessionEnabled(true)
    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)

    expect(await resumePopupSession(vault('salt-two'))).toBeNull()
    expect(session.has('popup-session')).toBe(false)
  })

  it('refuses anything that is not a whole AES-256 key', async () => {
    await setPopupSessionEnabled(true)
    session.set('popup-session', {
      key: 'AAAA',
      salt: 'salt-one',
      expiresAt: Date.now() + POPUP_SESSION_MS,
    })

    expect(await resumePopupSession(vault())).toBeNull()
    expect(session.has('popup-session')).toBe(false)
  })

  it('refuses a record left behind in some other shape', async () => {
    await setPopupSessionEnabled(true)
    session.set('popup-session', { key: 42, expiresAt: 'soon' })

    expect(await resumePopupSession(vault())).toBeNull()
    expect(session.has('popup-session')).toBe(false)
  })

  it('is ended by a lock, not merely stopped from starting again', async () => {
    await setPopupSessionEnabled(true)
    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)

    await clearPopupSession()

    expect(session.has('popup-session')).toBe(false)
    expect(await resumePopupSession(vault())).toBeNull()
    // And the preference survives: locking is not un-choosing the setting.
    expect(await popupSessionEnabled()).toBe(true)
  })

  it('is ended by turning the preference off', async () => {
    await setPopupSessionEnabled(true)
    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)

    await setPopupSessionEnabled(false)

    expect(session.has('popup-session')).toBe(false)
    expect(await resumePopupSession(vault())).toBeNull()
  })

  it('refuses a parked key if the preference went off without clearing it', async () => {
    // Belt and braces for a half-completed switch-off: the preference write
    // landing without the clear that follows it must not leave a live session.
    await setPopupSessionEnabled(true)
    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)
    local.set('popup-session-enabled', false)

    expect(await resumePopupSession(vault())).toBeNull()
    expect(session.has('popup-session')).toBe(false)
  })

  it('replaces the parked key rather than accumulating them', async () => {
    await setPopupSessionEnabled(true)
    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)
    await startPopupSession(OTHER_KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)

    expect(session.size).toBe(1)
    expect((await resumePopupSession(vault()))?.rawKey).toEqual(OTHER_KEY)
  })

  it('does nothing at all outside the extension', async () => {
    // The same bundle is served as a plain web page, where `chrome` is absent.
    vi.stubGlobal('chrome', undefined)

    await expect(setPopupSessionEnabled(true)).resolves.toBeUndefined()
    await expect(startPopupSession(KEY, 'salt-one', Date.now() + 1000)).resolves.toBeUndefined()
    await expect(clearPopupSession()).resolves.toBeUndefined()
    expect(await popupSessionEnabled()).toBe(false)
    expect(await resumePopupSession(vault())).toBeNull()
  })
})
