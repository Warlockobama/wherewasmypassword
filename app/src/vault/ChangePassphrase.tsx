import { useState } from 'react'
import PhraseGenerator from '../training/PhraseGenerator.tsx'
import PlacementJourney from '../training/PlacementJourney.tsx'
import QuizWalk from '../training/QuizWalk.tsx'
import MasteryTest from '../training/MasteryTest.tsx'
import { deriveKey } from '../crypto/kdf.ts'
import { fromBase64, type Association, type VaultData } from '../crypto/vault.ts'
import { randomInt } from '../crypto/random.ts'
import { downloadBackup } from '../storage/backup.ts'
import {
  deleteArchivedVault,
  freshPracticeMeta,
  savePracticeMeta,
  type StoredVault,
} from '../storage/db.ts'
import { rekeyVault } from './seal.ts'
import { Button, Panel, Screen, Title } from '../ui.tsx'

type Step =
  | 'confirm'
  | 'generate'
  | 'placement'
  | 'gate'
  | 'quiz-forward'
  | 'quiz-backward'
  | 'quiz-random'
  | 'mastery'
  | 'sealing'
  | 'done'
  | 'error'

/**
 * Compare two derived keys without leaking, through timing, how much of the
 * typed phrase was right. Every byte is examined whatever the first one says.
 */
function keysMatch(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}

