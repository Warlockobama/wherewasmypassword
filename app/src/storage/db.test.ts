import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredVault } from './db.ts'

/**
 * The privacy fix is only worth anything if the old unlock timeline actually
 * stops being on disk. `migratePracticeMeta` is pure and tested elsewhere;
 * what is tested here is that loading rewrites the store, which is the part
 * that removes it. IndexedDB does not exist under the node environment, so
 * `idb` is replaced with an in-memory stand-in.
 */

const store = new Map<string, Map<string, unknown>>()

function objectStore(name: string) {
  return {
    get: async (key: string) => store.get(name)?.get(key),
    put: async (value: unknown, key: string) => {
      if (!store.has(name)) store.set(name, new Map())
      store.get(name)!.set(key, value)
    },
    delete: async (key: string) => {
      store.get(name)?.delete(key)
    },
  }
}

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
    transaction: (name: string) => ({ store: objectStore(name), done: Promise.resolve() }),
  }),
}))

const {
  archiveCurrentVault,
  loadArchivedVault,
  loadPracticeMeta,
  loadVault,
  saveVault,
  undoRestore,
} = await import('./db.ts')

const t0 = 1700000000000
const DAY = 24 * 60 * 60 * 1000

/** Only the fields the archive machinery moves around have to be real. */
function vaultRecord(salt: string, updatedAt: number): StoredVault {
  return {
    version: 2,
    salt,
    kdfParams: { algorithm: 'argon2id', memoryKiB: 256 * 1024, iterations: 3, parallelism: 1 },
    iv: 'aXY=',
    ciphertext: 'Y3Q=',
    createdAt: t0,
    updatedAt,
  }
}

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

/**
 * The archive was written on every restore and never read back, which made the
 * dialog's "the current vault is kept aside" a promise the app could not keep
 * (`decisions/0016`). These cover the read-back: that it puts the right record
 * live, that it does not leave a copy behind to be undone twice, and that it
 * says so rather than destroying anything when there is nothing to undo.
 */
describe('undoing a restore', () => {
  const mine = vaultRecord('salt-mine', t0)
  const theirs = vaultRecord('salt-restored', t0 + DAY)

  it('puts back the vault the restore replaced', async () => {
    await saveVault(mine)
    // What a restore does: set the outgoing vault aside, write the new one.
    await archiveCurrentVault()
    await saveVault(theirs)
    expect(await loadVault()).toEqual(theirs)

    expect(await undoRestore()).toEqual(mine)
    expect(await loadVault()).toEqual(mine)
  })

  it('consumes the archive, so the same undo is not offered twice', async () => {
    await saveVault(mine)
    await archiveCurrentVault()
    await saveVault(theirs)

    await undoRestore()

    expect(await loadArchivedVault()).toBeUndefined()
    // The second call must be a no-op, not a write of `undefined` over the
    // vault that was just put back.
    expect(await undoRestore()).toBeUndefined()
    expect(await loadVault()).toEqual(mine)
  })

  it('does nothing when no restore was ever made', async () => {
    await saveVault(mine)

    expect(await undoRestore()).toBeUndefined()
    expect(await loadVault()).toEqual(mine)
  })

  it('keeps only the most recently replaced vault', async () => {
    // Two restores in a row: the first vault is gone for good, which is what
    // the retention rule in the ruling says and what the dialog now implies by
    // offering the undo only once.
    const third = vaultRecord('salt-third', t0 + 2 * DAY)
    await saveVault(mine)
    await archiveCurrentVault()
    await saveVault(theirs)
    await archiveCurrentVault()
    await saveVault(third)

    expect(await undoRestore()).toEqual(theirs)
  })
})
