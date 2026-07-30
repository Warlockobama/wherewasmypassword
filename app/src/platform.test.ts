import { describe, it, expect, afterEach } from 'vitest'
import { isExtensionContext } from './platform.ts'

const g = globalThis as { chrome?: unknown }

afterEach(() => {
  delete g.chrome
})

describe('platform detection', () => {
  it('reports extension context only when chrome.runtime.id exists', () => {
    expect(isExtensionContext()).toBe(false)

    g.chrome = {}
    expect(isExtensionContext()).toBe(false)

    // A page with no extension APIs bound still exposes chrome.runtime in some
    // browsers, but without an id.
    g.chrome = { runtime: {} }
    expect(isExtensionContext()).toBe(false)

    g.chrome = { runtime: { id: 'abcdefghijklmnop' } }
    expect(isExtensionContext()).toBe(true)
  })
})
