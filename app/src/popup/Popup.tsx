import { useEffect, useRef, useState } from 'react'
import { deriveKey } from '../crypto/kdf.ts'
import { decryptVault, fromBase64, WrongPassphraseError, type VaultData } from '../crypto/vault.ts'
import { loadVault, type StoredVault } from '../storage/db.ts'
import { upgradeOnUnlock } from '../vault/seal.ts'
import { recordPracticeUnlock } from '../srs/practice.ts'
import { rankCredentials } from '../credentials/rank.ts'
import { credentialOrigin } from '../credentials/match-url.ts'
import { requestAutofill } from '../credentials/autofill.ts'
import type { Credential } from '../credentials/types.ts'
import { openMemoryHouse, resolveTargetTab, type TargetTabResult } from './active-tab.ts'
import {
  POPUP_SESSION_MS,
  clearPopupSession,
  popupSessionEnabled,
  resumePopupSession,
  setPopupSessionEnabled,
  startPopupSession,
} from './session.ts'
import { isExtensionContext } from '../platform.ts'
import { Button } from '../ui.tsx'

type Phase = 'loading' | 'no-vault' | 'locked' | 'unlocked'

/**
 * Locking is app-wide: the full tab already broadcasts on this channel, and a
 * "Lock" pressed in the popup has to mean the same thing there.
 */
const lockChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('wwmp-lock')

/** How long "Filled" stays on screen before the popup gets out of the way. */
const CLOSE_AFTER_FILL_MS = 700

/**
 * The toolbar popup: unlock, find the entry for the page in front of you, fill
 * it. Everything else — training, palace walks, adding and editing entries,
 * backups — stays in the full tab, which has the room for it.
 *
 * By default the popup asks for the passphrase every time it opens, and the key
 * dies with the popup a moment later: the browser tears a popup down as soon as
 * it loses focus. The user can trade that away for five minutes at a time —
 * off unless they turn it on — and `session.ts` holds the whole of that
 * bargain, including its deadline (`decisions/0015`).
 *
 * Either way this popup drops its key at `deadline`. That matters even with the
 * session off, because "the browser destroys the popup" is not quite a rule: a
 * popup with devtools attached keeps focus, and used to hold the key for as
 * long as it stayed open.
 */
