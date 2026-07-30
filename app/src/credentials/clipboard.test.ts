import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The clipboard clear is the one security control here that runs while the
 * user is somewhere else, which is exactly why it was broken: the browser
 * refuses clipboard access to an unfocused document, and the whole point of
 * copying a password is to go and paste it elsewhere. These tests drive that
 * away-and-back sequence directly, because no other gate can.
 */

const CLEAR_DELAY_MS = 30_000

type Listener = (event?: unknown) => void

let written: string[]
let clipboardContents: string
let focused: boolean
let listeners: Record<string, Listener[]>

function fire(type: string) {
  for (const fn of listeners[type] ?? []) fn()
}

/** Install the minimal browser surface the module touches. */
function installEnvironment() {
  written = []
  clipboardContents = ''
  focused = true
  listeners = {}

  const addEventListener = (type: string, fn: Listener) => {
    ;(listeners[type] ??= []).push(fn)
  }

  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: async (text: string) => {
        written.push(text)
        clipboardContents = text
      },
      readText: async () => {
        // Real browsers reject the read outright when unfocused.
        if (!focused) throw new Error('Document is not focused.')
        return clipboardContents
      },
    },
  })
  vi.stubGlobal('document', {
    hasFocus: () => focused,
    addEventListener,
  })
  vi.stubGlobal('window', { addEventListener })
}

/** A fresh copy of the module, since its pending state is module-level. */
async function freshModule() {
  vi.resetModules()
  return import('./clipboard.ts')
}

beforeEach(() => {
  vi.useFakeTimers()
  installEnvironment()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('clipboard auto-clear', () => {
  it('clears after the delay when the tab is focused', async () => {
    const { copyWithAutoClear } = await freshModule()
    await copyWithAutoClear('hunter2')
    expect(written).toEqual(['hunter2'])

    await vi.advanceTimersByTimeAsync(CLEAR_DELAY_MS + 10)
    expect(written).toEqual(['hunter2', ''])
    expect(clipboardContents).toBe('')
  })

  it('does not clear while the tab is unfocused, and clears the moment it returns', async () => {
    // The failure this exists for: the old code swallowed the rejection,
    // dropped the pending record, and left the password on the clipboard.
    const { copyWithAutoClear } = await freshModule()
    await copyWithAutoClear('hunter2')
    focused = false

    await vi.advanceTimersByTimeAsync(CLEAR_DELAY_MS + 10)
    expect(clipboardContents).toBe('hunter2')

    focused = true
    fire('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(clipboardContents).toBe('')
  })

  it('survives a suspend: a deadline passed while away still clears on return', async () => {
    const { copyWithAutoClear } = await freshModule()
    await copyWithAutoClear('hunter2')
    focused = false
    // Far beyond the delay, as a sleeping laptop would be.
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
    expect(clipboardContents).toBe('hunter2')

    focused = true
    fire('visibilitychange')
    await vi.advanceTimersByTimeAsync(0)
    expect(clipboardContents).toBe('')
  })

  it('leaves the clipboard alone if the user copied something themselves', async () => {
    const { copyWithAutoClear } = await freshModule()
    await copyWithAutoClear('hunter2')

    fire('copy')
    clipboardContents = 'a paragraph the user wanted'

    await vi.advanceTimersByTimeAsync(CLEAR_DELAY_MS + 10)
    expect(clipboardContents).toBe('a paragraph the user wanted')
    expect(written).toEqual(['hunter2'])
  })

  it('leaves the clipboard alone if it plainly holds something else', async () => {
    const { copyWithAutoClear } = await freshModule()
    await copyWithAutoClear('hunter2')
    clipboardContents = 'something else entirely'

    await vi.advanceTimersByTimeAsync(CLEAR_DELAY_MS + 10)
    expect(clipboardContents).toBe('something else entirely')
  })

  it('clears immediately when the vault locks with the tab focused', async () => {
    const { copyWithAutoClear, clearClipboardOnLock } = await freshModule()
    await copyWithAutoClear('hunter2')

    await clearClipboardOnLock()
    expect(clipboardContents).toBe('')
  })

  it('locking while away keeps the clear armed rather than discarding it', async () => {
    // Locking is usually *caused* by the user being away, so this is the
    // common path. Dropping the record here would mean the password stayed on
    // the clipboard for good.
    const { copyWithAutoClear, clearClipboardOnLock } = await freshModule()
    await copyWithAutoClear('hunter2')
    focused = false

    await clearClipboardOnLock()
    expect(clipboardContents).toBe('hunter2')

    focused = true
    fire('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(clipboardContents).toBe('')
  })

  it('a second copy supersedes the first without clearing the new one', async () => {
    const { copyWithAutoClear } = await freshModule()
    await copyWithAutoClear('first')
    await vi.advanceTimersByTimeAsync(CLEAR_DELAY_MS / 2)
    await copyWithAutoClear('second')

    // The first password's deadline must not take the second one off.
    await vi.advanceTimersByTimeAsync(CLEAR_DELAY_MS / 2 + 10)
    expect(clipboardContents).toBe('second')

    await vi.advanceTimersByTimeAsync(CLEAR_DELAY_MS)
    expect(clipboardContents).toBe('')
  })
})
