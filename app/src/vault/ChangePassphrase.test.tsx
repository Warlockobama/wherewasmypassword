// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Changing the master passphrase, driven through the screen.
 *
 * This is the one flow that re-encrypts everything the user owns, and it had no
 * test at all. The pieces under it do: `seal.ts` proves `rekeyVault` refuses a
 * stale record, `db.ts` proves the precondition, `crypto.test.ts` proves the
 * round trip. What none of them can say is anything about the screen that
 * decides *when* to call them — that it refuses to start without the phrase
 * being retired (`decisions/0012`), that after the seal the record on disk is
 * genuinely under a new key rather than the same vault with a new date on it,
 * that every credential survived the trip, and that the copy set aside — still
 * openable with the phrase that has just been burned — is gone.
 *
 * Real all the way down except the stretching and the two training screens:
 * real AES-GCM, real header binding, the real `seal.ts` and the real `db.ts`
 * over an in-memory `idb`. Only `deriveKey` is swapped for something instant,
 * as in `LockScreen.test.tsx` — 256 MiB of Argon2id per seal would make this
 * file take minutes.
 */

vi.mock('idb', async () => (await import('../test/fake-idb.ts')).fakeIdbModule())
vi.mock('../crypto/kdf.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../crypto/kdf.ts')>()),
  deriveKey: (await import('../test/fake-kdf.ts')).fakeDeriveKey,
}))

/**
 * The dice roll and the walk through the house are stubbed; nothing else is.
 *
 * They decide nothing this file is about — the real ones are driven end to end
 * by `scripts/journey-check.mjs`, and here they would be six loci of typing
 * behind a 550ms animation each. The stubs also make the new phrase a phrase
 * this test *knows*, which is what lets the assertions below be "the record on
 * disk opens with these exact words and no longer with the old ones" rather
 * than the much weaker "it changed".
 */
vi.mock('../training/PhraseGenerator.tsx', () => ({
  default: ({ onComplete }: { onComplete: (words: string[]) => void }) => (
    <button onClick={() => onComplete(NEW_PHRASE.split(' '))}>stub: choose the new words</button>
  ),
}))
vi.mock('../training/PlacementJourney.tsx', () => ({
  // Built from the `words` prop rather than from a constant, so the placement
  // step is shown the phrase the generator produced and the associations that
  // reach the vault are the ones made from it.
  default: ({ words, onComplete }: { words: string[]; onComplete: (a: Association[]) => void }) => (
    <button
      onClick={() =>
        onComplete(
          words.map((word, i) => ({ locusId: `locus-${i}`, word, imagery: `${word}, enormous` })),
        )
      }
    >
      stub: place them in the house
    </button>
  ),
}))

import ChangePassphrase from './ChangePassphrase.tsx'
import type { Credential } from '../credentials/types.ts'
import { decryptVault, fromBase64, type Association, type VaultData } from '../crypto/vault.ts'
import type { PracticeMeta, StoredVault } from '../storage/db.ts'
import { fakeDeriveKey } from '../test/fake-kdf.ts'
import { failNextFakeDbWrite, peekFakeDb, resetFakeDb, seedFakeDb } from '../test/fake-idb.ts'
import { sealedUnder } from '../test/vault-fixtures.ts'

const OLD_PHRASE = 'mailbox doormat closet fireplace oven fridge'
const NEW_PHRASE = 'zeppelin walrus lantern anchor cactus trombone'

/** The whole point of the flow: these have to come out the far side unchanged. */
const ENTRIES: Credential[] = [
  {
    id: 'cred-1',
    label: 'GitHub',
    url: 'https://github.com',
    username: 'james',
    password: 'correct horse battery staple',
    notes: 'recovery codes in the safe',
    createdAt: Date.parse('2026-02-02'),
    updatedAt: Date.parse('2026-02-03'),
  },
  {
    id: 'cred-2',
    label: 'Work email',
    url: 'https://mail.example.com',
    username: 'j.lerud@example.com',
    password: 'a different password entirely',
    notes: '',
    createdAt: Date.parse('2026-02-04'),
    updatedAt: Date.parse('2026-02-04'),
  },
]

let stored: StoredVault
let rawKey: Uint8Array
let data: VaultData

