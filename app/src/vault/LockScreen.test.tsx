// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The lock screen, rendered.
 *
 * Everything this screen does that matters is a *refusal*, and until now every
 * one of them was reviewed rather than tested: `decisions/0018` gave the undo a
 * passphrase gate and `0019` gave the restore two, and the only thing standing
 * behind either was that the code reads as though it does. The units below them
 * (`restore.ts`, `undo.ts`, `db.ts`) have tests; what nobody had checked was
 * that the screen *asks*, that it asks for the right one first, and that a
 * wrong answer leaves both vaults where they were.
 *
 * Real all the way down except the stretching: real AES-GCM, real header
 * binding, the real `db.ts` over an in-memory `idb`, the real `restore.ts` and
 * `undo.ts`. Only `deriveKey` is swapped for something instant — 256 MiB of
 * Argon2id per assertion would make this file take minutes.
 */

vi.mock('idb', async () => (await import('../test/fake-idb.ts')).fakeIdbModule())
vi.mock('../crypto/kdf.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../crypto/kdf.ts')>()),
  deriveKey: (await import('../test/fake-kdf.ts')).fakeDeriveKey,
}))
// The popup's parked key lives in `chrome.storage.session`, and there is no
// `chrome` here. Every path off this screen clears it; none of them is what
// these tests are about.
vi.mock('../popup/session.ts', () => ({
  clearPopupSession: vi.fn(async () => {}),
}))

import LockScreen from './LockScreen.tsx'
import { serializeBackup } from '../storage/backup.ts'
import type { StoredVault } from '../storage/db.ts'
import type { RestoreGate } from '../storage/settings.ts'
import { peekFakeDb, resetFakeDb, seedFakeDb } from '../test/fake-idb.ts'
import { sealedUnder } from '../test/vault-fixtures.ts'

const DEVICE_PHRASE = 'mailbox doormat closet fireplace oven fridge'
const BACKUP_PHRASE = 'zeppelin walrus lantern anchor cactus trombone'

let deviceVault: StoredVault
let backupVault: StoredVault

/** Put a vault on the fake disk as the live one, with a gate preference. */
function onDisk(live: StoredVault, gate: RestoreGate = 'both', archived?: StoredVault) {
  seedFakeDb('vault', 'primary', live)
  if (archived) seedFakeDb('vault', 'previous', archived)
  seedFakeDb('meta', 'settings', { restoreGate: gate })
}

const liveOnDisk = () => peekFakeDb<StoredVault>('vault', 'primary')
const asideOnDisk = () => peekFakeDb<StoredVault>('vault', 'previous')

/** Hand the screen's hidden file input a real backup file. */
async function chooseBackup(record: StoredVault) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  const file = new File([serializeBackup(record)], 'vault-2026-01-01.wwmp.json', {
    type: 'application/json',
  })
  fireEvent.change(input, { target: { files: [file] } })
  await screen.findByText(/This replaces the vault already on this device/)
}

/** Type into the panel's own passphrase box and press its button. */
async function answer(phrase: string, button: RegExp) {
  const fields = screen.getAllByPlaceholderText(/passphrase/)
  // The unlock form is always on screen above whichever panel is open, so the
  // panel's field is the last one.
  fireEvent.change(fields[fields.length - 1], { target: { value: phrase } })
  fireEvent.click(screen.getByRole('button', { name: button }))
}

beforeEach(async () => {
  resetFakeDb()
  deviceVault = await sealedUnder(DEVICE_PHRASE, { createdAt: Date.parse('2026-02-01') })
  backupVault = await sealedUnder(BACKUP_PHRASE, { createdAt: Date.parse('2026-01-01') })
})

afterEach(cleanup)

function show(live: StoredVault, props: Partial<Parameters<typeof LockScreen>[0]> = {}) {
  return render(
    <LockScreen
      stored={live}
      practiceDue={false}
      onUnlock={props.onUnlock ?? vi.fn()}
      onRestored={props.onRestored ?? vi.fn()}
    />,
  )
}

