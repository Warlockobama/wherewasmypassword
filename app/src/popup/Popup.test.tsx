// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * The toolbar popup, rendered.
 *
 * Everything this popup does that matters is a *refusal*, and every one of them
 * was reviewed rather than tested. The pieces underneath have tests —
 * `session.ts` for the parked key, `rank.ts` for the ordering, the packed-browser
 * run in `scripts/autofill-check.mjs` for the content script's own origin check —
 * but nobody had checked the popup's half of it: that a `origin-mismatch` coming
 * back from the worker stops in front of the user instead of quietly filling,
 * that it *names both sides* so a look-alike is legible as one (`decisions/0011`),
 * that "Fill anyway" carries the origin the user was actually shown, and that the
 * session switch follows the preference write rather than leading it
 * (`decisions/0015`).
 *
 * Real all the way down except the stretching and the three modules that reach
 * for `chrome.*`: real AES-GCM, real header binding, the real `db.ts` over an
 * in-memory `idb`, the real `rank.ts` and `match-url.ts`. `deriveKey` is swapped
 * for something instant, and `resolveTargetTab` / `requestAutofill` /
 * `session.ts` are the seam at the browser — mocked because the popup's job is
 * to react to what they say, which is precisely what is under test here.
 * `platform.ts` is left real, over a `chrome` stub thin enough to be honest:
 * `isExtensionContext()` only ever asks whether `chrome.runtime.id` is there.
 */

vi.mock('idb', async () => (await import('../test/fake-idb.ts')).fakeIdbModule())
vi.mock('../crypto/kdf.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../crypto/kdf.ts')>()),
  deriveKey: (await import('../test/fake-kdf.ts')).fakeDeriveKey,
}))
vi.mock('./active-tab.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./active-tab.ts')>()),
  resolveTargetTab: vi.fn(),
}))
vi.mock('../credentials/autofill.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../credentials/autofill.ts')>()),
  requestAutofill: vi.fn(),
}))
vi.mock('./session.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./session.ts')>()),
  clearPopupSession: vi.fn(),
  popupSessionEnabled: vi.fn(),
  resumePopupSession: vi.fn(),
  setPopupSessionEnabled: vi.fn(),
  startPopupSession: vi.fn(),
}))

import Popup from './Popup.tsx'
import { requestAutofill, type AutofillResult } from '../credentials/autofill.ts'
import type { Credential } from '../credentials/types.ts'
import type { StoredVault } from '../storage/db.ts'
import { resolveTargetTab, type TargetTabResult } from './active-tab.ts'
import {
  POPUP_SESSION_MS,
  clearPopupSession,
  popupSessionEnabled,
  resumePopupSession,
  setPopupSessionEnabled,
  startPopupSession,
} from './session.ts'
import { resetFakeDb, seedFakeDb } from '../test/fake-idb.ts'
import { sealedUnder } from '../test/vault-fixtures.ts'

const PHRASE = 'mailbox doormat closet fireplace oven fridge'

const REAL_SITE = 'https://github.com'
/** A registrable domain that is not github.com however much it reads like one. */
const LOOKALIKE = 'https://github.com.evil.example'

/** On the real site. */
const REAL_TAB: TargetTabResult = { tab: { tabId: 7, origin: REAL_SITE, host: 'github.com' } }
/** On the look-alike. */
const LOOKALIKE_TAB: TargetTabResult = {
  tab: { tabId: 7, origin: LOOKALIKE, host: 'github.com.evil.example' },
}