const liveOnDisk = () => peekFakeDb<StoredVault>('vault', 'primary')
const asideOnDisk = () => peekFakeDb<StoredVault>('vault', 'previous')

/**
 * Open a record the way the lock screen would: derive from the phrase and the
 * record's own salt, then decrypt against the header stored beside it. Throws
 * `WrongPassphraseError` when the phrase is not the one the record is under,
 * which is the only honest way to assert "this key no longer opens it".
 */
async function openWith(phrase: string, record: StoredVault): Promise<VaultData> {
  const key = await fakeDeriveKey(phrase, fromBase64(record.salt))
  return decryptVault(
    key,
    { iv: fromBase64(record.iv), ciphertext: fromBase64(record.ciphertext) },
    record,
  )
}

beforeEach(async () => {
  resetFakeDb()
  stored = await sealedUnder(OLD_PHRASE, {
    entries: ENTRIES,
    createdAt: Date.parse('2026-02-01'),
  })
  seedFakeDb('vault', 'primary', stored)
  // The props the unlocked screen hands over: the key it derived at unlock and
  // the plaintext it decrypted, read back out of the fixture rather than
  // written by hand so the two cannot drift apart.
  rawKey = await fakeDeriveKey(OLD_PHRASE, fromBase64(stored.salt))
  data = await openWith(OLD_PHRASE, stored)
})

afterEach(cleanup)

function show(props: { onDone?: () => void; onCancel?: () => void } = {}) {
  return render(
    <ChangePassphrase
      data={data}
      stored={stored}
      rawKey={rawKey}
      onDone={props.onDone ?? vi.fn()}
      onCancel={props.onCancel ?? vi.fn()}
    />,
  )
}

/** Type into the confirm gate and press its button. */
function confirmWith(phrase: string) {
  fireEvent.change(screen.getByPlaceholderText(/your current passphrase/), {
    target: { value: phrase },
  })
  fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }))
}

/**
 * Walk from the confirm gate to a sealed vault by the skip route.
 *
 * "Skip the walks, seal it anyway" is deliberately the route every seal test
 * below takes. It reaches exactly the same `seal()` the mastery test does, and
 * the quiz-and-mastery route through it is already driven for real by
 * `scripts/journey-check.mjs` — pushing it through here would buy nothing but
 * minutes of typing simulated into `QuizWalk`.
 */
async function sealViaSkip() {
  confirmWith(OLD_PHRASE)
  fireEvent.click(await screen.findByRole('button', { name: /choose the new words/ }))
  fireEvent.click(await screen.findByRole('button', { name: /place them in the house/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Skip the walks, seal it anyway/ }))
  await screen.findByText(/Re-encrypted/)
}

describe('the gate on the phrase being retired (`decisions/0012`)', () => {
  it('will not start the flow until the current phrase is typed', () => {
    show()

    // The vault is already open, so this proves nothing to the cryptography.
    // What it stops is someone at an unattended unlocked screen turning a
    // one-click flow into a permanent lockout of the owner.
    expect(screen.getByRole('button', { name: /^Continue$/ })).toHaveProperty('disabled', true)
  })

  it('refuses a phrase that is not the one this vault is locked with, in its own words', async () => {
    show()

    confirmWith('not the right words at all')

    expect(
      await screen.findByText('That is not the phrase this vault is locked with.'),
    ).toBeTruthy()
    // Refused, not merely complained at: the flow must still be on the gate,
    // with no new phrase rolled and nothing written.
    expect(screen.getByPlaceholderText(/your current passphrase/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /choose the new words/ })).toBeNull()
    expect(liveOnDisk()).toEqual(stored)
  })

  it('starts the flow for the phrase that does open it, and still writes nothing yet', async () => {
    show()

    confirmWith(OLD_PHRASE)

    expect(await screen.findByRole('button', { name: /choose the new words/ })).toBeTruthy()
    // Passing the gate is permission to begin, not a re-key. Everything up to
    // the seal has to leave the vault exactly as it was, because the user can
    // still walk away at the gate screen.
    expect(liveOnDisk()).toEqual(stored)
  })
})

