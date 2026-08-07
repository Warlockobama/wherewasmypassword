// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The last screen of onboarding, rendered.
 *
 * What it is here to seal is one refusal. `decisions/0020`: two tabs of a fresh
 * install, each walking its own memory house, and the second to finish wrote its
 * vault straight over the first — not set aside, *gone*, with no archive and
 * nothing for the lock screen to offer back. `seal.test.ts` covers the guard at
 * the `rekeyVault` seam and `db.test.ts` covers the precondition itself; what
 * neither can see is the screen. That half of `0020` shipped reviewed rather
 * than tested — its own resolution says so — including the deliberate absence of
 * a "Try again" on the refusal panel, which is the difference between a lost
 * walk and a lost vault.
 *
 * Real all the way down except the stretching: the real `seal.ts`, the real
 * `db.ts` over an in-memory `idb`, real AES-GCM and real header binding, so the
 * vault this screen writes is one the fixtures' own key can open. `deriveKey` is
 * swapped for something instant — and, unlike the lock screen's, holdable, so a
 * test can put a vault on disk *while* this one is deriving. That ordering is
 * the one `0020` is actually about, and only a check inside the write
 * transaction catches it.
 */

vi.mock('idb', async () => (await import('../test/fake-idb.ts')).fakeIdbModule())

/** Resolved unless a test is holding the stretch open; see `holdTheDerive`. */
let stretching: Promise<void>
vi.mock('../crypto/kdf.ts', async (importOriginal) => {
  const { fakeDeriveKey } = await import('../test/fake-kdf.ts')
  return {
    ...(await importOriginal<typeof import('../crypto/kdf.ts')>()),
    deriveKey: async (phrase: string, salt: Uint8Array) => {
      await stretching
      return fakeDeriveKey(phrase, salt)
    },
  }
})

import CreateVault from './CreateVault.tsx'
import { decryptVault, fromBase64, type Association } from '../crypto/vault.ts'
import type { PracticeMeta, StoredVault } from '../storage/db.ts'
import { peekFakeDb, resetFakeDb, seedFakeDb } from '../test/fake-idb.ts'
import { sealedUnder } from '../test/vault-fixtures.ts'

const PHRASE = 'trellis marigold cobble lantern thistle harbour'
const OTHER_TAB_PHRASE = 'kettle sundial pebble awning ribbon walnut'

const ASSOCIATIONS: Association[] = [
  { locusId: 'mailbox', word: 'trellis', imagery: 'a trellis bursting out of the mailbox' },
]

const liveOnDisk = () => peekFakeDb<StoredVault>('vault', 'primary')
const asideOnDisk = () => peekFakeDb<StoredVault>('vault', 'previous')
const scheduleOnDisk = () => peekFakeDb<PracticeMeta>('meta', 'practice')

/**
 * Stop `deriveKey` returning until the test says so, so the window between
 * "this tab started sealing" and "this tab writes" can be widened to whatever a
 * second tab needs. `fail` is the other half: the ordinary, non-`0020` failure.
 */
function holdTheDerive() {
  let release!: () => void
  let fail!: (err: Error) => void
  stretching = new Promise<void>((resolve, reject) => {
    release = resolve
    fail = reject
  })
  return { release, fail }
}

function show(props: Partial<Parameters<typeof CreateVault>[0]> = {}) {
  return render(
    <CreateVault
      words={PHRASE.split(' ')}
      associations={ASSOCIATIONS}
      onDone={props.onDone ?? vi.fn()}
      onExistingVault={props.onExistingVault ?? vi.fn(async () => {})}
    />,
  )
}

const seal = () =>
  fireEvent.click(screen.getByRole('button', { name: /Create my encrypted vault/ }))

/** Put the other tab's finished vault in the slot before this one gets there. */
async function anotherTabGotHereFirst(): Promise<StoredVault> {
  const theirs = await sealedUnder(OTHER_TAB_PHRASE, { createdAt: Date.parse('2026-03-01') })
  seedFakeDb('vault', 'primary', theirs)
  return theirs
}

/** Walk this screen to the refusal panel, returning the vault it refused over. */
async function reachTheRefusal(props: Partial<Parameters<typeof CreateVault>[0]> = {}) {
  const theirs = await anotherTabGotHereFirst()
  show(props)
  seal()
  await screen.findByText(/This browser already has a vault/)
  return theirs
}

const readBack = (record: StoredVault, rawKey: Uint8Array) =>
  decryptVault(
    rawKey,
    { iv: fromBase64(record.iv), ciphertext: fromBase64(record.ciphertext) },
    record,
  )

beforeEach(() => {
  resetFakeDb()
  stretching = Promise.resolve()
})

afterEach(() => {
  cleanup()
  // jsdom has no StorageManager, so the persistence test defines one; leaving it
  // behind would silently change what every later test's create path runs.
  delete (navigator as { storage?: unknown }).storage
})

