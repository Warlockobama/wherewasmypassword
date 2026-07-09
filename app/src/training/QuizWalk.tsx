import { useState } from 'react'
import Palace from '../palace/Palace.tsx'
import { LOCI } from '../palace/loci.ts'
import { ClueCard, MysteryCard } from '../palace/rooms/shared.tsx'
import type { Association } from '../crypto/vault.ts'
import { normalizePassphrase } from '../crypto/wordlist.ts'
import { Button, Panel, Screen, Title } from '../ui.tsx'

/**
 * Walk the route in the given order; at each stop the user types the word
 * BEFORE the compartment opens to confirm. Per-word feedback is fine here:
 * everything is in memory, nothing has touched storage yet.
 */
export default function QuizWalk({
  title,
  subtitle,
  words,
  associations,
  order,
  onComplete,
}: {
  title: string
  subtitle: string
  words: string[]
  associations: Association[]
  order: number[]
  onComplete: (misses: number) => void
}) {
  const [pos, setPos] = useState(0)
  const [guess, setGuess] = useState('')
  const [revealed, setRevealed] = useState<null | { correct: boolean }>(null)
  const [misses, setMisses] = useState(0)
  // Blocks input while the compartment-closing animation plays, so a fast
  // answer can't land on the wrong stop.
  const [transitioning, setTransitioning] = useState(false)

  const step = order[pos]
  const locus = LOCI[step]
  const assoc = associations[step]

  // Unopened stops show nothing; the current stop shows the real card only after answering.
  const clues = {
    [locus.id]: revealed ? (
      <ClueCard word={assoc.word} imagery={assoc.imagery} />
    ) : (
      <MysteryCard />
    ),
  }

  const submit = () => {
    if (!guess.trim()) return
    const correct = normalizePassphrase(guess) === normalizePassphrase(assoc.word)
    if (!correct) setMisses(misses + 1)
    setRevealed({ correct })
  }

  const advance = () => {
    setRevealed(null)
    setGuess('')
    setTransitioning(true)
    if (pos < order.length - 1) {
      setTimeout(() => {
        setPos(pos + 1)
        setTransitioning(false)
      }, 450)
    } else {
      setTimeout(() => onComplete(misses), 450)
    }
  }

  return (
    <Screen wide>
      <Title>{title}</Title>
      <p className="-mt-2 text-center text-sm text-dusk/70">{subtitle}</p>
      <Palace
        stepIndex={step}
        clues={clues}
        openLocusId={revealed ? locus.id : null}
        onLocusClick={() => {}}
        highlightLocusId={null}
        activeLocusCount={words.length}
        completedSteps={new Set(order.slice(0, pos))}
        showNav={false}
      />
      <Panel className="w-full space-y-3 text-center">
        {transitioning ? (
          <p className="text-dusk/50">…</p>
        ) : !revealed ? (
          <>
            <p>
              Stop {pos + 1} of {order.length}: what did you hide{' '}
              <strong>{locus.prompt}</strong>?
            </p>
            <form
              className="flex justify-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <input
                autoFocus
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                placeholder="type the word…"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="rounded-lg border-2 border-dusk/40 bg-parchment px-3 py-2 font-display text-lg focus:border-amber-glow focus:outline-none"
              />
              <Button onClick={submit} disabled={!guess.trim()}>
                Open it
              </Button>
            </form>
          </>
        ) : (
          <div className="space-y-3">
            {revealed.correct ? (
              <p className="font-semibold text-sage">Yes — {assoc.word.toUpperCase()}.</p>
            ) : (
              <p className="font-semibold text-brick">
                It was {assoc.word.toUpperCase()} — <em>{assoc.imagery || 'replay your image'}</em>. Take a good look.
              </p>
            )}
            <Button onClick={advance}>{pos < order.length - 1 ? 'Next stop →' : 'Finish this pass'}</Button>
          </div>
        )}
      </Panel>
    </Screen>
  )
}