describe('sealing the vault under the new phrase', () => {
  it('leaves a record that opens with the new phrase and no longer with the old', async () => {
    show()

    await sealViaSkip()

    const sealed = liveOnDisk()!
    expect(sealed).not.toEqual(stored)
    const reopened = await openWith(NEW_PHRASE, sealed)
    expect(reopened.words).toEqual(NEW_PHRASE.split(' '))
    // The retired phrase failing is the whole promise of the flow. Without this
    // the test above would pass just as happily for a vault that was left under
    // both keys, or under the old one with new words written inside it.
    await expect(openWith(OLD_PHRASE, sealed)).rejects.toThrow(/wrong passphrase/i)
  })

  it('brings every credential across untouched', async () => {
    show()

    await sealViaSkip()

    const reopened = await openWith(NEW_PHRASE, liveOnDisk()!)
    // Byte for byte, including the timestamps. A re-key that dropped, reordered
    // or restamped an entry would be silent data loss discovered weeks later,
    // when the user next needed that password.
    expect(reopened.entries).toEqual(ENTRIES)
    // Same vault, new lock: the birthday is carried, so the age the unlocked
    // screen reports does not reset every time the phrase changes.
    expect(reopened.createdAt).toBe(stored.createdAt)
    expect(liveOnDisk()!.createdAt).toBe(stored.createdAt)
    // And the imagery the placement step produced is what got sealed, so the
    // house the user just walked matches the phrase the vault now needs.
    expect(reopened.associations.map((a) => a.word)).toEqual(NEW_PHRASE.split(' '))
  })

  it('deletes the vault set aside, which the retired phrase still opens', async () => {
    // `decisions/0012`: the archive is ciphertext under the phrase being burned.
    // Leaving it hands anyone with the profile directory exactly the vault the
    // user was moving away from — and since `decisions/0016` the lock screen
    // would cheerfully offer to put it back.
    const archived = await sealedUnder(OLD_PHRASE, { createdAt: Date.parse('2026-01-01') })
    seedFakeDb('vault', 'previous', archived)
    show()

    await sealViaSkip()

    // The deletion is deliberately after the seal and in its own `catch`, so it
    // lands a tick later than the screen the user is looking at.
    await waitFor(() => expect(asideOnDisk()).toBeUndefined())
  })

  it('starts the practice ladder again, because the memory it graded is gone', async () => {
    seedFakeDb('meta', 'practice', {
      createdAt: Date.parse('2026-01-01'),
      practiceCount: 40,
      lastPracticedAt: Date.parse('2026-02-05'),
    })
    show()

    await sealViaSkip()

    // Carrying the old count forward would tell the scheduler the user has
    // mastered a phrase they were handed ninety seconds ago, and the next
    // reminder would be months away.
    await waitFor(() => {
      const meta = peekFakeDb<PracticeMeta>('meta', 'practice')!
      expect(meta.practiceCount).toBe(0)
      expect(meta.lastPracticedAt).toBeNull()
    })
  })

  it('wipes the key it was opened with, once the record it belonged to is gone', async () => {
    show()

    await sealViaSkip()

    // Nothing on disk answers to these bytes any more, so leaving them in the
    // heap of a long-lived tab is exposure with no purpose.
    expect([...rawKey].every((b) => b === 0)).toBe(true)
  })
})

