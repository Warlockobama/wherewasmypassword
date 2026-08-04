import { useEffect, useRef, useState } from 'react'
import Welcome from './tutorial/Welcome.tsx'
import DemoWalk from './tutorial/DemoWalk.tsx'
import PhraseGenerator from './training/PhraseGenerator.tsx'
import PlacementJourney from './training/PlacementJourney.tsx'
import QuizWalk from './training/QuizWalk.tsx'
import MasteryTest from './training/MasteryTest.tsx'
import CreateVault from './vault/CreateVault.tsx'
import LockScreen from './vault/LockScreen.tsx'
import UnlockedHome from './vault/UnlockedHome.tsx'
import ChangePassphrase from './vault/ChangePassphrase.tsx'
import type { Association, VaultData } from './crypto/vault.ts'
import { randomInt } from './crypto/random.ts'
import { clearClipboardOnLock } from './credentials/clipboard.ts'
import {
  freshPracticeMeta,
  loadPracticeMeta,
  loadVault,
  type PracticeMeta,
  type StoredVault,
} from './storage/db.ts'
import { daysUntilPractice, isPracticeDue } from './srs/schedule.ts'
import { recordPracticeUnlock } from './srs/practice.ts'
import { clearPopupSession } from './popup/session.ts'

type Phase =
  | 'loading'
  | 'welcome'
  | 'demo'
  | 'generate'
  | 'placement'
  | 'quiz-forward'
  | 'quiz-backward'
  | 'quiz-random'
  | 'mastery'
  | 'create'
  | 'locked'
  | 'unlocked'
  | 'change-passphrase'

const AUTO_LOCK_MS = 5 * 60 * 1000
const HIDDEN_LOCK_MS = 60 * 1000
const MAX_SESSION_MS = 30 * 60 * 1000

/**
 * Locking is app-wide, not tab-wide. Nothing stops a second copy of the UI
 * being open, and each one holds its own key on its own timers, so "Lock now"
 * in one has to reach the others.
 */
const lockChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('wwmp-lock')

