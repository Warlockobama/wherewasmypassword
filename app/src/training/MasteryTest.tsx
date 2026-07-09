import { useState } from 'react'
import { normalizePassphrase } from '../crypto/wordlist.ts'
import { Button, Panel, Screen, Title } from '../ui.tsx'

const REQUIRED_SUCCESSES = 2

/** Final gate: type the whole phrase cold, twice in a row, no palace visible. */
export default function MasteryTest({
  words,
  onComplete,
  onRefresher,
}: {
  words: string[]
  onComplete: () => void
  onRefresher: () => void
}) {
  const [attempt, setAttempt] = useState('')
  const [successes, setSuccesses] = useState(0)
  const [lastResult, setLastResult] = useState<null | 'pass' | 'fail'>(null)
  const [failStreak, setFailStreak] = useState(0)

  const target = normalizePassphrase(words.join(' '))

  const submit = () => {
    if (!attempt.trim()) return
    if (normalizePassphrase(attempt) === target) {
      const n = successes + 1
      setSuccesses(n)
      setFailStreak(0)
      setLastResult('pass')
      setAttempt('')
      if (n >= REQUIRED_SUCCESSES) onComplete()
    } else {
      setSuccesses(0)
      setFailStreak(failStreak + 1)
      setLastResult('fail')
    }
  }

  return (
    <Screen>
      <Title>The Mastery Test</Title>
      <Panel className="w-full space-y-4 text-center">
        <p>
          No house this time. Close your eyes, stand at the mailbox, and walk the route in your mind.
          Type all {words.length} words in order, separated by spaces — <strong>twice in a row</strong>.
        </p>
        <div className="flex justify-center gap-2">
          {Array.from({ length: REQUIRED_SUCCESSES }, (_, i) => (
            <span
              key={i}
              className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-lg font-bold ${
                i < successes ? 'border-sage bg-sage text-white' : 'border-dusk/30 text-dusk/40'
              }`}
            >
              ✓
            </span>
          ))}
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            autoFocus
            value={attempt}
            onChange={(e) => setAttempt(e.target.value)}
            placeholder={`${words.length} words, in route order…`}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-lg border-2 border-dusk/40 bg-parchment px-3 py-2 text-center font-display text-lg focus:border-amber-glow focus:outline-none"
          />
          <Button onClick={submit} disabled={!attempt.trim()}>
            Check
          </Button>
        </form>
        {lastResult === 'fail' && (
          <div className="space-y-2">
            <p className="font-semibold text-brick">
              Not quite. Don&apos;t reread your notes — go stand at the mailbox in your mind.
            </p>
            {failStreak >= 2 && (
              <Button variant="secondary" onClick={onRefresher}>
                Take a refresher walk through the house
              </Button>
            )}
          </div>
        )}
        {lastResult === 'pass' && successes < REQUIRED_SUCCESSES && (
          <p className="font-semibold text-sage">Once more to make it stick.</p>
        )}
      </Panel>
    </Screen>
  )
}
