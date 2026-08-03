import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * The worker half of the five-minute popup session (`decisions/0015`, `0017`).
 *
 * `session.ts` arms an alarm as it parks a key; this is what wakes for it. The
 * two halves live in different files, cannot import each other, and agree only
 * by writing the same two strings — which is exactly the sort of agreement
 * worth a test rather than a comment. What is pinned here is the promise the
 * README makes: past the deadline the key is not merely refused, it is gone.
 */

/**
 * `public/background.js` is a plain script — no imports, no exports, `chrome`
 * taken from the global scope. So rather than importing it (which would cache
 * one instance, top-level sweep and all, for the whole file), each test runs
 * its source in a fresh scope with `chrome` passed in as a parameter. That is
 * as close to "the browser started the worker" as a unit test gets.
 */
const SOURCE = readFileSync(new URL('../../public/background.js', import.meta.url), 'utf8')

const ITEM = 'popup-session'
const ALARM = 'popup-session-deadline'
const POPUP_SESSION_MS = 5 * 60 * 1000

/** What is in `chrome.storage.session`, and what alarms are armed. */
let session: Map<string, unknown>
let alarms: Map<string, number>
/** The listener the worker registers for the deadline, so a test can fire it. */
let onAlarm: ((alarm: { name: string }) => void) | null

/** A key parked in the shape `session.ts` writes. Only the deadline matters here. */
function parked(expiresAt: number) {
  return { key: 'AAAA', salt: 'salt-one', expiresAt }
}

function browser() {
  return {
    runtime: {
      id: 'test-extension',
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
      onMessage: { addListener: () => {} },
    },
    storage: {
      session: {
        get: async (key: string) => (session.has(key) ? { [key]: session.get(key) } : {}),
        remove: async (key: string) => {
          session.delete(key)
        },
        setAccessLevel: async () => {},
      },
    },
    alarms: {
      get: async (name: string) =>
        alarms.has(name) ? { name, scheduledTime: alarms.get(name) } : undefined,
      create: async (name: string, info: { when: number }) => {
        alarms.set(name, info.when)
      },
      clear: async (name: string) => alarms.delete(name),
      onAlarm: {
        addListener: (fn: (alarm: { name: string }) => void) => {
          onAlarm = fn
        },
      },
    },
  }
}

/** Start the worker, as the browser does on a message, a wake, or an alarm. */
function startWorker() {
  onAlarm = null
  new Function('chrome', SOURCE)(browser())
}

/** Let the worker's storage round-trips finish. */
const settle = () => new Promise((done) => setImmediate(done))

beforeEach(() => {
  session = new Map()
  alarms = new Map()
  onAlarm = null
})

describe('the extension worker and the parked key', () => {
  it('registers the deadline listener as it starts, not inside a callback', async () => {
    // The browser starts a stopped worker to deliver an alarm, and only sees a
    // listener registered while the script runs. Registered any later — inside
    // an async callback, say — the alarm is delivered to nobody and the key
    // keeps its deadline in name only.
    startWorker()

    expect(onAlarm).toBeTypeOf('function')
  })

  it('deletes the key when the deadline alarm fires', async () => {
    session.set(ITEM, parked(Date.now() - 1))
    alarms.set(ALARM, Date.now())
    startWorker()
    await settle()

    onAlarm?.({ name: ALARM })
    await settle()

    expect(session.has(ITEM)).toBe(false)
    expect(alarms.has(ALARM)).toBe(false)
  })

  it('acts on its own alarm and no other', async () => {
    session.set(ITEM, parked(Date.now() + POPUP_SESSION_MS))
    startWorker()
    await settle()
    // Five minutes pass and the deadline arrives.
    session.set(ITEM, parked(Date.now() - 1))

    onAlarm?.({ name: 'some-other-alarm' })
    await settle()
    expect(session.has(ITEM)).toBe(true)

    // The same record, the same worker: only the name is different, so this is
    // what shows the check above did the work rather than a broken fixture.
    onAlarm?.({ name: ALARM })
    await settle()
    expect(session.has(ITEM)).toBe(false)
  })

  it('sweeps a deadline that passed while the worker was not running', async () => {
    // The belt to the alarm's braces, and what shipped before `0017`: every
    // start of the worker is a chance to delete a key nobody can use.
    session.set(ITEM, parked(Date.now() - 1))

    startWorker()
    await settle()

    expect(session.has(ITEM)).toBe(false)
  })

  it('deletes a record dated further ahead than a whole session', async () => {
    // What a clock stepped backwards leaves behind. Every reader refuses it —
    // it is outside the window `withinLimit` allows — so nothing will ever pick
    // it up again, and "not expired yet" must not be what keeps it in memory.
    session.set(ITEM, parked(Date.now() + 65 * 60 * 1000))

    startWorker()
    await settle()

    expect(session.has(ITEM)).toBe(false)
  })

  it('deletes a record left behind in some other shape', async () => {
    session.set(ITEM, { key: 42, expiresAt: 'soon' })

    startWorker()
    await settle()

    expect(session.has(ITEM)).toBe(false)
  })

  it('leaves a session that is still running, and gives it a wake-up if it has none', async () => {
    // Repair work: the popup arms the alarm as it parks, so this only matters
    // if the browser refused it or a sweep raced the park. A parked key with
    // nothing watching it is the one state `0017` exists to rule out.
    const ends = Date.now() + POPUP_SESSION_MS
    session.set(ITEM, parked(ends))

    startWorker()
    await settle()

    expect(session.has(ITEM)).toBe(true)
    expect(alarms.get(ALARM)).toBe(ends)
  })

  it('does not disturb the wake-up a running session already has', async () => {
    const ends = Date.now() + POPUP_SESSION_MS
    session.set(ITEM, parked(ends))
    alarms.set(ALARM, ends)

    startWorker()
    await settle()

    expect(alarms.get(ALARM)).toBe(ends)
  })

  it('re-arms rather than abandoning a session that outlived its own alarm', async () => {
    // Only reachable if the clock moved under the alarm, since parking again
    // replaces it. The key is still usable, so deleting it would be wrong — but
    // leaving it with nothing left to sweep it would be the `0017` gap again.
    const ends = Date.now() + 60 * 1000
    session.set(ITEM, parked(ends))
    alarms.set(ALARM, Date.now())
    startWorker()
    await settle()
    alarms.delete(ALARM)

    onAlarm?.({ name: ALARM })
    await settle()

    expect(session.has(ITEM)).toBe(true)
    expect(alarms.get(ALARM)).toBe(ends)
  })

  it('does not cancel the alarm for a key that is not parked yet', async () => {
    // A popup parking a key is one of the things that starts this worker, so a
    // sweep can read the storage area a moment before the write lands. Finding
    // nothing must mean "nothing to do" and not "cancel the wake-up", or the
    // key that arrives a moment later has no deadline at all.
    const ends = Date.now() + POPUP_SESSION_MS
    alarms.set(ALARM, ends)

    startWorker()
    await settle()

    expect(alarms.get(ALARM)).toBe(ends)
  })
})
