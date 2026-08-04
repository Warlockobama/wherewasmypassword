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
      // Every `abort` in `db.ts` is reached before that transaction has issued a
      // write, so there is nothing for a real rollback to undo and a no-op is
      // enough for what the tests below check: that the records on disk did not
      // move. It does not stand in for the whole of `abort` — a real one also
      // rejects `tx.done`, which is why `db.ts` swallows that rejection, and
      // nothing here would notice if it stopped.
      abort: () => {},
    }),
  }),
}))

const {
  restoreVault,
  deleteVault,
  loadArchivedVault,
  loadPracticeMeta,
  loadVault,
  loadVaultSettings,
  savePracticeMeta,
  saveVault,
  saveVaultSettings,
  undoRestore,
  VaultAlreadyExistsError,
  VaultSupersededError,
} = await import('./db.ts')

/**
 * `restoreVault`'s authorisation hook, satisfied.
 *
 * The hook exists so that no caller can reach the write without saying
 * something about it (`decisions/0019`); what it is actually asked in the app
 * is the restore gate, tested against real Argon2id in `vault/restore.test.ts`.
 * These tests are about the archive machinery underneath, so they say yes and
 * get out of the way — except where the refusal itself is the subject.
 */
const allowed = () => {}

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
 * What a write of the vault record is allowed to land on.
 *
 * Two different questions, and the second one is `decisions/0020`. A save that
 * keeps the existing key asks "is the vault still keyed as I found it" — a salt
 * comparison. A save that *creates* a vault cannot ask that: it has a brand-new
 * salt by definition, so every record already on disk looks like somebody
 * else's and there is nothing to compare against. It has to ask whether there is
 * a record at all.
 *
 * Without that, two tabs of a fresh install each finishing their own memory
 * house ended with the second writing over the first — no archive, no undo,
 * nothing to offer back.
 *
 * The refusals are what this is for, and each asserts that what was on disk is
 * still on disk. The two that let a write through are here as the other half of
 * the pair: a guard that refused everything would pass every negative test and
 * break onboarding and every credential save.
 */
