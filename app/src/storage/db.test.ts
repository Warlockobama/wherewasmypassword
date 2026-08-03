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
    // Single-store callers read `tx.store`; the multi-store ones name what they
    // want with `tx.objectStore(...)`.
    transaction: (name: string | string[]) => ({
      store: objectStore(Array.isArray(name) ? name[0] : name),
      objectStore,
      done: Promise.resolve(),
    }),
  }),
}))

const {
  restoreVault,
  deleteVault,
  loadArchivedVault,
  loadPracticeMeta,
  loadVault,
  savePracticeMeta,
  saveVault,
  undoRestore,
} = await import('./db.ts')

const t0 = 1700000000000
const DAY = 24 * 60 * 60 * 1000

/**
 * Only the fields the archive machinery moves around have to be real — but the
 * IV and ciphertext do have to *differ* between records. They are what
 * `sameRecord` leans on to tell one write of one vault from another, and a
 * fixture that hardcoded them would leave that half of the comparison passing
 * whatever it was mutated to.
 */
function vaultRecord(salt: string, updatedAt: number): StoredVault {
  return {
    version: 2,
    salt,
    kdfParams: { algorithm: 'argon2id', memoryKiB: 256 * 1024, iterations: 3, parallelism: 1 },
    iv: btoa(`iv-${salt}`),
    ciphertext: btoa(`ciphertext-${salt}-${updatedAt}`),
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
 * live, that the record it displaces takes the archive slot so nothing is ever
 * thrown away, and that it says so rather than destroying anything when there
 * is nothing to undo.
 */
describe('undoing a restore', () => {
  const mine = vaultRecord('salt-mine', t0)
  const theirs = vaultRecord('salt-restored', t0 + DAY)

  it('sets the outgoing vault aside as it replaces it', async () => {
    // The two halves are one transaction on purpose. Between them the archive
    // slot holds the vault that is still live, and an undo in another tab can
    // swap underneath: it would put the proven vault back and the second half
    // of this restore would then write over it, destroying the vault whose
    // passphrase had just been proven.
    await saveVault(mine)

    await restoreVault(theirs)

    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toEqual(mine)
  })

  it('puts back the vault the restore replaced', async () => {
    await saveVault(mine)
    await restoreVault(theirs)
    expect(await loadVault()).toEqual(theirs)

    expect(await undoRestore(mine)).toEqual(mine)
    expect(await loadVault()).toEqual(mine)
  })

  it('sets the displaced vault aside, so a mistaken press is reversible', async () => {
    // The undo stays on the lock screen for as long as an archive exists, which
    // can be months — by which time the live vault holds edits that are in no
    // backup file. Consuming the archive would let one curious press destroy
    // them: the same unrecoverable loss this exists to remove, pointed the
    // other way.
    await saveVault(mine)
    await restoreVault(theirs)

    await undoRestore(mine)
    expect(await loadVault()).toEqual(mine)
    expect(await loadArchivedVault()).toEqual(theirs)

    // Pressing again puts things back exactly as they were.
    expect(await undoRestore(theirs)).toEqual(theirs)
    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toEqual(mine)
  })

  it('refuses to swap in a record other than the one the caller proved', async () => {
    // The caller is the passphrase gate (`decisions/0018`), and its Argon2id
    // derive is a second wide. A restore in another copy of the UI inside that
    // second replaces what is set aside; the swap must then do nothing rather
    // than put back a vault whose phrase nobody just typed.
    await saveVault(mine)
    await restoreVault(theirs)

    // A different vault entirely, and — separately — the same vault's salt on
    // somebody else's ciphertext, since salt alone is not what identifies a
    // record. Neither may be swapped in.
    expect(await undoRestore(vaultRecord('a-different-vault', t0))).toBeUndefined()
    expect(await undoRestore({ ...mine, ciphertext: theirs.ciphertext })).toBeUndefined()
    expect(await undoRestore({ ...mine, iv: theirs.iv })).toBeUndefined()

    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toEqual(mine)
  })

  it('refuses a record whose header was rewritten under the caller', async () => {
    // Same ciphertext and IV, key-derivation settings no browser will run.
    // Anyone who can write the archive slot can write this, and comparing only
    // the body would let it through: the proof upstream derives against the
    // sane parameters it holds in memory, succeeds, and the swap would install
    // a live vault that no passphrase can open.
    await saveVault(mine)
    await restoreVault(theirs)
    const tampered = { ...mine, kdfParams: { ...mine.kdfParams, memoryKiB: 2 * 1024 * 1024 } }
    store.get('vault')!.set('previous', tampered)

    expect(await undoRestore(mine)).toBeUndefined()

    expect(await loadVault()).toEqual(theirs)
  })

  it('never leaves the archive pointing at the vault that is now live', async () => {
    // An archive with no live record beside it is not a state the app can
    // reach today, which is exactly why it is worth pinning: swapping in an
    // absent record would leave the archive holding the vault that is now
    // open, and the lock screen offering to put back what is already there.
    store.set('vault', new Map([['previous', mine]]))

    expect(await undoRestore(mine)).toEqual(mine)
    expect(await loadVault()).toEqual(mine)
    expect(await loadArchivedVault()).toBeUndefined()
  })

  it('does nothing when no restore was ever made', async () => {
    await saveVault(mine)

    expect(await undoRestore(mine)).toBeUndefined()
    expect(await loadVault()).toEqual(mine)
  })

  it('leaves nothing set aside when the vault is deleted', async () => {
    // "Delete vault & start over" has to mean it. An archive that survived
    // would put a whole encrypted vault — and a lock screen offering to open
    // it — in front of someone who just erased everything.
    await saveVault(mine)
    await restoreVault(theirs)
    await savePracticeMeta({ createdAt: t0, practiceCount: 3, lastPracticedAt: t0 + DAY })

    await deleteVault()

    expect(await loadVault()).toBeUndefined()
    expect(await loadArchivedVault()).toBeUndefined()
    expect(await loadPracticeMeta()).toBeUndefined()
  })

  it('keeps only the most recently replaced vault', async () => {
    // Two restores in a row: the first vault is gone for good. That is the
    // retention the ruling asked for — one slot, overwritten by the next
    // restore — and the reason the undo is offered on the lock screen where a
    // wrong restore is noticed, rather than saved up for later.
    const third = vaultRecord('salt-third', t0 + 2 * DAY)
    await saveVault(mine)
    await restoreVault(theirs)
    await restoreVault(third)

    expect(await undoRestore(theirs)).toEqual(theirs)
  })
})