export default function Popup() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [stored, setStored] = useState<StoredVault | null>(null)
  const [target, setTarget] = useState<TargetTabResult>({ tab: null })
  const [unlocked, setUnlocked] = useState<{ rawKey: Uint8Array; data: VaultData } | null>(null)
  const [query, setQuery] = useState('')
  // Whether the user has opted into carrying a session between popups.
  const [staying, setStaying] = useState(false)
  // Wall-clock end of this unlocked session, set by the unlock that derived the
  // key and inherited unchanged by a popup that picks the session up. Never
  // pushed back: five minutes means five minutes from the unlock.
  const [deadline, setDeadline] = useState<number | null>(null)
  // True when this popup opened straight into an unlocked vault, which is worth
  // saying out loud — nobody typed a passphrase to get here.
  const [resumed, setResumed] = useState(false)

  // A second handle on the key, deliberately outside React state. Zeroing it
  // from inside a `setState` updater works only if React gets around to running
  // that updater, and on `pagehide` — the popup being torn down, which is how
  // this context normally ends — there is no render left to run it in. The ref
  // is what makes the sentence below actually true.
  const keyRef = useRef<Uint8Array | null>(null)

  /**
   * Drop this popup's key.
   *
   * `explicit` is the user having asked, which is app-wide: it locks the memory
   * house too. The deadline running out is not — that is a cap on this
   * context's key, not evidence about where the user is, and it should not
   * reach into a tab they are working in.
   *
   * Either way the parked session goes. The user asked for it to, or its
   * deadline is the one that just passed.
   */
  const lock = (explicit: boolean) => {
    keyRef.current?.fill(0)
    keyRef.current = null
    setUnlocked(null)
    setDeadline(null)
    setResumed(false)
    // The parked key outlives every page, so a broadcast cannot end it; only
    // this can. Lock means locked, including for the next popup.
    void clearPopupSession()
    if (explicit) lockChannel?.postMessage('lock')
    setPhase('locked')
  }

  useEffect(() => {
    void (async () => {
      // All three are independent of each other and the popup has to paint fast.
      const [vault, tab, enabled] = await Promise.all([
        loadVault(),
        resolveTargetTab(),
        popupSessionEnabled(),
      ])
      setTarget(tab)
      setStaying(enabled)
      setStored(vault ?? null)
      if (!vault) {
        setPhase('no-vault')
        return
      }
      // A session the user opted into, if there is one still running. It is
      // refused unless it was derived against the salt this vault has now, so
      // a re-key elsewhere sends them back to the passphrase rather than to a
      // puzzling decryption failure.
      const session = await resumePopupSession(vault)
      if (session) {
        try {
          const data = await decryptVault(
            session.rawKey,
            { iv: fromBase64(vault.iv), ciphertext: fromBase64(vault.ciphertext) },
            vault,
          )
          keyRef.current = session.rawKey
          setUnlocked({ rawKey: session.rawKey, data })
          setDeadline(session.expiresAt)
          setResumed(true)
          setPhase('unlocked')
          // Deliberately no practice record and no KDF upgrade here. Nobody
          // recalled anything, so counting it would inflate the spaced-practice
          // schedule into silence; and an upgrade needs the passphrase, which
          // this path does not have. The next real unlock does both.
          return
        } catch {
          // The key does not open this vault after all. Nothing to do with it.
          session.rawKey.fill(0)
          await clearPopupSession()
        }
      }
      setPhase('locked')
    })()
  }, [])

  // Best effort, same as the full tab: dropping the reference is not enough on
  // its own, so the key bytes are overwritten before this context goes away.
  //
  // This does not touch the parked session — a popup being torn down on blur is
  // the ordinary end of a popup, not a lock, and ending the session there would
  // be the same as not having one.
  useEffect(() => {
    const wipe = () => {
      keyRef.current?.fill(0)
      keyRef.current = null
      setUnlocked(null)
    }
    window.addEventListener('pagehide', wipe)
    const onRemoteLock = (event: MessageEvent) => {
      if (event.data === 'lock') {
        wipe()
        setDeadline(null)
        setResumed(false)
        // The parked session is deliberately left alone. A tab locking itself
        // on its own idle timer is not the user ending a session they opted
        // into, and the one that matters — "Lock now" — clears it at the source
        // before broadcasting. The cost is that a popup left on screen through
        // another tab's auto-lock shows the passphrase prompt while a valid
        // session is still parked; reopening it picks the session back up.
        setPhase('locked')
      }
    }
    lockChannel?.addEventListener('message', onRemoteLock)
    return () => {
      window.removeEventListener('pagehide', wipe)
      lockChannel?.removeEventListener('message', onRemoteLock)
    }
  }, [])

  // Auto-lock. Judged against the clock rather than by trusting the timer to
  // have run: a machine suspended mid-session does not run timers while time
  // passes, so waking up has to find the deadline already gone.
  useEffect(() => {
    if (phase !== 'unlocked' || deadline === null) return
    const check = () => {
      if (Date.now() >= deadline) lock(false)
    }
    const timer = window.setTimeout(check, Math.max(0, deadline - Date.now()))
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [phase, deadline])

  /**
   * Turn the five-minute session on or off.
   *
   * Turning it on mid-session parks the key that is already in hand, on the
   * deadline it already has — the user's next fill should not need the phrase
   * again, and enabling this must not quietly restart the clock.
   */
  const toggleStaying = (on: boolean) => {
    void (async () => {
      // The switch on screen follows the write rather than leading it, so a
      // storage area that refuses leaves the user looking at the truth.
      await setPopupSessionEnabled(on)
      setStaying(on)
      if (on && keyRef.current && stored && deadline !== null) {
        await startPopupSession(keyRef.current, stored.salt, deadline)
      }
    })().catch(() => {})
  }

  return (
    <div className="flex flex-col gap-3 p-3 text-ink">
      <Header target={target} />

      {phase === 'loading' && <p className="py-6 text-center text-sm text-dusk/60">Opening…</p>}

      {phase === 'no-vault' && (
        <div className="space-y-3 text-sm">
          <p className="text-dusk/80">
            There is no vault on this browser yet. The memory house is where you build one — it
            takes a walk through eight rooms and about ten minutes.
          </p>
          <Button className="w-full" onClick={openMemoryHouse}>
            Open the memory house
          </Button>
        </div>
      )}

      {phase === 'locked' && stored && (
        <Unlock
          stored={stored}
          onUnlock={(rawKey, data, currentStored) => {
            const ends = Date.now() + POPUP_SESSION_MS
            keyRef.current = rawKey
            setStored(currentStored)
            setUnlocked({ rawKey, data })
            setDeadline(ends)
            setResumed(false)
            setPhase('unlocked')
            // Every unlock is a rehearsal, wherever it happens. A practice
            // record that fails to write must not take the unlock down with it.
            void recordPracticeUnlock().catch(() => {})
            // A no-op unless the user opted in — `startPopupSession` checks,
            // rather than trusting this call site to. The salt is the one this
            // unlock ended on, which is not the one it started with if the
            // vault was re-keyed on the way in.
            void startPopupSession(rawKey, currentStored.salt, ends).catch(() => {})
          }}
        />
      )}

      {phase === 'unlocked' && unlocked && (
        <>
          {resumed && (
            <p className="rounded-lg border-2 border-sage/50 bg-sage/10 px-2 py-1 text-[11px] leading-snug text-dusk/80">
              Still unlocked from earlier — no passphrase needed until the countdown ends.
            </p>
          )}
          <Entries
            entries={unlocked.data.entries}
            target={target}
            query={query}
            onQuery={setQuery}
            onLock={() => lock(true)}
          />
        </>
      )}

      {(phase === 'locked' || phase === 'unlocked') && (
        <StayUnlocked enabled={staying} onChange={toggleStaying} />
      )}

      <footer className="flex items-center justify-between border-t border-dusk/15 pt-2 text-xs">
        <button
          type="button"
          className="text-dusk/70 underline underline-offset-2 hover:text-dusk"
          onClick={openMemoryHouse}
        >
          Memory house
        </button>
        {phase === 'unlocked' && (
          <div className="flex items-center gap-3">
            {staying && deadline !== null && <Countdown deadline={deadline} />}
            <button
              type="button"
              className="text-dusk/70 underline underline-offset-2 hover:text-dusk"
              onClick={() => lock(true)}
            >
              Lock
            </button>
          </div>
        )}
      </footer>
    </div>
  )
}

