import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The privacy fix is only worth anything if the old unlock timeline actually
 * stops being on disk. `migratePracticeMeta` is pure and tested elsewhere;
 * what is tested here is that loading rewrites the store, which is the part
 * that removes it. IndexedDB does not exist under the node environment, so
 * `idb` is replaced with an in-memory stand-in.
 */

const store = new Map<string, Map<string, unknown>>()

vi.mock('idb', () => ({
  openDB: async () => ({
    get: async (name: string, key: string) => store.get(name)?.get(key),
    put: async (name: string, value: unknown, key: string) => {
      if (!store.has(name)) store.set(name, new Map())
      store.get(name)!.set(key, value)
    },
    delete: async (name: string, key: string) => {
      store.get(name)?.delete(key)
    },
  }),
}))

const { loadPracticeMeta } = await import('./db.ts')

const t0 = 1700000000000
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  store.clear()
})

describe('practice metadata on disk', () => {
  it('rewrites a legacy record so the unlock timeline leaves disk on load', async () => {
    store.set(
      'meta',
      new Map([['practice', { createdAt: t0, practicedAt: [t0 + DAY, t0 + 3 * DAY] }]]),
    )

    const loaded = await loadPracticeMeta()
    expect(loaded).toEqual({ createdAt: t0, practiceCount: 2, lastPracticedAt: t0 + 3 * DAY })

    // The point of the exercise: what is left in storage carries no timeline.
    const onDisk = store.get('meta')!.get('practice') as Record<string, unknown>
    expect('practicedAt' in onDisk).toBe(false)
    expect(onDisk).toEqual(loaded)
  })

  it('does not rewrite a record that is already in the current shape', async () => {
    const current = { createdAt: t0, practiceCount: 2, lastPracticedAt: t0 + DAY }
    store.set('meta', new Map([['practice', current]]))

    const loaded = await loadPracticeMeta()
    expect(loaded).toBe(current)
    expect(store.get('meta')!.get('practice')).toBe(current)
  })

  it('returns undefined when there is nothing stored', async () => {
    expect(await loadPracticeMeta()).toBeUndefined()
  })
})
