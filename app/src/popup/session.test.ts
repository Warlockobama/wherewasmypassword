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
/** Alarm name → the moment it is set to fire. */
let alarms: Map<string, number>

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

/**
 * `chrome.alarms`, as far as this module uses it: one named one-shot, created
 * by name so a second create replaces the first.
 */
function alarmsApi() {
  return {
    create: async (name: string, info: { when: number }) => {
      alarms.set(name, info.when)
    },
    clear: async (name: string) => alarms.delete(name),
  }
}

function installChrome() {
  session = new Map()
  local = new Map()
  alarms = new Map()
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension' },
    storage: { session: area(session), local: area(local) },
    alarms: alarmsApi(),
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

  it('refuses a deadline further off than a whole session', async () => {
    // What a clock stepped backwards leaves behind — an NTP correction after a
    // suspend, or a dual-boot machine disagreeing about the RTC. Without an
    // upper bound the session runs for the length of the step and the popup
    // counts down from sixty-five minutes.
    await setPopupSessionEnabled(true)
    session.set('popup-session', {
      key: 'B'.repeat(42) + '==',
      salt: 'salt-one',
      expiresAt: Date.now() + 65 * 60 * 1000,
    })

    expect(await resumePopupSession(vault())).toBeNull()
    expect(session.has('popup-session')).toBe(false)
  })

  it('will not park a deadline further off than a whole session either', async () => {
    await setPopupSessionEnabled(true)

    await startPopupSession(KEY, 'salt-one', Date.now() + 65 * 60 * 1000)

    expect([...session.keys()]).toEqual([])
  })

  it('does not park a key over a lock that landed while it was starting', async () => {
    // The user presses Lock in the moment between the preference being read
    // and the key being written. Without the guard the write wins, and the
    // next popup opens unlocked after an explicit lock.
    await setPopupSessionEnabled(true)
    const parking = startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)
    await clearPopupSession()
    await parking

    expect(session.has('popup-session')).toBe(false)
    expect(await resumePopupSession(vault())).toBeNull()
  })

  it('arms a wake-up for the deadline when it parks a key', async () => {
    // Nothing else is alive at the deadline to delete the key: the popup that
    // parked it is destroyed on blur, and an MV3 worker is killed after about
    // thirty idle seconds, so a timer does not survive to run (`0017`).
    await setPopupSessionEnabled(true)
    const ends = Date.now() + POPUP_SESSION_MS

    await startPopupSession(KEY, 'salt-one', ends)

    expect(alarms.get('popup-session-deadline')).toBe(ends)
  })

  it('arms it for the deadline in hand, not a fresh five minutes', async () => {
    // Ticking the box two minutes in parks the key on the deadline that session
    // already has, so the wake-up must be the same moment and not five minutes
    // from now — otherwise enabling the setting quietly extends the session.
    await setPopupSessionEnabled(true)
    const ends = Date.now() + 3 * 60 * 1000

    await startPopupSession(KEY, 'salt-one', ends)

    expect(alarms.get('popup-session-deadline')).toBe(ends)
  })

  it('arms nothing while the session is off', async () => {
    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)

    expect([...alarms.keys()]).toEqual([])
  })

  it('cancels the wake-up when the session is locked', async () => {
    await setPopupSessionEnabled(true)
    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)

    await clearPopupSession()

    expect([...alarms.keys()]).toEqual([])
  })

  it('cancels the wake-up when the preference goes off', async () => {
    await setPopupSessionEnabled(true)
    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)

    await setPopupSessionEnabled(false)

    expect([...alarms.keys()]).toEqual([])
  })

  it('keeps one wake-up, for the key that is parked now', async () => {
    // A second unlock replaces the parked key; two alarms would mean the first
    // one waking the worker to delete a key that is not the one it was armed for.
    await setPopupSessionEnabled(true)
    const first = Date.now() + 60 * 1000
    const second = Date.now() + POPUP_SESSION_MS

    await startPopupSession(KEY, 'salt-one', first)
    await startPopupSession(OTHER_KEY, 'salt-one', second)

    expect(alarms.size).toBe(1)
    expect(alarms.get('popup-session-deadline')).toBe(second)
  })

  it('still parks the key on a browser with no alarms API', async () => {
    // What shipped before `0017`: the key is deleted on the worker's next start
    // and when the browser closes. Worth less than a wake-up, not broken — and
    // never a reason to refuse the user the session they asked for.
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      storage: { session: area(session), local: area(local) },
    })
    await setPopupSessionEnabled(true)

    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)

    expect((await resumePopupSession(vault()))?.rawKey).toEqual(KEY)
  })

  it('still parks the key if the browser refuses the alarm', async () => {
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      storage: { session: area(session), local: area(local) },
      alarms: {
        create: async () => {
          throw new Error('no such permission')
        },
        clear: async () => false,
      },
    })
    await setPopupSessionEnabled(true)

    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)

    expect((await resumePopupSession(vault()))?.rawKey).toEqual(KEY)
  })

  it('arms a plain alarm on a browser that will not take the persistence flag', async () => {
    // The alarm asks not to survive a browser restart, which older browsers
    // reject as an unknown property rather than ignore. A persisted alarm is
    // much better than none, so the second attempt drops the flag.
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      storage: { session: area(session), local: area(local) },
      alarms: {
        create: async (name: string, info: { when: number; persistAcrossSessions?: boolean }) => {
          if ('persistAcrossSessions' in info) throw new Error('Unexpected property')
          alarms.set(name, info.when)
        },
        clear: async (name: string) => alarms.delete(name),
      },
    })
    await setPopupSessionEnabled(true)
    const ends = Date.now() + POPUP_SESSION_MS

    await startPopupSession(KEY, 'salt-one', ends)

    expect(alarms.get('popup-session-deadline')).toBe(ends)
  })

  it('arms the wake-up before the key is on disk, not after', async () => {
    // A popup is destroyed the instant it loses focus and nothing awaits this
    // call, so it can be cut off mid-park. An alarm with no record only wakes
    // the worker to find nothing; a record with no alarm is the gap `0017`
    // closed — so the order has to be this way round and not the other.
    const order: string[] = []
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      storage: {
        session: {
          ...area(session),
          set: async (items: Record<string, unknown>) => {
            order.push('record')
            for (const [k, v] of Object.entries(items)) session.set(k, v)
          },
        },
        local: area(local),
      },
      alarms: {
        create: async (name: string, info: { when: number }) => {
          order.push('alarm')
          alarms.set(name, info.when)
        },
        clear: async (name: string) => alarms.delete(name),
      },
    })
    await setPopupSessionEnabled(true)

    await startPopupSession(KEY, 'salt-one', Date.now() + POPUP_SESSION_MS)

    expect(order[0]).toBe('alarm')
    expect(order).toContain('record')
  })

  it('puts back a wake-up cancelled by a lock in the other document', async () => {
    // The memory house has its own copy of this module and its own clear
    // counter, so a "Lock now" there is invisible to the guard inside a park
    // here. What it can cancel is the alarm — and resuming is where the popup
    // notices and arms it again, on the deadline the record already carries.
    await setPopupSessionEnabled(true)
    const ends = Date.now() + POPUP_SESSION_MS
    await startPopupSession(KEY, 'salt-one', ends)
    alarms.clear()

    expect((await resumePopupSession(vault()))?.expiresAt).toBe(ends)
    expect(alarms.get('popup-session-deadline')).toBe(ends)
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