/**
 * The opt-in, said plainly enough that ticking it is a decision rather than a
 * shrug. It is the only control in this popup that trades a security property
 * for convenience, so both sides of the trade are on screen (`decisions/0015`).
 *
 * Hidden outside the extension: `chrome.storage` is where the preference and
 * the key live, and neither exists when this bundle is served as a web page.
 */
function StayUnlocked({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: (enabled: boolean) => void
}) {
  if (!isExtensionContext()) return null
  return (
    <div className="rounded-lg border-2 border-dusk/15 bg-parchment-dark/30 px-2 py-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-dusk">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          className="size-3.5 accent-amber-glow"
        />
        <span>Stay unlocked for 5 minutes</span>
      </label>
      <p className="pt-0.5 text-[11px] leading-snug text-dusk/60">
        {enabled
          ? 'The key is held in memory, never on disk, until the five minutes are up — so anyone at this computer can fill passwords until then.'
          : 'Off: every fill asks for your passphrase, and the key never outlives the popup.'}
      </p>
    </div>
  )
}

/** Time left on the session, so the promise on the checkbox is checkable. */
function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [deadline])

  const left = Math.max(0, deadline - now)
  const minutes = Math.floor(left / 60_000)
  const seconds = Math.floor((left % 60_000) / 1000)
  return (
    <span className="tabular-nums text-dusk/50" title="Time left before the vault locks itself">
      {minutes}:{String(seconds).padStart(2, '0')}
    </span>
  )
}

/** Which page the popup is pointed at — the one thing it must never get wrong. */
function Header({ target }: { target: TargetTabResult }) {
  const problems: Record<string, string> = {
    'no-extension': 'Not running as the extension, so nothing can be filled.',
    'no-tab': 'No page open in this window.',
    'url-hidden':
      'This window can’t be read. Open the popup from the toolbar button while the login page is in front of you.',
    'not-a-web-page': 'This isn’t a page an extension may type into.',
  }
  const problem = problems[String(target.problem)] ?? ''

  return (
    <header className="space-y-0.5">
      <h1 className="font-display text-base leading-tight text-dusk">Where Was My Password</h1>
      {target.tab ? (
        <p className="truncate text-xs text-dusk/70">
          Filling into <strong className="text-dusk">{targetLabel(target.tab)}</strong>
        </p>
      ) : (
        problem !== '' && <p className="text-xs text-brick">{problem}</p>
      )}
    </header>
  )
}