function shuffled(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  // Training state: exists only in memory, only until the vault is sealed.
  const [words, setWords] = useState<string[]>([])
  const [associations, setAssociations] = useState<Association[]>([])
  const [randomOrder, setRandomOrder] = useState<number[]>([])
  // Bumped on every retake so the quiz component remounts fresh.
  const [attempt, setAttempt] = useState(0)
  // Vault state.
  const [stored, setStored] = useState<StoredVault | null>(null)
  const [meta, setMeta] = useState<PracticeMeta | null>(null)
  const [unlocked, setUnlocked] = useState<{ rawKey: Uint8Array; data: VaultData } | null>(null)
  // True when the unlock that opened this session also brought the vault up to
  // the current key-derivation settings or vault format, so the UI can say so
  // once rather than leaving it silent (`decisions/0013`).
  const [resealed, setResealed] = useState(false)
  const lockTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    void (async () => {
      const existing = await loadVault()
      setMeta((await loadPracticeMeta()) ?? null)
      if (existing) {
        setStored(existing)
        setPhase('locked')
      } else {
        setPhase('welcome')
      }
    })()
  }, [])

  const lock = (broadcast = true) => {
    // Drop the key and plaintext; GC does the rest. Best effort in JS.
    setUnlocked((u) => {
      u?.rawKey.fill(0)
      return null
    })
    // A copied password outlives the key otherwise: the pending clear holds
    // the plaintext until it fires. Take it off the clipboard now instead.
    void clearClipboardOnLock()
    // Every other open copy of the UI has its own key in its own memory, on
    // its own timers. Locking one has to mean locking all of them.
    if (broadcast) lockChannel?.postMessage('lock')
    setPhase('locked')
  }

  /**
   * "Lock now", pressed by a person — which means everything, including the
   * toolbar popup's opt-in five-minute session (`decisions/0015`). That session
   * survives with no page open at all, so a broadcast cannot reach it; only
   * this can.
   *
   * The idle timers above deliberately do not do this. They are each context
   * minding its own key, and the popup's session is already capped at five
   * minutes from the unlock that made it — letting a hidden memory-house tab
   * cut that short a minute after the user switched to a login page would
   * remove the feature in exactly the case it exists for.
   */
  const lockNow = () => {
    void clearPopupSession()
    lock()
  }

  // Every phase that holds a derived key in memory. Changing the passphrase is
  // one of them — it walks through placement and quizzes with the old vault
  // still open — so it has to be under the same timers rather than a quiet
  // window where the vault stays unlocked for as long as the flow is on screen.
  const holdingKey = phase === 'unlocked' || phase === 'change-passphrase'

  // Auto-lock: idle timeout while unlocked; a shorter fuse while the tab is
  // hidden (a quick tab switch shouldn't force a full re-derive).
  useEffect(() => {
    // Keyed on `holdingKey` rather than on `phase`: stepping into the change-
    // passphrase flow and back out must not re-mount this and hand the session
    // a fresh 30 minutes each time.
    if (!holdingKey) return
    let hiddenTimer: number | undefined

    // Deadlines in wall-clock time, not timer durations. A suspended machine
    // does not run timers but time still passes, so a lid closed two minutes
    // into a session and opened eight hours later must find the vault locked,
    // not with 28 minutes still on its "absolute" cap.
    const startedAt = Date.now()
    let idleSince = startedAt
    let hiddenSince: number | null = null

    const expired = () =>
      Date.now() - startedAt >= MAX_SESSION_MS ||
      Date.now() - idleSince >= AUTO_LOCK_MS ||
      (hiddenSince !== null && Date.now() - hiddenSince >= HIDDEN_LOCK_MS)

    const check = () => {
      if (expired()) lock()
    }

    // Only a real human keeps the vault open. Synthetic events are ignored, so
    // a script on the page can't hold the session — and the key — open forever
    // with a dispatched keydown every few minutes.
    const arm = (event?: Event) => {
      if (event && !event.isTrusted) return
      idleSince = Date.now()
      window.clearTimeout(lockTimer.current)
      lockTimer.current = window.setTimeout(check, AUTO_LOCK_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince = Date.now()
        hiddenTimer = window.setTimeout(check, HIDDEN_LOCK_MS)
      } else {
        window.clearTimeout(hiddenTimer)
        // Judge the hidden deadline BEFORE forgetting when we went hidden. A
        // machine suspended while the tab was hidden never ran that timer, so
        // clearing `hiddenSince` first would quietly forgive the whole absence
        // — which is exactly the case this is here to catch.
        if (expired()) {
          lock()
          return
        }
        hiddenSince = null
      }
    }
    arm()
    // A hard ceiling no amount of activity can extend: even a genuinely busy
    // session should not keep the key in memory all day.
    const sessionCap = window.setTimeout(check, MAX_SESSION_MS)
    const events = ['pointerdown', 'keydown'] as const
    events.forEach((e) => window.addEventListener(e, arm))
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', check)
    // Leaving the page is as good a reason to drop the key as any — but only
    // this page's key. Closing one tab should not lock a vault the user is
    // actively working in somewhere else.
    const onPageHide = () => lock(false)
    window.addEventListener('pagehide', onPageHide)
    const onRemoteLock = (event: MessageEvent) => {
      if (event.data === 'lock') lock(false)
    }
    lockChannel?.addEventListener('message', onRemoteLock)
    return () => {
      window.clearTimeout(lockTimer.current)
      window.clearTimeout(hiddenTimer)
      window.clearTimeout(sessionCap)
      events.forEach((e) => window.removeEventListener(e, arm))
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', check)
      window.removeEventListener('pagehide', onPageHide)
      lockChannel?.removeEventListener('message', onRemoteLock)
    }
  }, [holdingKey])

  const recordPractice = async () => {
    // Shared with the toolbar popup, which unlocks the same vault and counts
    // for the same schedule.
    setMeta(await recordPracticeUnlock())
  }

  switch (phase) {
    case 'loading':
      return null
    case 'welcome':
      return (
        <Welcome
          onComplete={() => setPhase('demo')}
          onRestored={(restoredVault) => {
            setStored(restoredVault)
            setMeta(freshPracticeMeta(restoredVault.createdAt))
            setPhase('locked')
          }}
        />
      )
    case 'demo':
      return <DemoWalk onComplete={() => setPhase('generate')} />
    case 'generate':
      return (
        <PhraseGenerator
          onComplete={(w) => {
            setWords(w)
            setAssociations([])
            setPhase('placement')
          }}
        />
      )
    case 'placement':
      return (
        <PlacementJourney
          words={words}
          onComplete={(a) => {
            setAssociations(a)
            setPhase('quiz-forward')
          }}
        />
      )
    case 'quiz-forward':
      return (
        <QuizWalk
          key={`fwd-${attempt}`}
          title="Walk the Route Forward"
          subtitle="Type each word from memory, then open the compartment to check."
          words={words}
          associations={associations}
          order={words.map((_, i) => i)}
          onComplete={(misses) => {
            if (misses === 0) setPhase('quiz-backward')
            else setAttempt((a) => a + 1)
          }}
        />
      )
    case 'quiz-backward':
      return (
        <QuizWalk
          key={`bwd-${attempt}`}
          title="Now Walk It Backward"
          subtitle="Wardrobe to mailbox. If you can do this, the phrase is truly yours."
          words={words}
          associations={associations}
          order={words.map((_, i) => words.length - 1 - i)}
          onComplete={(misses) => {
            if (misses === 0) startRandomQuiz()
            else setAttempt((a) => a + 1)
          }}
        />
      )
    case 'quiz-random':
      return (
        <QuizWalk
          key={`rnd-${attempt}`}
          title="Spot Checks"
          subtitle="No order to lean on — jump straight to each spot in your mind."
          words={words}
          associations={associations}
          order={randomOrder}
          onComplete={(misses) => {
            if (misses === 0) setPhase('mastery')
            else startRandomQuiz()
          }}
        />
      )
    case 'mastery':
      return (
        <MasteryTest
          words={words}
          onComplete={() => setPhase('create')}
          onRefresher={() => setPhase('quiz-forward')}
        />
      )
    case 'create':
      return (
        <CreateVault
          words={words}
          associations={associations}
          onDone={(rawKey, data, storedVault) => {
            // Training material has served its purpose; drop the plaintext copies.
            setWords([])
            setAssociations([])
            setStored(storedVault)
            setMeta(freshPracticeMeta(data.createdAt))
            setUnlocked({ rawKey, data })
            setPhase('unlocked')
          }}
          onExistingVault={() => {
            // The create was refused because another tab got here first
            // (`decisions/0020`). This tab's phrase and memory house guard
            // nothing and never will, so they go the same way they do on a
            // successful seal — and this tab joins the vault that does exist.
            setWords([])
            setAssociations([])
            void (async () => {
              const existing = await loadVault()
              if (!existing) {
                // Deleted between the refusal and this click. Nothing to open,
                // and nothing left of the walk to seal: start over honestly
                // rather than re-running a create with a half-forgotten phrase.
                setPhase('welcome')
                return
              }
              setStored(existing)
              // The schedule belongs to the vault, and the tab that created it
              // wrote one. Only invent a fresh one if there is none to read.
              setMeta((await loadPracticeMeta()) ?? freshPracticeMeta(existing.createdAt))
              setPhase('locked')
            })()
          }}
        />
      )
    case 'locked':
      return stored ? (
        <LockScreen
          stored={stored}
          practiceDue={meta ? isPracticeDue(meta.createdAt, meta) : false}
          onUnlock={(rawKey, data, currentStored, resealed) => {
            void recordPractice()
            // An old vault may have been re-keyed on the way in, which replaces
            // the salt and the record; carry the new one or the next save would
            // write the vault back out under the settings it just left.
            setStored(currentStored)
            setResealed(resealed)
            setUnlocked({ rawKey, data })
            setPhase('unlocked')
          }}
          onRestored={(restoredVault) => {
            // A restore or an undo replaces the live record just as a
            // passphrase change does, and any other copy of the UI is holding a
            // key on the salt that was live a moment ago. Left open it would
            // show credentials no longer on disk, and its next save would fail.
            // Lock it. A BroadcastChannel does not deliver to its own sender.
            lockChannel?.postMessage('lock')
            setStored(restoredVault)
            setMeta(freshPracticeMeta(restoredVault.createdAt))
          }}
        />
      ) : null
    case 'unlocked':
      return unlocked && stored ? (
        <UnlockedHome
          data={unlocked.data}
          stored={stored}
          rawKey={unlocked.rawKey}
          daysUntilPractice={meta ? daysUntilPractice(meta.createdAt, meta) : 0}
          resealed={resealed}
          // Wrapped, not passed directly: React hands the click event to the
          // first parameter, which is `broadcast`.
          onLock={() => lockNow()}
          onChangePassphrase={() => setPhase('change-passphrase')}
          onDeleted={() => {
            // Same key hygiene as lock(): dropping the reference is not enough.
            unlocked.rawKey.fill(0)
            void clearClipboardOnLock()
            // There is no vault left for a parked popup key to open.
            void clearPopupSession()
            setUnlocked(null)
            setStored(null)
            setMeta(null)
            setPhase('welcome')
          }}
          onVaultChanged={(nextData, nextStored) => {
            setUnlocked({ rawKey: unlocked.rawKey, data: nextData })
            setStored(nextStored)
          }}
        />
      ) : null
    case 'change-passphrase':
      return unlocked && stored ? (
        <ChangePassphrase
          data={unlocked.data}
          stored={stored}
          rawKey={unlocked.rawKey}
          onCancel={() => setPhase('unlocked')}
          onDone={(nextKey, nextData, nextStored) => {
            // Any other copy of the UI is holding the key to the vault that no
            // longer exists, on the salt that no longer exists. If it saved a
            // credential it would write the whole record back under the old
            // key, quietly undoing the change the user just made — so they are
            // locked. A BroadcastChannel does not deliver to its own sender, so
            // this tab stays open.
            lockChannel?.postMessage('lock')
            // The popup's parked key is one of those retired keys, and it is
            // not reachable by broadcast. Its salt no longer matches either, so
            // this is belt and braces — but the belt is what stops a stale key
            // sitting in memory for five minutes after a phrase was burned.
            void clearPopupSession()
            setUnlocked({ rawKey: nextKey, data: nextData })
            setStored(nextStored)
            setMeta(freshPracticeMeta(Date.now()))
            // The note belongs to the unlock that re-keyed the vault, not to a
            // change the user just watched happen on screen.
            setResealed(false)
            setPhase('unlocked')
          }}
        />
      ) : null
  }

  function startRandomQuiz() {
    setRandomOrder(shuffled(words.length))
    setAttempt((a) => a + 1)
    setPhase('quiz-random')
  }
}