describe('sealing the first vault on a device', () => {
  it('hands the caller a key that opens the record that landed on disk', async () => {
    const onDone = vi.fn()
    show({ onDone })

    seal()

    expect(await screen.findByText(/Your vault is sealed/)).toBeTruthy()
    // The backup offer is the point of this pause: nothing moves on until the
    // user has had the chance to take a copy of a vault only they can open.
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Enter the vault/ }))

    expect(onDone).toHaveBeenCalledTimes(1)
    const [rawKey, data, stored] = onDone.mock.calls[0]
    expect(stored).toEqual(liveOnDisk())
    // The three things this screen hands over have to agree with each other, or
    // the user walks into an unlocked session over a vault they cannot reopen.
    expect(await readBack(stored, rawKey)).toEqual(data)
    expect(data.words).toEqual(PHRASE.split(' '))
    expect(data.associations).toEqual(ASSOCIATIONS)
  })

  it('starts the practice schedule for the vault it just sealed', async () => {
    show()

    seal()
    await screen.findByText(/Your vault is sealed/)

    await waitFor(() => expect(scheduleOnDisk()).toBeTruthy())
    expect(scheduleOnDisk()!.practiceCount).toBe(0)
  })

  it('does not call a sealed vault a failure when only the housekeeping fails', async () => {
    // The seal is irreversible and the phrase behind it is now the only way in,
    // so nothing after it may reach the error screen — that screen offers "Try
    // again", the retry is refused by this tab's own vault, and the panel below
    // would tell the user the phrase they just learned guards nothing. It would
    // be the exact opposite of the truth, at the moment a backup matters most.
    let persistAsked = false
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persist: () => {
          persistAsked = true
          return Promise.reject(new Error('no quota manager here'))
        },
      },
    })
    show()

    seal()
    await screen.findByText(/Your vault is sealed/)

    await waitFor(() => expect(persistAsked).toBe(true))
    // A macrotask: the rejection would reach the error screen within microtasks,
    // so asserting straight after the call would pass either way.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText(/Your vault is sealed/)).toBeTruthy()
    expect(screen.queryByText(/Something went wrong/)).toBeNull()
  })

  it('offers to try again when the seal fails for an ordinary reason', async () => {
    // The contrast that gives the refusal panel below its meaning: an error that
    // is not "there is already a vault here" leaves nothing behind, so retrying
    // is exactly the right offer.
    const hold = holdTheDerive()
    show()
    seal()
    await screen.findByText(/Stretching your passphrase/)

    hold.fail(new Error('the key stretcher fell over'))

    expect(await screen.findByText(/the key stretcher fell over/)).toBeTruthy()
    expect(liveOnDisk()).toBeUndefined()

    stretching = Promise.resolve()
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))

    expect(await screen.findByText(/Your vault is sealed/)).toBeTruthy()
  })
})

describe('a vault already on this device (`decisions/0020`)', () => {
  it('refuses to seal over it, and leaves it byte for byte where it was', async () => {
    const onDone = vi.fn()
    const theirs = await reachTheRefusal({ onDone })

    expect(liveOnDisk()).toEqual(theirs)
    // Nothing was set aside either, which is the whole reason this path had to
    // refuse rather than archive: there is no undo offer behind it to catch a
    // displaced vault, so "displaced" would have meant destroyed.
    expect(asideOnDisk()).toBeUndefined()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('refuses a vault that lands while this tab is still stretching its key', async () => {
    // The ordering the guard exists for, and the one an "is the slot empty?"
    // check made before the derive would sail straight past: the other tab
    // finishes during the seconds of Argon2id this screen spends on its own.
    const hold = holdTheDerive()
    show()
    seal()
    await screen.findByText(/Stretching your passphrase/)

    const theirs = await anotherTabGotHereFirst()
    hold.release()

    expect(await screen.findByText(/This browser already has a vault/)).toBeTruthy()
    expect(liveOnDisk()).toEqual(theirs)
  })

  it('offers no way to try again — a second attempt is the thing that must not happen', async () => {
    await reachTheRefusal()

    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull()
    // And no other way back to the create either: the only button on this panel
    // is the one that leads to the vault that does exist.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Go to the vault on this device/ })).toBeTruthy()
  })

  it('leaves the other tab’s practice schedule alone', async () => {
    // Resetting the ladder for a vault this screen did not create is a smaller
    // version of the same damage, and nothing would put it back — the other tab
    // is the only thing that knows when its user last practised.
    const theirs: PracticeMeta = {
      createdAt: Date.parse('2026-03-01'),
      practiceCount: 9,
      lastPracticedAt: Date.parse('2026-03-20'),
    }
    seedFakeDb('meta', 'practice', theirs)

    await reachTheRefusal()

    expect(scheduleOnDisk()).toEqual(theirs)
  })

  it('sends the user to the vault that does exist', async () => {
    const onExistingVault = vi.fn(async () => {})
    const theirs = await reachTheRefusal({ onExistingVault })

    fireEvent.click(screen.getByRole('button', { name: /Go to the vault on this device/ }))

    await waitFor(() => expect(onExistingVault).toHaveBeenCalledTimes(1))
    expect(liveOnDisk()).toEqual(theirs)
  })

  it('says so when that vault cannot be read, instead of leaving a dead button', async () => {
    // Leaving is a read, and the caller has already thrown away this tab's walk
    // by the time it fails. A rejection that went nowhere would leave a button
    // that silently does nothing on a screen with nothing else on it.
    const onExistingVault = vi.fn(() => Promise.reject(new Error('the database would not open')))
    await reachTheRefusal({ onExistingVault })

    fireEvent.click(screen.getByRole('button', { name: /Go to the vault on this device/ }))

    expect(await screen.findByText(/the database would not open/)).toBeTruthy()
    const button = screen.getByRole('button', { name: /Go to the vault on this device/ })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })
})