/**
 * What to call the page, the way a browser's address bar does: the bare host
 * over https, and the whole origin otherwise. Saying only the host would print
 * "github.com" for `http://github.com` and for `https://github.com:8443` alike,
 * and naming the page correctly is the single job this line has.
 */
function targetLabel(tab: { origin: string; host: string }): string {
  return tab.origin === `https://${tab.host}` ? tab.host : tab.origin
}

function Unlock({
  stored,
  onUnlock,
}: {
  stored: StoredVault
  onUnlock: (rawKey: Uint8Array, data: VaultData, stored: StoredVault) => void
}) {
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unlock = async () => {
    if (!phrase.trim() || busy) return
    setBusy(true)
    setError(null)
    // Held locally so a failed unlock does not leave a derived key behind: a key
    // from a wrong guess is not worth much, but it costs nothing to drop it.
    // Cleared, not zeroed, once it has been handed on — the session owns it then.
    let derived: Uint8Array | null = null
    try {
      derived = await deriveKey(phrase, fromBase64(stored.salt), stored.kdfParams)
      const data = await decryptVault(
        derived,
        { iv: fromBase64(stored.iv), ciphertext: fromBase64(stored.ciphertext) },
        stored,
      )
      // The popup upgrades an old vault too (`decisions/0013`). Someone who
      // fills from the toolbar and never opens the full tab would otherwise sit
      // on the settings their vault was created with forever. It is not
      // announced here — there is no room, and the full tab says it.
      const brought = await upgradeOnUnlock(phrase, derived, data, stored)
      derived = null
      setPhrase('')
      onUnlock(brought.rawKey, data, brought.stored)
    } catch (err) {
      setError(
        err instanceof WrongPassphraseError
          ? 'That doesn’t open the door. Walk the route: start at the mailbox.'
          : `Unlock failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      derived?.fill(0)
      setBusy(false)
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        void unlock()
      }}
    >
      <input
        autoFocus
        type="password"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        placeholder="your passphrase…"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full rounded-lg border-2 border-dusk/40 bg-parchment px-3 py-2 text-center font-display tracking-wide focus:border-amber-glow focus:outline-none"
      />
      <Button className="w-full !py-1.5" onClick={() => void unlock()} disabled={!phrase.trim() || busy}>
        {busy ? 'Deriving key…' : 'Unlock'}
      </Button>
      {busy && (
        <p className="text-center text-xs text-dusk/70">Stretching passphrase (Argon2id)…</p>
      )}
      {error && <p className="text-xs font-semibold text-brick">{error}</p>}
    </form>
  )
}

function Entries({
  entries,
  target,
  query,
  onQuery,
  onLock,
}: {
  entries: Credential[]
  target: TargetTabResult
  query: string
  onQuery: (q: string) => void
  onLock: () => void
}) {
  const ranked = rankCredentials(entries, target.tab?.origin ?? '', query)

  if (entries.length === 0) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-dusk/80">
          The vault is open and empty. Passwords are added in the memory house, where there is room
          to generate one and check it over.
        </p>
        <Button className="w-full" onClick={openMemoryHouse}>
          Open the memory house
        </Button>
        <button
          type="button"
          className="w-full text-xs text-dusk/60 underline underline-offset-2"
          onClick={onLock}
        >
          Lock
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <input
        autoFocus
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search your passwords…"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full rounded-lg border-2 border-dusk/30 bg-parchment px-3 py-1.5 text-sm focus:border-amber-glow focus:outline-none"
      />
      {/* Capped and scrollable: Chromium refuses to make a popup taller than
          600px, so a long vault must scroll inside the list rather than push
          the footer off the bottom of the window. */}
      <ul className="max-h-80 space-y-1.5 overflow-y-auto">
        {ranked.map(({ cred, matchesPage }) => (
          <li key={cred.id}>
            <Row cred={cred} matchesPage={matchesPage} target={target} />
          </li>
        ))}
      </ul>
      {ranked.length === 0 && (
        <p className="py-2 text-center text-xs text-dusk/60">Nothing matches “{query}”.</p>
      )}
    </div>
  )
}

function Row({
  cred,
  matchesPage,
  target,
}: {
  cred: Credential
  matchesPage: boolean
  target: TargetTabResult
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // `expected` is null when the entry has no site saved at all, which needs
  // different words from a genuine mismatch.
  const [mismatch, setMismatch] = useState<{ page: string; expected: string | null } | null>(null)
  const closeTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const fill = async (overrideOrigin?: string) => {
    // No target means no fill, full stop. The worker refuses a request with no
    // tab id rather than picking one, so this only decides which of the two says
    // so — but the button is disabled below, and this is the guard that makes
    // that a rule instead of a rendering detail.
    if (busy || !target.tab) return
    window.clearTimeout(closeTimer.current)
    setBusy(true)
    setStatus('Filling…')
    setMismatch(null)
    const result = await requestAutofill({
      tabId: target.tab.tabId,
      username: cred.username,
      password: cred.password,
      expectedOrigin: credentialOrigin(cred.url),
      overrideOrigin,
    })
    setBusy(false)

    if (result.ok && result.filled) {
      setStatus('Filled')
      // Get out of the way: the user's next move is the page's own Sign in
      // button, and the popup is sitting on top of it.
      closeTimer.current = window.setTimeout(() => window.close(), CLOSE_AFTER_FILL_MS)
      return
    }
    if (result.reason === 'origin-mismatch' || result.reason === 'no-stored-origin') {
      // Never fill silently across origins — that is precisely what a look-alike
      // page is waiting for. An entry with no saved site gets the same caution.
      setStatus(null)
      setMismatch({
        page: result.pageOrigin ?? target.tab?.origin ?? 'this page',
        expected:
          result.reason === 'origin-mismatch' ? (result.expectedOrigin ?? 'the stored site') : null,
      })
      return
    }
    const messages: Record<string, string> = {
      'no-password-field': 'No login field on this page',
      'no-page-tab': 'This tab can’t be filled',
      'no-such-tab': 'That page is gone — reopen the popup',
      'not-in-extension': 'Autofill needs the extension',
      'content-script-unreachable': 'The browser won’t let extensions touch this page',
      'injection-failed': 'The browser won’t let extensions touch this page',
    }
    setStatus(messages[String(result.reason)] ?? 'Could not reach the page')
    closeTimer.current = window.setTimeout(() => setStatus(null), 4000)
  }

  return (
    <div
      className={`rounded-lg border-2 p-2 ${
        matchesPage ? 'border-amber-glow/70 bg-amber-glow/10' : 'border-dusk/20 bg-parchment-dark/40'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-dusk">{cred.label}</p>
          {cred.username && <p className="truncate text-xs text-dusk/70">{cred.username}</p>}
          {matchesPage && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-glow">
              this page
            </p>
          )}
        </div>
        <Button
          className="shrink-0 !px-3 !py-1 !text-sm"
          // There is nowhere to fill when the target could not be resolved. The
          // header says why; an enabled button there would only invite a click
          // that cannot do anything but go wrong.
          disabled={busy || !target.tab}
          title={target.tab ? undefined : 'No page to fill'}
          onClick={() => void fill()}
        >
          Fill
        </Button>
      </div>

      {status && <p className="pt-1 text-xs text-dusk/70">{status}</p>}

      {mismatch && (
        <div className="mt-2 space-y-1.5 rounded-lg border-2 border-brick/60 bg-brick/10 p-2 text-[11px] leading-snug">
          {mismatch.expected ? (
            <p>
              This page is <strong className="break-all">{mismatch.page}</strong>, but this password
              is for <strong className="break-all">{mismatch.expected}</strong>. If you did not
              expect that, the page may be impersonating the real site.
            </p>
          ) : (
            <p>
              No site is saved against this password, so there is nothing to check{' '}
              <strong className="break-all">{mismatch.page}</strong> against. Fill it only if this is
              the page you meant.
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              className="font-semibold text-brick underline underline-offset-2"
              onClick={() => void fill(mismatch.page)}
            >
              Fill anyway
            </button>
            <button
              type="button"
              className="text-dusk/70 underline underline-offset-2"
              onClick={() => setMismatch(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
