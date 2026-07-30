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
import type { Association, VaultData } from './crypto/vault.ts'
import { randomInt } from './crypto/random.ts'
import {
  loadPracticeMeta,
  loadVault,
  savePracticeMeta,
  type PracticeMeta,
  type StoredVault,
} from './storage/db.ts'
import { daysUntilPractice, isPracticeDue } from './srs/schedule.ts'

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

const AUTO_LOCK_MS = 5 * 60 * 1000
const HIDDEN_LOCK_MS = 60 * 1000

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

  const lock = () => {
    // Drop the key and plaintext; GC does the rest. Best effort in JS.
    setUnlocked((u) => {
      u?.rawKey.fill(0)
      return null
    })
    setPhase('locked')
  }

  // Auto-lock: idle timeout while unlocked; a shorter fuse while the tab is
  // hidden (a quick tab switch shouldn't force a full re-derive).
  useEffect(() => {
    if (phase !== 'unlocked') return
    let hiddenTimer: number | undefined
    const arm = () => {
      window.clearTimeout(lockTimer.current)
      lockTimer.current = window.setTimeout(lock, AUTO_LOCK_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenTimer = window.setTimeout(lock, HIDDEN_LOCK_MS)
      } else {
        window.clearTimeout(hiddenTimer)
      }
    }
    arm()
    const events = ['pointerdown', 'keydown'] as const
    events.forEach((e) => window.addEventListener(e, arm))
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(lockTimer.current)
      window.clearTimeout(hiddenTimer)
      events.forEach((e) => window.removeEventListener(e, arm))
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [phase])

  const recordPractice = async () => {
    const current = meta ?? { createdAt: Date.now(), practicedAt: [] }
    const next = { ...current, practicedAt: [...current.practicedAt, Date.now()] }
    setMeta(next)
    await savePracticeMeta(next)
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
            setMeta({ createdAt: restoredVault.createdAt, practicedAt: [] })
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
            setMeta({ createdAt: data.createdAt, practicedAt: [] })
            setUnlocked({ rawKey, data })
            setPhase('unlocked')
          }}
        />
      )
    case 'locked':
      return stored ? (
        <LockScreen
          stored={stored}
          practiceDue={meta ? isPracticeDue(meta.createdAt, meta.practicedAt) : false}
          onUnlock={(rawKey, data) => {
            void recordPractice()
            setUnlocked({ rawKey, data })
            setPhase('unlocked')
          }}
          onRestored={(restoredVault) => {
            setStored(restoredVault)
            setMeta({ createdAt: restoredVault.createdAt, practicedAt: [] })
          }}
        />
      ) : null
    case 'unlocked':
      return unlocked && stored ? (
        <UnlockedHome
          data={unlocked.data}
          stored={stored}
          rawKey={unlocked.rawKey}
          daysUntilPractice={meta ? daysUntilPractice(meta.createdAt, meta.practicedAt) : 0}
          onLock={lock}
          onDeleted={() => {
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
  }

  function startRandomQuiz() {
    setRandomOrder(shuffled(words.length))
    setAttempt((a) => a + 1)
    setPhase('quiz-random')
  }
}