describe('unlocking', () => {
  it('refuses a phrase that does not open the vault, and says which walk to take', async () => {
    onDisk(deviceVault)
    const onUnlock = vi.fn()
    show(deviceVault, { onUnlock })

    fireEvent.change(screen.getByPlaceholderText(/your passphrase/), {
      target: { value: 'not the right words at all' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Unlock$/ }))

    expect(await screen.findByText(/start at the mailbox/)).toBeTruthy()
    expect(onUnlock).not.toHaveBeenCalled()
  })

  it('hands the caller the key and the plaintext for the right phrase', async () => {
    onDisk(deviceVault)
    const onUnlock = vi.fn()
    show(deviceVault, { onUnlock })

    fireEvent.change(screen.getByPlaceholderText(/your passphrase/), {
      target: { value: DEVICE_PHRASE },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Unlock$/ }))

    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1))
    const [rawKey, data] = onUnlock.mock.calls[0]
    expect(rawKey).toBeInstanceOf(Uint8Array)
    expect(data.words).toEqual(DEVICE_PHRASE.split(' '))
  })

  it('opens the vault that is on disk now, not the one this screen was handed', async () => {
    // `App` reads the vault once, at page load, and hands it down. So a
    // passphrase change anywhere else — another tab, or this tab before the
    // idle timer locked it — left this screen deriving against a record that is
    // no longer live: the phrase the user had just spent a gauntlet memorising
    // was rejected, and the phrase they had been told was retired opened the
    // vault, because the old record is still a self-consistent thing to
    // decrypt. Credentials from before the change, and every save refused.
    const rekeyed = await sealedUnder(BACKUP_PHRASE, { createdAt: Date.parse('2026-02-01') })
    onDisk(rekeyed)
    const onUnlock = vi.fn()
    // Mounted with the stale record, exactly as `App` would have.
    show(deviceVault, { onUnlock })

    fireEvent.change(screen.getByPlaceholderText(/your passphrase/), {
      target: { value: DEVICE_PHRASE },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Unlock$/ }))
    expect(await screen.findByText(/start at the mailbox/)).toBeTruthy()
    expect(onUnlock).not.toHaveBeenCalled()

    // And the phrase the vault on disk is actually under does open it.
    fireEvent.change(screen.getByPlaceholderText(/your passphrase/), {
      target: { value: BACKUP_PHRASE },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Unlock$/ }))

    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1))
    // The record handed back is the live one, so the next save writes against
    // the salt on disk rather than the one this screen mounted with.
    expect(onUnlock.mock.calls[0][2].salt).toBe(rekeyed.salt)
  })

  it('says so rather than opening a snapshot when the vault has been deleted', async () => {
    // Deleting from another copy of the UI broadcasts a lock, so this screen is
    // what the other tab lands on — holding a record that no longer exists.
    resetFakeDb()
    seedFakeDb('meta', 'settings', { restoreGate: 'both' })
    const onUnlock = vi.fn()
    show(deviceVault, { onUnlock })

    fireEvent.change(screen.getByPlaceholderText(/your passphrase/), {
      target: { value: DEVICE_PHRASE },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Unlock$/ }))

    expect(await screen.findByText(/no vault on this device any more/)).toBeTruthy()
    expect(onUnlock).not.toHaveBeenCalled()
  })
})

