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
/** Its message listener — the autofill relay, which must survive everything. */
let onMessage: unknown
/** The description of the last alarm asked for, flags and all. */
let lastAlarmInfo: { when: number; persistAcrossSessions?: boolean } | null

/** A key parked in the shape `session.ts` writes. Only the deadline matters here. */
function parked(expiresAt: number) {
  return { key: 'AAAA', salt: 'salt-one', expiresAt }
}

function browser() {
  return {
    runtime: {
      id: 'test-extension',
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
      onMessage: {
        addListener: (fn: unknown) => {
          onMessage = fn
        },
      },
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
      create: async (name: string, info: { when: number; persistAcrossSessions?: boolean }) => {
        lastAlarmInfo = info
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
function startWorker(chrome: unknown = browser()) {
  onAlarm = null
  new Function('chrome', SOURCE)(chrome)
}

/**
 * Deliver the alarm, the way the browser does: a one-shot is consumed as it
 * fires, so the handler starts with nothing armed.
 */
function fireAlarm(name = ALARM) {
  alarms.delete(name)
  onAlarm?.({ name })
}

/** Let the worker's storage round-trips finish. */
const settle = () => new Promise((done) => setImmediate(done))

beforeEach(() => {
  session = new Map()
  alarms = new Map()
  onAlarm = null
  onMessage = null
  lastAlarmInfo = null
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
    // The session is live when the worker starts, so its start-up sweep keeps
    // the key: what deletes it below can only be the alarm. Written this way
    // deliberately — parking an already-expired record instead would let the
    // start-up sweep do the deleting and the test would pass with the alarm
    // handler removed entirely.
    session.set(ITEM, parked(Date.now() + POPUP_SESSION_MS))
    startWorker()
    await settle()
    expect(session.has(ITEM)).toBe(true)

    // Five minutes later the deadline arrives, and with it the alarm.
    session.set(ITEM, parked(Date.now() - 1))
    fireAlarm()
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

    fireAlarm('some-other-alarm')
    await settle()
    expect(session.has(ITEM)).toBe(true)

    // The same record, the same worker: only the name is different, so this is
    // what shows the check above did the work rather than a broken fixture.
    fireAlarm()
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

  it('deletes a record with a good deadline but no key in it', async () => {
    // The two ends have to agree about what counts as rubbish, or the worker
    // keeps — and arms an alarm for — records `resumePopupSession` throws away
    // on sight. Left by an older version of the popup, most plausibly.
    session.set(ITEM, { salt: 'salt-one', expiresAt: Date.now() + POPUP_SESSION_MS })

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

  it('corrects a wake-up armed for the wrong time', async () => {
    // What a park whose `create` failed leaves behind while an older alarm
    // survives: a live session watched by an alarm an hour out. Checking only
    // whether *an* alarm exists would walk past this, and the key would sit
    // unwatched for the rest of its deadline.
    const ends = Date.now() + POPUP_SESSION_MS
    session.set(ITEM, parked(ends))
    alarms.set(ALARM, Date.now() + 60 * 60 * 1000)

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

    fireAlarm()
    await settle()

    expect(session.has(ITEM)).toBe(true)
    expect(alarms.get(ALARM)).toBe(ends)
  })

  it('asks for a wake-up that does not outlive the browser', async () => {
    // The storage it sweeps is emptied when the browser closes, so a persisted
    // alarm can only wake the worker for nothing — and Chrome writes persisted
    // alarms to the profile, where one would be a note of the minute a vault
    // was unlocked in an app that records nothing else about when it is used.
    session.set(ITEM, parked(Date.now() + POPUP_SESSION_MS))

    startWorker()
    await settle()

    expect(lastAlarmInfo?.persistAcrossSessions).toBe(false)
  })

  it('falls back to a plain alarm where that option is not understood', async () => {
    const ends = Date.now() + POPUP_SESSION_MS
    session.set(ITEM, parked(ends))
    const older = browser()
    older.alarms.create = async (name: string, info: { persistAcrossSessions?: boolean; when: number }) => {
      if ('persistAcrossSessions' in info) throw new Error('Unexpected property')
      alarms.set(name, info.when)
    }

    startWorker(older)
    await settle()

    expect(alarms.get(ALARM)).toBe(ends)
  })

  it('keeps working — messages included — on a browser with no alarms API', async () => {
    // A worker that throws while starting registers nothing at all, so a
    // missing `chrome.alarms` here would take the autofill relay down with it.
    // The session code treats the API as optional; so must this.
    const withoutAlarms = browser() as { alarms?: unknown; runtime: { onMessage: unknown } }
    delete withoutAlarms.alarms
    session.set(ITEM, parked(Date.now() - 1))

    expect(() => startWorker(withoutAlarms)).not.toThrow()
    await settle()

    expect(onMessage).toBeTypeOf('function')
    expect(session.has(ITEM)).toBe(false)
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
