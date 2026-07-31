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
 * There is deliberately no auto-lock timer in here. A popup is torn down by the
 * browser the moment it loses focus, taking the key in its heap with it, so the
 * session cannot outlive the click that opened it. That is also why the popup
 * asks for the passphrase even when the full tab is unlocked: sharing a session
 * across contexts would mean parking the key somewhere both can read, which is
 * a security change, not a convenience one (see `decisions/0015`).
 */
export default function Popup() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [stored, setStored] = useState<StoredVault | null>(null)
  const [target, setTarget] = useState<TargetTabResult>({ tab: null })
  const [unlocked, setUnlocked] = useState<{ rawKey: Uint8Array; data: VaultData } | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void (async () => {
      // Both are independent of each other and the popup has to paint fast.
      const [vault, tab] = await Promise.all([loadVault(), resolveTargetTab()])
      setTarget(tab)
      setStored(vault ?? null)
      setPhase(vault ? 'locked' : 'no-vault')
    })()
  }, [])

  // Best effort, same as the full tab: dropping the reference is not enough on
  // its own, so the key bytes are overwritten before this context goes away.
  useEffect(() => {
    const wipe = () => setUnlocked((u) => (u?.rawKey.fill(0), null))
    window.addEventListener('pagehide', wipe)
    const onRemoteLock = (event: MessageEvent) => {
      if (event.data === 'lock') {
        wipe()
        setPhase('locked')
      }
    }
    lockChannel?.addEventListener('message', onRemoteLock)
    return () => {
      window.removeEventListener('pagehide', wipe)
      lockChannel?.removeEventListener('message', onRemoteLock)
    }
  }, [])

  const lock = () => {
    setUnlocked((u) => (u?.rawKey.fill(0), null))
    lockChannel?.postMessage('lock')
    setPhase('locked')
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
            setStored(currentStored)
            setUnlocked({ rawKey, data })
            setPhase('unlocked')
            // Every unlock is a rehearsal, wherever it happens.
            void recordPracticeUnlock()
          }}
        />
      )}

      {phase === 'unlocked' && unlocked && (
        <Entries
          entries={unlocked.data.entries}
          target={target}
          query={query}
          onQuery={setQuery}
          onLock={lock}
        />
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
          <button
            type="button"
            className="text-dusk/70 underline underline-offset-2 hover:text-dusk"
            onClick={lock}
          >
            Lock
          </button>
        )}
      </footer>
    </div>
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
          Filling into <strong className="text-dusk">{target.tab.host}</strong>
        </p>
      ) : (
        <p className="text-xs text-brick">{problem}</p>
      )}
    </header>
  )
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
    try {
      const rawKey = await deriveKey(phrase, fromBase64(stored.salt), stored.kdfParams)
      const data = await decryptVault(
        rawKey,
        { iv: fromBase64(stored.iv), ciphertext: fromBase64(stored.ciphertext) },
        stored,
      )
      // The popup upgrades an old vault too (`decisions/0013`). Someone who
      // fills from the toolbar and never opens the full tab would otherwise sit
      // on the settings their vault was created with forever. It is not
      // announced here — there is no room, and the full tab says it.
      const brought = await upgradeOnUnlock(phrase, rawKey, data, stored)
      setPhrase('')
      onUnlock(brought.rawKey, data, brought.stored)
    } catch (err) {
      setError(
        err instanceof WrongPassphraseError
          ? 'That doesn’t open the door. Walk the route: start at the mailbox.'
          : `Unlock failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
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
    if (busy) return
    window.clearTimeout(closeTimer.current)
    setBusy(true)
    setStatus('Filling…')
    setMismatch(null)
    const result = await requestAutofill({
      tabId: target.tab?.tabId,
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
      'no-active-tab': 'No page to fill',
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
          disabled={busy}
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