describe('the restore gate (`decisions/0019`)', () => {
  it('asks for the backup file’s passphrase first, and names it as the first of two', async () => {
    onDisk(deviceVault, 'both')
    show(deviceVault)
    await chooseBackup(backupVault)

    expect(screen.getByText(/First, the/)).toBeTruthy()
    expect(screen.getByPlaceholderText(/the backup file’s passphrase/)).toBeTruthy()
  })

  it('refuses a phrase that does not open the backup, and replaces nothing', async () => {
    onDisk(deviceVault, 'both')
    show(deviceVault)
    await chooseBackup(backupVault)

    await answer('a phrase that opens neither', /Replace my vault/)

    expect(await screen.findByText(/doesn’t open the backup file/)).toBeTruthy()
    expect(liveOnDisk()).toEqual(deviceVault)
    expect(asideOnDisk()).toBeUndefined()
  })

  it('asks for this device’s passphrase second, once the file is open', async () => {
    onDisk(deviceVault, 'both')
    show(deviceVault)
    await chooseBackup(backupVault)

    await answer(BACKUP_PHRASE, /Replace my vault/)

    expect(await screen.findByText(/That opens the backup/)).toBeTruthy()
    expect(screen.getByPlaceholderText(/this device’s passphrase/)).toBeTruthy()
    // Still nothing written: one of the two answers is not the gate.
    expect(liveOnDisk()).toEqual(deviceVault)
  })

  it('will not replace the vault for someone who cannot open the one being pushed aside', async () => {
    onDisk(deviceVault, 'both')
    show(deviceVault)
    await chooseBackup(backupVault)
    await answer(BACKUP_PHRASE, /Replace my vault/)
    await screen.findByText(/That opens the backup/)

    await answer('still not this device’s phrase', /Replace my vault/)

    expect(await screen.findByText(/doesn’t open the vault on this device/)).toBeTruthy()
    expect(liveOnDisk()).toEqual(deviceVault)
    expect(asideOnDisk()).toBeUndefined()
  })

  it('replaces the vault, and keeps the old one, when both halves are answered', async () => {
    onDisk(deviceVault, 'both')
    const onRestored = vi.fn()
    show(deviceVault, { onRestored })
    await chooseBackup(backupVault)

    await answer(BACKUP_PHRASE, /Replace my vault/)
    await screen.findByText(/That opens the backup/)
    await answer(DEVICE_PHRASE, /Replace my vault/)

    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1))
    expect(liveOnDisk()).toEqual(backupVault)
    expect(asideOnDisk()).toEqual(deviceVault)
  })

  it('takes one typing when the same phrase opens both — the ordinary case', async () => {
    // Someone restoring their own newer export types the same words for both
    // halves; `proveNextForRestore` tries the second opportunistically so they
    // are not asked twice.
    const sameBoth = await sealedUnder(DEVICE_PHRASE, { createdAt: Date.parse('2025-12-01') })
    onDisk(deviceVault, 'both')
    show(deviceVault)
    await chooseBackup(sameBoth)

    await answer(DEVICE_PHRASE, /Replace my vault/)

    await waitFor(() => expect(liveOnDisk()).toEqual(sameBoth))
    expect(screen.queryByText(/That opens the backup/)).toBeNull()
  })

  it('asks only for the file’s passphrase when the device is set to `incoming`', async () => {
    onDisk(deviceVault, 'incoming')
    show(deviceVault)
    await chooseBackup(backupVault)

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/the backup file’s passphrase/)).toBeTruthy(),
    )
    await answer(BACKUP_PHRASE, /Replace my vault/)

    await waitFor(() => expect(liveOnDisk()).toEqual(backupVault))
  })

  it('asks for nothing when the device is set to `off`, and says that is what it is doing', async () => {
    onDisk(deviceVault, 'off')
    show(deviceVault)
    await chooseBackup(backupVault)

    // The absence of a field is the one thing a user could read as "nothing to
    // ask", so the screen says it out loud instead.
    expect(await screen.findByText(/without asking for anything first/)).toBeTruthy()
    expect(screen.queryByPlaceholderText(/the backup file’s passphrase/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Replace my vault/ }))
    await waitFor(() => expect(liveOnDisk()).toEqual(backupVault))
  })

  it('enforces the gate the device holds now, not the one this screen was drawn under', async () => {
    // The panel reads the preference when it mounts; the commit reads it again.
    // Raising the gate in another tab has to apply to this restore, not the
    // next page load.
    onDisk(deviceVault, 'off')
    show(deviceVault)
    await chooseBackup(backupVault)
    await screen.findByText(/without asking for anything first/)

    seedFakeDb('meta', 'settings', { restoreGate: 'both' })
    fireEvent.click(screen.getByRole('button', { name: /Replace my vault/ }))

    expect(await screen.findByText(/now asks for more before a backup may replace/)).toBeTruthy()
    expect(liveOnDisk()).toEqual(deviceVault)
  })

  it('starts over when a second file is chosen, rather than carrying a proof across', async () => {
    onDisk(deviceVault, 'both')
    show(deviceVault)
    await chooseBackup(backupVault)
    await answer(BACKUP_PHRASE, /Replace my vault/)
    await screen.findByText(/That opens the backup/)

    const otherFile = await sealedUnder('some other backup phrase entirely')
    await chooseBackup(otherFile)

    // Back to asking for the incoming file's phrase: the proof it holds was
    // made against a record it is no longer being asked to install.
    expect(await screen.findByPlaceholderText(/the backup file’s passphrase/)).toBeTruthy()
    expect(liveOnDisk()).toEqual(deviceVault)
  })
})

describe('the undo offer (`decisions/0016`, gated by `0018`)', () => {
  it('is not offered when nothing has been set aside', async () => {
    onDisk(deviceVault)
    show(deviceVault)
    await waitFor(() => expect(screen.getByText(/Restore from a backup file/)).toBeTruthy())
    expect(screen.queryByText(/Restored the wrong file/)).toBeNull()
  })

  it('refuses to swap for someone who cannot open the vault set aside', async () => {
    onDisk(backupVault, 'both', deviceVault)
    const onRestored = vi.fn()
    show(backupVault, { onRestored })

    fireEvent.click(await screen.findByText(/Restored the wrong file/))
    await answer('not the archived vault’s phrase', /Put the previous vault back/)

    expect(await screen.findByText(/doesn’t open the vault set aside/)).toBeTruthy()
    expect(liveOnDisk()).toEqual(backupVault)
    expect(asideOnDisk()).toEqual(deviceVault)
    expect(onRestored).not.toHaveBeenCalled()
  })

  it('swaps the two vaults for the phrase that opens the archived one', async () => {
    onDisk(backupVault, 'both', deviceVault)
    const onRestored = vi.fn()
    show(backupVault, { onRestored })

    fireEvent.click(await screen.findByText(/Restored the wrong file/))
    await answer(DEVICE_PHRASE, /Put the previous vault back/)

    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1))
    // A swap, not a move: pressing again puts it back, so a mistaken press
    // costs a press rather than a vault.
    expect(liveOnDisk()).toEqual(deviceVault)
    expect(asideOnDisk()).toEqual(backupVault)
  })
})