describe('what a vault write may land on', () => {
  const mine = vaultRecord('salt-mine', t0)
  const theirs = vaultRecord('salt-theirs', t0 + DAY)

  it('refuses a create when this browser already has a vault', async () => {
    await saveVault(mine)

    await expect(saveVault(theirs, 'no-vault')).rejects.toBeInstanceOf(VaultAlreadyExistsError)

    // The first vault exactly where it was. `toBe` because this store hands
    // back the object it was given: real IndexedDB structured-clones, so
    // identity is a property of the stand-in rather than of production — what
    // it buys is that a rewrite with equal contents would still be caught here.
    expect(await loadVault()).toBe(mine)
  })

  it('keeps nothing aside when it refuses, because it displaced nothing', async () => {
    // A refused create is not a quiet restore. `saveVault` touches the archive
    // slot on no path at all today, so this is a forward pin rather than a
    // demonstration: the day someone reaches for "archive it instead" (which
    // `0020` considered and James turned down) it should fail here first.
    await saveVault(mine)
    await restoreVault(theirs, allowed)

    await expect(saveVault(vaultRecord('salt-third', t0), 'no-vault')).rejects.toBeInstanceOf(
      VaultAlreadyExistsError,
    )

    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toEqual(mine)
  })

  it('lets a create through on a browser with no vault', async () => {
    // The ordinary first run, and the case after "Delete vault & start over".
    await saveVault(mine, 'no-vault')

    expect(await loadVault()).toEqual(mine)
  })

  it('refuses an update whose key moved under it', async () => {
    // Another copy of the UI changed the passphrase while this caller held the
    // record it read a minute ago. Letting the write through would put the
    // vault back under the phrase the user was just told is dead.
    await saveVault(mine)
    const reKeyed = vaultRecord('salt-re-keyed', t0 + DAY)
    await saveVault(reKeyed)

    await expect(saveVault(vaultRecord('salt-mine', t0 + 2 * DAY), mine)).rejects.toBeInstanceOf(
      VaultSupersededError,
    )

    expect(await loadVault()).toBe(reKeyed)
  })

  it('lets an update through while the key is still the one it read', async () => {
    // A credential saved in another tab rewrites the ciphertext of the same
    // vault. That is an ordinary race over contents — last write wins, as it
    // always has — and not what the check is for.
    await saveVault(mine)
    const edited = vaultRecord('salt-mine', t0 + DAY)

    await saveVault(edited, mine)

    expect(await loadVault()).toEqual(edited)
  })

  it('refuses an update onto an empty slot rather than resurrecting the vault', async () => {
    // "Delete vault & start over" in one tab leaves any other unlocked tab
    // holding a key to a record that is gone. Its next credential save would
    // put that whole vault back — its credentials, and the phrase the user was
    // walking away from — on a device they had just cleared. And with
    // `decisions/0020` in place the resurrected vault then refuses the tutorial
    // they went to the welcome screen to start.
    await saveVault(mine)
    await deleteVault()

    await expect(saveVault(vaultRecord('salt-mine', t0 + DAY), mine)).rejects.toBeInstanceOf(
      VaultSupersededError,
    )

    expect(await loadVault()).toBeUndefined()
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

    await restoreVault(theirs, allowed)

    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toEqual(mine)
  })

  it('puts back the vault the restore replaced', async () => {
    await saveVault(mine)
    await restoreVault(theirs, allowed)
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
    await restoreVault(theirs, allowed)

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
    await restoreVault(theirs, allowed)

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
    await restoreVault(theirs, allowed)
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
    await restoreVault(theirs, allowed)
    await savePracticeMeta({ createdAt: t0, practiceCount: 3, lastPracticedAt: t0 + DAY })

    await deleteVault()

    expect(await loadVault()).toBeUndefined()
    expect(await loadArchivedVault()).toBeUndefined()
    expect(await loadPracticeMeta()).toBeUndefined()
  })

  it('writes nothing when the restore is not authorised', async () => {
    // The hook runs inside the transaction and before either write, so a
    // refusal has to leave both slots untouched — not "leave the archive
    // written and the vault not", which is the half-restore that would destroy
    // a vault while refusing to replace it.
    await saveVault(mine)

    await expect(
      restoreVault(theirs, () => {
        throw new Error('not authorised')
      }),
    ).rejects.toThrow('not authorised')

    expect(await loadVault()).toEqual(mine)
    expect(await loadArchivedVault()).toBeUndefined()
  })

  it('refuses a hook that answers asynchronously, rather than trusting it', async () => {
    // `authorize` is typed to return nothing, and TypeScript accepts an `async`
    // function anyway — a promise is assignable to a `void` return. Held that
    // way, a refusal becomes a rejected promise nobody awaits: it surfaces as an
    // unhandled error somewhere else and the writes go ahead as though the
    // restore had been approved. The one safe reading of "I cannot tell whether
    // this was authorised" is no.
    //
    // The hook here resolves rather than rejects, only so that the test does
    // not leave an orphaned rejection of its own behind. What is being pinned
    // is that an `async` hook is refused *at all* — the shape is what makes the
    // refusal unreachable, not the particular answer it would have given.
    await saveVault(mine)
    const asAsync = async () => {}

    await expect(
      restoreVault(theirs, asAsync as unknown as (live: StoredVault | undefined) => void),
    ).rejects.toBeInstanceOf(TypeError)

    expect(await loadVault()).toEqual(mine)
    expect(await loadArchivedVault()).toBeUndefined()
  })

  it('shows the hook the record it is about to displace', async () => {
    // What the gate has to judge is the vault actually being replaced, not the
    // one the caller read a second ago — that is the whole reason this is a
    // callback rather than a value compared beforehand.
    await saveVault(mine)
    const seen: (StoredVault | undefined)[] = []

    await restoreVault(theirs, (live) => {
      seen.push(live)
    })
    await restoreVault(mine, (live) => {
      seen.push(live)
    })

    expect(seen).toEqual([mine, theirs])
  })

  it('tells the hook when there is no vault to replace', async () => {
    // A first-run restore displaces nobody, and the gate leans on being able to
    // see that: it is what lets the welcome screen restore without an Argon2id
    // wait in front of the unlock that follows it.
    let seen: StoredVault | undefined | 'never called' = 'never called'

    await restoreVault(theirs, (live) => {
      seen = live
    })

    expect(seen).toBeUndefined()
    expect(await loadVault()).toEqual(theirs)
    expect(await loadArchivedVault()).toBeUndefined()
  })

  it('keeps only the most recently replaced vault', async () => {
    // Two restores in a row: the first vault is gone for good. That is the
    // retention the ruling asked for — one slot, overwritten by the next
    // restore — and the reason the undo is offered on the lock screen where a
    // wrong restore is noticed, rather than saved up for later.
    //
    // `decisions/0019` looked at this again and left it: what it changed is who
    // can spend the slot. The second restore here is authorised, and under the
    // default gate authorising it means opening the vault the first restore
    // installed. What used to be free is not.
    const third = vaultRecord('salt-third', t0 + 2 * DAY)
    await saveVault(mine)
    await restoreVault(theirs, allowed)
    await restoreVault(third, allowed)

    expect(await undoRestore(theirs)).toEqual(theirs)
  })
})

/**
 * The preferences that have to be readable with the vault locked
 * (`decisions/0019`). What is worth pinning is where they fail *to*: a security
 * gate whose stored value could be turned off by scribbling on the record would
 * be cheaper to defeat than the thing it guards.
 */
describe('device settings', () => {
  it('answers with the strictest gate when nothing has been stored', async () => {
    expect(await loadVaultSettings()).toEqual({ restoreGate: 'both' })
  })

  it('round-trips a gate the user chose', async () => {
    await saveVaultSettings({ restoreGate: 'off' })

    expect(await loadVaultSettings()).toEqual({ restoreGate: 'off' })
  })

  it('falls back to the strictest gate for a record it does not recognise', async () => {
    for (const rubbish of [null, 7, 'off', {}, { restoreGate: 'nonsense' }, { restoreGate: null }]) {
      store.set('meta', new Map([['settings', rubbish]]))

      expect(await loadVaultSettings()).toEqual({ restoreGate: 'both' })
    }
  })

  it('keeps the practice schedule and the settings apart in the one store', async () => {
    await savePracticeMeta({ createdAt: t0, practiceCount: 3, lastPracticedAt: t0 + DAY })
    await saveVaultSettings({ restoreGate: 'incoming' })

    expect(await loadPracticeMeta()).toEqual({
      createdAt: t0,
      practiceCount: 3,
      lastPracticedAt: t0 + DAY,
    })
    expect(await loadVaultSettings()).toEqual({ restoreGate: 'incoming' })
  })

  it('survives deleting the vault', async () => {
    // "Delete vault & start over" is about a vault. Clearing this with it would
    // silently put a gate back that the user had turned off, on the very screen
    // they would next meet — and there is no vault left for it to protect.
    await saveVaultSettings({ restoreGate: 'off' })
    await saveVault(vaultRecord('salt-mine', t0))

    await deleteVault()

    expect(await loadVault()).toBeUndefined()
    expect(await loadVaultSettings()).toEqual({ restoreGate: 'off' })
  })
})