describe('handing the vault back', () => {
  it('calls onDone only once the seal has landed, with the new key, data and record', async () => {
    const onDone = vi.fn()
    show({ onDone })

    confirmWith(OLD_PHRASE)
    fireEvent.click(await screen.findByRole('button', { name: /choose the new words/ }))
    fireEvent.click(await screen.findByRole('button', { name: /place them in the house/ }))
    // Standing on the gate screen with a phrase generated and placed is not a
    // changed vault. If `onDone` fired here the caller would swap in a key that
    // opens nothing.
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Skip the walks, seal it anyway/ }))
    await screen.findByText(/Re-encrypted/)
    // The done screen also offers a fresh backup download, so it stays put
    // until the user leaves it.
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Back to the vault/ }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    const [nextKey, nextData, nextStored] = onDone.mock.calls[0] as [Uint8Array, VaultData, StoredVault]
    // The caller keeps running on whatever it is handed here, so all three have
    // to be the new ones: a stale record would make the next credential save
    // fail the precondition, and a stale key would make it write ciphertext the
    // new phrase cannot open.
    expect(nextStored).toEqual(liveOnDisk())
    expect(nextData.words).toEqual(NEW_PHRASE.split(' '))
    expect(nextData.entries).toEqual(ENTRIES)
    expect(await openWith(NEW_PHRASE, nextStored)).toEqual(nextData)
    expect([...nextKey].some((b) => b !== 0)).toBe(true)
  })

  it('changes nothing when the user backs out at the gate', async () => {
    const onCancel = vi.fn()
    const onDone = vi.fn()
    show({ onCancel, onDone })

    confirmWith(OLD_PHRASE)
    fireEvent.click(await screen.findByRole('button', { name: /choose the new words/ }))
    fireEvent.click(await screen.findByRole('button', { name: /place them in the house/ }))
    fireEvent.click(screen.getByRole('button', { name: /Cancel, keep my current phrase/ }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
    // Rolling and placing a phrase must not have touched the vault: the words
    // on the screen the user just abandoned open nothing.
    expect(liveOnDisk()).toEqual(stored)
  })
})

describe('when the vault moved underneath the flow (`decisions/0020`)', () => {
  it('refuses to write over a vault that is no longer the one on screen', async () => {
    show()
    confirmWith(OLD_PHRASE)
    fireEvent.click(await screen.findByRole('button', { name: /choose the new words/ }))
    fireEvent.click(await screen.findByRole('button', { name: /place them in the house/ }))

    // A second tab deleted the vault and restored another one during the
    // minutes this flow takes. Without the `{ replacing: stored }` precondition
    // the seal below would drop this screen's vault on top of it, destroying a
    // vault nobody asked to touch, with no archive to offer back.
    const somebodyElses = await sealedUnder('an entirely different vault phrase')
    seedFakeDb('vault', 'primary', somebodyElses)

    fireEvent.click(screen.getByRole('button', { name: /Skip the walks, seal it anyway/ }))

    expect(await screen.findByText(/re-encrypted somewhere else/)).toBeTruthy()
    expect(liveOnDisk()).toEqual(somebodyElses)
    // The refusal has to leave this screen's key alone, or backing out would
    // strand a user whose vault was never touched.
    expect([...rawKey].some((b) => b !== 0)).toBe(true)
  })

  it('does not tell the user their current phrase still opens a vault that was replaced', async () => {
    // The generic failure screen says "nothing was changed — your current
    // passphrase still opens the vault", which for this error is false: the
    // record it refers to is gone, replaced by one under a phrase this screen
    // has never seen. And the Try again beside it re-entered `seal` with the
    // same superseded record, so it failed identically, forever.
    show()
    confirmWith(OLD_PHRASE)
    fireEvent.click(await screen.findByRole('button', { name: /choose the new words/ }))
    fireEvent.click(await screen.findByRole('button', { name: /place them in the house/ }))
    seedFakeDb('vault', 'primary', await sealedUnder('an entirely different vault phrase'))
    fireEvent.click(screen.getByRole('button', { name: /Skip the walks, seal it anyway/ }))

    await screen.findByText(/re-encrypted somewhere else/)
    expect(screen.queryByText(/your current passphrase still opens the vault/)).toBeNull()
    expect(screen.getByText(/Lock and unlock to pick it up/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull()
    // The way out is still there.
    expect(screen.getByRole('button', { name: /Back to the vault/ })).toBeTruthy()
  })

  it('still offers a retry for a failure that really did change nothing', async () => {
    // The distinction is the point: an ordinary write failure leaves the vault
    // exactly where it was, and pressing Try again is the right thing to do.
    show()
    confirmWith(OLD_PHRASE)
    fireEvent.click(await screen.findByRole('button', { name: /choose the new words/ }))
    fireEvent.click(await screen.findByRole('button', { name: /place them in the house/ }))
    failNextFakeDbWrite('the disk said no')
    fireEvent.click(screen.getByRole('button', { name: /Skip the walks, seal it anyway/ }))

    expect(await screen.findByText(/the disk said no/)).toBeTruthy()
    expect(screen.getByText(/your current passphrase still opens the vault/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy()
  })
})