function credential(over: Partial<Credential>): Credential {
  return {
    id: 'cred',
    label: 'Entry',
    url: '',
    username: '',
    password: 'hunter2',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

const GITHUB = credential({ id: 'github', label: 'GitHub', url: REAL_SITE, username: 'james' })
/** No site saved at all — the `no-stored-origin` case, which needs its own words. */
const ROUTER = credential({ id: 'router', label: 'Home router', username: 'admin' })

let vault: StoredVault

beforeEach(async () => {
  resetFakeDb()
  vi.resetAllMocks()
  // Enough `chrome` for the real `isExtensionContext()` to say yes. Without it
  // the session checkbox does not render at all, and half this file would pass
  // by testing nothing.
  vi.stubGlobal('chrome', { runtime: { id: 'wwmp-test' } })
  vi.mocked(resolveTargetTab).mockResolvedValue(REAL_TAB)
  vi.mocked(popupSessionEnabled).mockResolvedValue(false)
  vi.mocked(resumePopupSession).mockResolvedValue(null)
  vi.mocked(setPopupSessionEnabled).mockResolvedValue(undefined)
  vi.mocked(startPopupSession).mockResolvedValue(undefined)
  vi.mocked(clearPopupSession).mockResolvedValue(undefined)
  vi.mocked(requestAutofill).mockResolvedValue({ ok: false, reason: 'no-response' })

  vault = await sealedUnder(PHRASE, { entries: [GITHUB, ROUTER] })
  seedFakeDb('vault', 'primary', vault)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Open the popup and wait for it to decide what it is looking at. */
async function open() {
  render(<Popup />)
  return await screen.findByPlaceholderText(/your passphrase/)
}

/** Type a phrase into the popup's own unlock form and press its button. */
function answer(phrase: string) {
  fireEvent.change(screen.getByPlaceholderText(/your passphrase/), { target: { value: phrase } })
  fireEvent.click(screen.getByRole('button', { name: /^Unlock$/ }))
}

/** Open the popup and get past the passphrase, leaving the entry list on screen. */
async function openUnlocked() {
  await open()
  answer(PHRASE)
  await screen.findByPlaceholderText(/Search your passwords/)
}

/**
 * Queries scoped to one entry's row. Two rows are on screen and both have a
 * "Fill" button, so an unscoped query would silently test whichever sorted first.
 */
function row(label: string) {
  const li = screen.getByText(label).closest('li')
  return within(li as HTMLElement)
}

const fillButton = (label: string) =>
  row(label).getByRole('button', { name: /^Fill$/ }) as HTMLButtonElement

/** What the worker sends back when the page is not the site the entry is for. */
function mismatch(pageOrigin: string, expectedOrigin: string): AutofillResult {
  return { ok: false, filled: false, reason: 'origin-mismatch', pageOrigin, expectedOrigin }
}

const requests = () => vi.mocked(requestAutofill).mock.calls.map(([request]) => request)

describe('unlocking', () => {
  it('refuses a phrase that does not open the vault, and shows nothing from inside it', async () => {
    await open()

    answer('not the right words at all')

    expect(await screen.findByText(/start at the mailbox/)).toBeTruthy()
    // The refusal is only worth anything if the vault stayed shut: no search
    // box, no rows, no Lock in the footer to lock.
    expect(screen.queryByPlaceholderText(/Search your passwords/)).toBeNull()
    expect(screen.queryByText('GitHub')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Lock$/ })).toBeNull()
  })

  it('opens the vault and puts the entry for the page in front first', async () => {
    await openUnlocked()

    expect(screen.getByText('GitHub')).toBeTruthy()
    // `rank.ts` decides the order; what this pins is that the popup hands it the
    // origin of the tab it resolved, rather than ranking against nothing.
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('GitHub')
    expect(row('GitHub').getByText('this page')).toBeTruthy()
  })
})

describe('the page the popup is pointed at', () => {
  it('will not offer to fill a page it could not resolve, and says why instead', async () => {
    // `url-hidden` is the one a user can actually act on: the popup was opened
    // from somewhere other than the toolbar button, so no `activeTab` grant
    // arrived (`active-tab.ts`).
    vi.mocked(resolveTargetTab).mockResolvedValue({ tab: null, problem: 'url-hidden' })
    await openUnlocked()

    expect(screen.getByText(/Open the popup from the toolbar button/)).toBeTruthy()
    // An enabled button here could only produce a failure from the worker; the
    // popup already knows the answer, so it says it before the click.
    expect(fillButton('GitHub').disabled).toBe(true)
    expect(fillButton('GitHub').title).toBe('No page to fill')

    fireEvent.click(fillButton('GitHub'))
    expect(requestAutofill).not.toHaveBeenCalled()
  })

  it('says the window is not fillable when the page is not one an extension may type into', async () => {
    vi.mocked(resolveTargetTab).mockResolvedValue({ tab: null, problem: 'not-a-web-page' })
    await openUnlocked()

    expect(screen.getByText(/isn’t a page an extension may type into/)).toBeTruthy()
    expect(fillButton('Home router').disabled).toBe(true)
  })
})

describe('filling across origins (`decisions/0011`)', () => {
  it('stops in front of the user when the page is not the site the password is for', async () => {
    vi.mocked(resolveTargetTab).mockResolvedValue(LOOKALIKE_TAB)
    vi.mocked(requestAutofill).mockResolvedValue(mismatch(LOOKALIKE, REAL_SITE))
    await openUnlocked()

    fireEvent.click(fillButton('GitHub'))

    // Both sides named, in the user's own reading order. Naming only one of them
    // is what makes a look-alike work: "github.com.evil.example" is unremarkable
    // until it is set beside the "github.com" the password actually belongs to.
    expect(await row('GitHub').findByText(LOOKALIKE)).toBeTruthy()
    expect(row('GitHub').getByText(REAL_SITE)).toBeTruthy()
    expect(row('GitHub').getByText(/may be impersonating the real site/)).toBeTruthy()
    // And nothing was filled on the way past.
    expect(row('GitHub').queryByText('Filled')).toBeNull()
    expect(requests()).toHaveLength(1)
    expect(requests()[0].overrideOrigin).toBeUndefined()
  })

  it('offers both ways out of the warning, and Cancel is one of them', async () => {
    vi.mocked(resolveTargetTab).mockResolvedValue(LOOKALIKE_TAB)
    vi.mocked(requestAutofill).mockResolvedValue(mismatch(LOOKALIKE, REAL_SITE))
    await openUnlocked()

    fireEvent.click(fillButton('GitHub'))
    expect(await row('GitHub').findByRole('button', { name: /Fill anyway/ })).toBeTruthy()

    fireEvent.click(row('GitHub').getByRole('button', { name: /^Cancel$/ }))

    expect(row('GitHub').queryByText(/may be impersonating the real site/)).toBeNull()
    // Backing out is not a fill: the request that was refused is still the only
    // one that has been made.
    expect(requests()).toHaveLength(1)
  })

  it('re-requests with an explicit approval when the user chooses Fill anyway', async () => {
    vi.mocked(resolveTargetTab).mockResolvedValue(LOOKALIKE_TAB)
    vi.mocked(requestAutofill)
      .mockResolvedValueOnce(mismatch(LOOKALIKE, REAL_SITE))
      .mockResolvedValueOnce({ ok: true, filled: true })
    await openUnlocked()

    fireEvent.click(fillButton('GitHub'))
    fireEvent.click(await row('GitHub').findByRole('button', { name: /Fill anyway/ }))

    expect(await row('GitHub').findByText('Filled')).toBeTruthy()
    expect(requests()).toHaveLength(2)
    expect(requests()[1]).toMatchObject({
      tabId: 7,
      username: 'james',
      expectedOrigin: REAL_SITE,
      // The approval carries the origin rather than a boolean, so the content
      // script can refuse it if the page moved between the warning and the click
      // (`autofill.ts`, `AutofillRequest.overrideOrigin`).
      overrideOrigin: LOOKALIKE,
    })
  })

  it('approves the origin it showed the user, not the one it resolved when it opened', async () => {
    // The tab navigated between the popup opening and the fill, so the worker's
    // answer is about a different page than the one `resolveTargetTab` saw. The
    // warning names what the worker reported, and the approval has to be for
    // that same origin — approving the stale one would hand a page an override
    // for an origin nobody was ever shown.
    const NAVIGATED_TO = 'https://login.evil.example'
    vi.mocked(resolveTargetTab).mockResolvedValue(LOOKALIKE_TAB)
    vi.mocked(requestAutofill)
      .mockResolvedValueOnce(mismatch(NAVIGATED_TO, REAL_SITE))
      .mockResolvedValueOnce({ ok: true, filled: true })
    await openUnlocked()

    fireEvent.click(fillButton('GitHub'))
    expect(await row('GitHub').findByText(NAVIGATED_TO)).toBeTruthy()
    expect(row('GitHub').queryByText(LOOKALIKE)).toBeNull()

    fireEvent.click(row('GitHub').getByRole('button', { name: /Fill anyway/ }))

    await waitFor(() => expect(requests()).toHaveLength(2))
    expect(requests()[1].overrideOrigin).toBe(NAVIGATED_TO)
  })

  it('gives an entry with no site saved different words, since there is nothing to compare', async () => {
    vi.mocked(requestAutofill).mockResolvedValue({
      ok: false,
      filled: false,
      reason: 'no-stored-origin',
      pageOrigin: REAL_SITE,
    })
    await openUnlocked()

    fireEvent.click(fillButton('Home router'))

    expect(await row('Home router').findByText(/nothing to check/)).toBeTruthy()
    // Same caution, different claim. Saying "this password is for X" when no X
    // was ever saved would be the popup inventing the fact it exists to check.
    expect(row('Home router').queryByText(/may be impersonating the real site/)).toBeNull()
    expect(row('Home router').getByText(REAL_SITE)).toBeTruthy()
    expect(row('Home router').getByRole('button', { name: /Fill anyway/ })).toBeTruthy()
    expect(row('Home router').getByRole('button', { name: /^Cancel$/ })).toBeTruthy()
    expect(row('Home router').queryByText('Filled')).toBeNull()
  })
})

describe('the five-minute session (`decisions/0015`)', () => {
  it('opens with the box showing what is actually stored', async () => {
    vi.mocked(popupSessionEnabled).mockResolvedValue(true)
    await open()

    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(true)
    // Both sides of the trade on screen, so ticking it is a decision.
    expect(screen.getByText(/anyone at this computer can fill passwords/)).toBeTruthy()
  })

  it('leaves the box alone when the preference could not be written', async () => {
    // The switch follows the write rather than leading it. A storage area that
    // refuses would otherwise leave a ticked box promising a session that does
    // not exist — and the next popup would ask for the passphrase, which is the
    // one thing the user just told it they would not have to do.
    vi.mocked(setPopupSessionEnabled).mockRejectedValue(new Error('storage refused'))
    await open()

    const box = screen.getByRole('checkbox') as HTMLInputElement
    fireEvent.click(box)

    await waitFor(() => expect(setPopupSessionEnabled).toHaveBeenCalledWith(true))
    expect(box.checked).toBe(false)
    expect(screen.getByText(/Off: every fill asks for your passphrase/)).toBeTruthy()
    expect(startPopupSession).not.toHaveBeenCalled()
  })

  it('parks the key already in hand on the deadline it already has', async () => {
    await openUnlocked()
    // The unlock always offers its key to `session.ts`, which refuses it while
    // the preference is off — so this first call is the baseline deadline.
    await waitFor(() => expect(startPopupSession).toHaveBeenCalledTimes(1))

    const box = screen.getByRole('checkbox') as HTMLInputElement
    fireEvent.click(box)

    await waitFor(() => expect(startPopupSession).toHaveBeenCalledTimes(2))
    expect(box.checked).toBe(true)
    const [, saltFirst, deadlineFirst] = vi.mocked(startPopupSession).mock.calls[0]
    const [, saltSecond, deadlineSecond] = vi.mocked(startPopupSession).mock.calls[1]
    // Ticking the box mid-session must not buy another five minutes: the key is
    // parked on the deadline the unlock fixed, whenever the user gets round to
    // opting in.
    expect(deadlineSecond).toBe(deadlineFirst)
    expect(deadlineSecond).toBeLessThanOrEqual(Date.now() + POPUP_SESSION_MS)
    // Against the salt the unlock ended on, or the parked key opens nothing.
    expect(saltSecond).toBe(saltFirst)
    expect(saltSecond).toBe(vault.salt)
  })
})