function shuffled(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

/**
 * Change the master passphrase (`decisions/0012`).
 *
 * Underneath it is the same single operation as raising a vault's key-
 * derivation settings: a new salt, a key derived afresh, and the whole vault
 * re-encrypted under it. What surrounds it is the part that matters — a phrase
 * the user has not learned is worse than the one they had, so the new words go
 * into the memory house before the vault is sealed, and the practice schedule
 * starts again from the beginning.
 */
export default function ChangePassphrase({
  data,
  stored,
  rawKey,
  onDone,
  onCancel,
}: {
  data: VaultData
  stored: StoredVault
  rawKey: Uint8Array
  onDone: (rawKey: Uint8Array, data: VaultData, stored: StoredVault) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<Step>('confirm')
  const [words, setWords] = useState<string[]>([])
  const [associations, setAssociations] = useState<Association[]>([])
  const [randomOrder, setRandomOrder] = useState<number[]>([])
  const [attempt, setAttempt] = useState(0)
  const [detail, setDetail] = useState('')
  const [result, setResult] = useState<{ rawKey: Uint8Array; data: VaultData; stored: StoredVault } | null>(
    null,
  )

  const startRandomQuiz = () => {
    setRandomOrder(shuffled(words.length))
    setAttempt((a) => a + 1)
    setStep('quiz-random')
  }

  const seal = async (newWords: string[], newAssociations: Association[]) => {
    setStep('sealing')
    try {
      const nextData: VaultData = {
        ...data,
        words: newWords,
        associations: newAssociations,
        // The vault is the same vault and keeps its birthday; only the phrase
        // guarding it is new. The practice schedule below is what resets.
        entries: data.entries,
      }
      const { rawKey: nextKey, stored: nextStored } = await rekeyVault(
        newWords.join(' '),
        nextData,
        stored.createdAt,
      )
      // A new phrase means a new memory to build, so the spaced-practice ladder
      // starts at the bottom rung rather than carrying over a mastery that was
      // earned for different words.
      await savePracticeMeta(freshPracticeMeta(Date.now()))
      // The archived copy is still encrypted under the phrase just retired.
      // Leaving it would hand anyone with this profile directory exactly the
      // vault the user was trying to move away from.
      await deleteArchivedVault()
      // The old key has nothing left to open.
      rawKey.fill(0)
      setResult({ rawKey: nextKey, data: nextData, stored: nextStored })
      setStep('done')
    } catch (err) {
      setDetail(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }

  switch (step) {
    case 'confirm':
      return (
        <Confirm
          stored={stored}
          rawKey={rawKey}
          onVerified={() => setStep('generate')}
          onCancel={onCancel}
        />
      )

    case 'generate':
      return (
        <PhraseGenerator
          onComplete={(w) => {
            setWords(w)
            setAssociations([])
            setStep('placement')
          }}
        />
      )

    case 'placement':
      return (
        <PlacementJourney
          words={words}
          onComplete={(a) => {
            setAssociations(a)
            setStep('gate')
          }}
        />
      )

    case 'gate':
      return (
        <Screen>
          <Title>Prove the New Route</Title>
          <Panel className="w-full space-y-3 text-sm">
            <p>
              The new words are in the house. What is left is the part that makes them yours: walking
              the route from memory, forward, backward, and out of order, and then typing the whole
              phrase cold.
            </p>
            <p className="text-dusk/70">
              Until you have done it, the old phrase is the one you actually know — and it is about to
              stop working.
            </p>
            <Button onClick={() => setStep('quiz-forward')}>Walk the route</Button>
          </Panel>
          <Panel className="w-full space-y-3 border-brick/60 bg-brick/10 text-sm">
            <p>
              <strong>You can skip the walks</strong> and seal the vault now. If you do, the only copy
              of the new phrase is the one on this screen: close the tab, forget a word, and every
              password inside is gone for good — there is no reset and no recovery.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="!border-brick !text-brick"
                onClick={() => void seal(words, associations)}
              >
                Skip the walks, seal it anyway
              </Button>
              <Button variant="ghost" onClick={onCancel}>
                Cancel, keep my current phrase
              </Button>
            </div>
          </Panel>
        </Screen>
      )

    case 'quiz-forward':
      return (
        <QuizWalk
          key={`fwd-${attempt}`}
          title="Walk the New Route Forward"
          subtitle="Type each word from memory, then open the compartment to check."
          words={words}
          associations={associations}
          order={words.map((_, i) => i)}
          onComplete={(misses) => {
            if (misses === 0) setStep('quiz-backward')
            else setAttempt((a) => a + 1)
          }}
        />
      )

    case 'quiz-backward':
      return (
        <QuizWalk
          key={`bwd-${attempt}`}
          title="Now Walk It Backward"
          subtitle="Wardrobe to mailbox. If you can do this, the new phrase is truly yours."
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
            if (misses === 0) setStep('mastery')
            else startRandomQuiz()
          }}
        />
      )

    case 'mastery':
      return (
        <MasteryTest
          words={words}
          onComplete={() => void seal(words, associations)}
          onRefresher={() => setStep('quiz-forward')}
        />
      )

    case 'sealing':
      return (
        <Screen>
          <Title>Re-locking the Vault</Title>
          <Panel className="w-full space-y-3 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-dusk/20 border-t-amber-glow" />
            <p className="text-sm text-dusk/80">
              Stretching the new phrase into a key and re-encrypting every password under it. Don&apos;t
              close this tab.
            </p>
          </Panel>
        </Screen>
      )

    case 'error':
      return (
        <Screen>
          <Title>That Didn&apos;t Work</Title>
          <Panel className="w-full space-y-3 text-center">
            <p className="font-semibold text-brick">{detail}</p>
            <p className="text-sm text-dusk/80">
              Nothing was changed — your current passphrase still opens the vault.
            </p>
            <div className="flex justify-center gap-3">
              <Button onClick={() => void seal(words, associations)}>Try again</Button>
              <Button variant="secondary" onClick={onCancel}>
                Back to the vault
              </Button>
            </div>
          </Panel>
        </Screen>
      )

    case 'done':
      return result ? (
        <Screen>
          <Title>New Phrase, Same Vault</Title>
          <Panel className="w-full space-y-4 text-center">
            <p className="text-lg font-semibold text-sage">Re-encrypted. 🎉</p>
            <p className="text-sm">
              Every password came across untouched. From now on it is the new words that open the
              door, and the practice schedule has started again from day one.
            </p>
            <p className="rounded-lg border-2 border-amber-glow/60 bg-amber-glow/10 p-3 text-left text-sm">
              <strong>Backup files you exported earlier still open with the old phrase.</strong> They
              are separate encrypted copies and changing the phrase here cannot reach them. If you
              changed it because the old one might be known, delete those files and export a fresh
              one now.
            </p>
            <div className="flex justify-center gap-3">
              <Button variant="secondary" onClick={() => downloadBackup(result.stored)}>
                Download new backup
              </Button>
              <Button onClick={() => onDone(result.rawKey, result.data, result.stored)}>
                Back to the vault
              </Button>
            </div>
          </Panel>
        </Screen>
      ) : null
  }
}

/**
 * Gate the whole flow behind the phrase that is being replaced.
 *
 * The vault is already open, so this proves nothing to the cryptography — it is
 * there for the person who walks up to an unattended unlocked screen. Without
 * it, changing the master passphrase is a one-click way to lock the owner out
 * of their own vault forever.
 */
function Confirm({
  stored,
  rawKey,
  onVerified,
  onCancel,
}: {
  stored: StoredVault
  rawKey: Uint8Array
  onVerified: () => void
  onCancel: () => void
}) {
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = async () => {
    if (!phrase.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const candidate = await deriveKey(phrase, fromBase64(stored.salt), stored.kdfParams)
      if (!keysMatch(candidate, rawKey)) {
        candidate.fill(0)
        setError('That is not the phrase this vault is locked with.')
        return
      }
      candidate.fill(0)
      setPhrase('')
      onVerified()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>Change Your Passphrase</Title>
      <Panel className="w-full space-y-3 text-sm">
        <p>
          You will generate a new phrase, place it through the house, and the vault will be
          re-encrypted under it. <strong>Your passwords are not touched</strong> — they come across
          exactly as they are.
        </p>
        <p>
          What does change: the old phrase stops opening this vault, the words and images in your
          house are replaced, and practice starts over from day one.
        </p>
        <p className="text-dusk/70">
          Worth knowing before you start: backup files you have already exported keep opening with
          the old phrase, because they are separate copies this cannot reach.
        </p>
      </Panel>
      <Panel className="w-full space-y-3 text-center">
        <p className="text-sm text-dusk/80">
          First, the phrase you have now — so that someone who found this screen unlocked cannot lock
          you out of your own vault.
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void check()
          }}
        >
          <input
            autoFocus
            type="password"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="your current passphrase…"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-lg border-2 border-dusk/40 bg-parchment px-3 py-2 text-center font-display text-lg tracking-wide focus:border-amber-glow focus:outline-none"
          />
          <div className="flex justify-center gap-3">
            <Button onClick={() => void check()} disabled={!phrase.trim() || busy}>
              {busy ? 'Checking…' : 'Continue'}
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
        {error && <p className="text-sm font-semibold text-brick">{error}</p>}
      </Panel>
    </Screen>
  )
}
