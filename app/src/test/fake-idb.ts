/**
 * An in-memory stand-in for `idb`, so tests can run the **real** `storage/db.ts`
 * — and everything layered on it — without an IndexedDB.
 *
 * Neither environment this repo tests under has one: `node` has no IndexedDB at
 * all, and jsdom's is absent too. The alternative to this file is mocking
 * `db.ts` itself, which would mean the restore gate, the archive swap and the
 * save preconditions — the three places a security decision is actually made —
 * were only ever tested against a stub that agrees with them.
 *
 * `storage/db.test.ts` predates this and carries its own copy inline; it is left
 * alone rather than churned. New tests should use this one.
 *
 * What it is faithful about: keys, stores, and rollback on `abort()`. What it is
 * not: real IndexedDB commits a transaction the moment its microtask queue
 * drains, and nothing here reproduces that, so a test cannot use this to prove
 * something about transaction *timing*. It can prove what ends up on disk.
 */

type StoreName = string

const disk = new Map<StoreName, Map<string, unknown>>()

function area(name: StoreName): Map<string, unknown> {
  if (!disk.has(name)) disk.set(name, new Map())
  return disk.get(name)!
}

/** Empty the fake disk. Call this in `beforeEach`. */
export function resetFakeDb(): void {
  disk.clear()
}

/** Put a record on the fake disk without going through `db.ts`. */
export function seedFakeDb(store: StoreName, key: string, value: unknown): void {
  area(store).set(key, value)
}

/** Read the fake disk directly, to check what a component actually wrote. */
export function peekFakeDb<T = unknown>(store: StoreName, key: string): T | undefined {
  return area(store).get(key) as T | undefined
}

/**
 * The module shape `idb` exports, for `vi.mock('idb', …)`.
 *
 * Used as:
 *
 *     vi.mock('idb', async () => (await import('../test/fake-idb.ts')).fakeIdbModule())
 *
 * — an async factory, because `vi.mock` is hoisted above the imports and a
 * top-level `import` of this file would not be initialised yet when it runs.
 */
export function fakeIdbModule() {
  const objectStore = (name: StoreName) => ({
    get: async (key: string) => area(name).get(key),
    put: async (value: unknown, key: string) => {
      area(name).set(key, value)
    },
    delete: async (key: string) => {
      area(name).delete(key)
    },
  })

  return {
    openDB: async () => ({
      get: async (name: StoreName, key: string) => area(name).get(key),
      put: async (name: StoreName, value: unknown, key: string) => {
        area(name).set(key, value)
      },
      delete: async (name: StoreName, key: string) => {
        area(name).delete(key)
      },
      transaction: (names: StoreName | StoreName[]) => {
        const touched = Array.isArray(names) ? names : [names]
        // Rollback is a snapshot rather than a write buffer: `db.ts` reads,
        // decides, and only then writes, so a snapshot taken here is the state
        // an abort has to return to. A buffer would have to guess when the
        // caller considers the transaction finished.
        const before = new Map(touched.map((n) => [n, new Map(area(n))]))
        let aborted = false
        return {
          // Single-store callers read `tx.store`; multi-store ones name what
          // they want with `tx.objectStore(…)`.
          store: objectStore(touched[0]),
          objectStore,
          get done() {
            return aborted
              ? Promise.reject(new DOMException('transaction aborted', 'AbortError'))
              : Promise.resolve()
          },
          abort() {
            aborted = true
            for (const [name, snapshot] of before) disk.set(name, snapshot)
          },
        }
      },
    }),
  }
}
