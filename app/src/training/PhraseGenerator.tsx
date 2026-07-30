import { useState } from 'react'
import { IMAGEABLE_WORDLIST } from '../crypto/imageable-wordlist.ts'
import {
  DEFAULT_WORDS,
  MAX_REROLL_BITS,
  MAX_WORDS,
  MIN_WORDS,
  generatePassphrase,
  phraseEntropyBits,
  rerollCostBits,
  rerollWord,
} from '../crypto/wordlist.ts'
import { Button, Panel, Screen, Title } from '../ui.tsx'

export default function PhraseGenerator({ onComplete }: { onComplete: (words: string[]) => void }) {
  const [count, setCount] = useState(DEFAULT_WORDS)
  const [words, setWords] = useState<string[]>(() => generatePassphrase(DEFAULT_WORDS))
  // How many alternatives the user has looked at, per word and for the phrase
  // as a whole. Choosing among alternatives costs entropy, so it is counted
  // rather than assumed free, and the meter below shows the real number.
  // Always MAX_WORDS long, never trimmed to the current count: dropping the
  // tail when the user went from eight words back to six would make `spent`
  // fall, and cycling 8 -> 6 -> 8 would launder an exhausted budget.
  const [rerolls, setRerolls] = useState<number[]>(() => Array(MAX_WORDS).fill(0))
  const [regenerations, setRegenerations] = useState(0)

  const spent = rerollCostBits(rerolls, regenerations)
  const bits = phraseEntropyBits(count, spent)
  // The cost of looking at one more alternative, which is what decides whether
  // the budget can afford it.
  const nextWordCost = (i: number) => Math.log2(rerolls[i] + 2) - Math.log2(rerolls[i] + 1)
  const nextPhraseCost = Math.log2(regenerations + 2) - Math.log2(regenerations + 1)
  const canRerollWord = (i: number) => spent + nextWordCost(i) <= MAX_REROLL_BITS
  const canRegenerate = spent + nextPhraseCost <= MAX_REROLL_BITS

  const rerollOne = (i: number) => {
    if (!canRerollWord(i)) return
    setWords(rerollWord(words, i))
    setRerolls(rerolls.map((k, j) => (j === i ? k + 1 : k)))
  }

  /**
   * Any wholesale replacement — the button, or switching word count — is one
   * more phrase the user got to look at, so all of them are charged. Per-word
   * counts carry over deliberately: resetting them would make "re-roll all"
   * a way to launder an exhausted budget. Spending only ever goes up.
   */
  const regenerate = (n: number) => {
    if (!canRegenerate) return
    setCount(n)
    setWords(generatePassphrase(n))
    setRegenerations((r) => r + 1)
  }

  /** Choosing the count you are already on is not a re-roll, so it costs nothing. */
  const chooseCount = (n: number) => {
    if (n !== count) regenerate(n)
  }

  return (
    <Screen>
      <Title>Your Master Passphrase</Title>
      <Panel className="space-y-2 text-sm leading-relaxed">
        <p>
          These words are chosen by cryptographic dice from a list of{' '}
          {IMAGEABLE_WORDLIST.length.toLocaleString()} <em>picturable</em> words — things you can
          actually see, hold, or watch move, because that&apos;s what the house needs. No one,
          including you, gets to pick them: that randomness is the entire strength of your vault.
        </p>
        <p>
          You can re-roll a word that simply refuses to become an image, but every alternative you
          look at is a choice you made rather than the dice, and the meter below charges you for it.
          The budget runs out after about six single re-rolls — hunting for words you
          &quot;like&quot; is exactly what it exists to stop.
        </p>
        <p className="text-dusk/70">
          You won&apos;t need to write these down. The house will hold them until your head does.
        </p>
      </Panel>

      {/* word count */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-dusk/80">Words:</span>
        {Array.from({ length: MAX_WORDS - MIN_WORDS + 1 }, (_, i) => MIN_WORDS + i).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => chooseCount(n)}
            disabled={n !== count && !canRegenerate}
            className={`h-8 w-8 rounded-full border-2 text-sm font-bold transition-all ${
              n === count
                ? 'border-amber-glow bg-amber-glow text-white'
                : canRegenerate
                  ? 'border-dusk/40 text-dusk hover:border-dusk'
                  : 'cursor-not-allowed border-dusk/20 text-dusk/30'
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      {/* the words */}
      <div className="flex flex-wrap justify-center gap-2">
        {words.map((w, i) => (
          <span
            key={`${i}-${w}`}
            className="group flex items-center gap-2 rounded-lg border-2 border-dusk/40 bg-parchment-dark px-3 py-2 font-display text-lg"
          >
            <span className="text-xs text-dusk/50">{i + 1}</span>
            {w}
            <button
              type="button"
              title={
                canRerollWord(i)
                  ? 'Re-roll this word'
                  : 'Re-roll budget spent — every alternative you look at costs strength'
              }
              aria-label={`Re-roll word ${i + 1}`}
              disabled={!canRerollWord(i)}
              onClick={() => rerollOne(i)}
              className={
                canRerollWord(i)
                  ? 'text-dusk/40 transition-colors hover:text-amber-glow'
                  : 'cursor-not-allowed text-dusk/15'
              }
            >
              ↻
            </button>
          </span>
        ))}
      </div>

      {/* entropy meter */}
      <div className="w-full max-w-md">
        <div className="h-3 overflow-hidden rounded-full bg-dusk/15">
          <div
            className={`h-full rounded-full transition-all ${bits >= 65 ? 'bg-sage' : 'bg-amber-glow'}`}
            style={{ width: `${Math.min(100, (bits / 90) * 100)}%` }}
          />
        </div>
        <p className="mt-1 text-center text-xs text-dusk/70">
          ~{bits} bits of entropy —{' '}
          {bits >= 85
            ? 'excessive, in a good way'
            : bits >= 75
              ? 'extremely strong'
              : bits >= 65
                ? 'very strong'
                : 'strong'}
          . Behind slow key-stretching, brute force is out of reach.
        </p>
        {spent > 0 && (
          <p className="mt-1 text-center text-xs text-dusk/50">
            {canRegenerate
              ? `Re-rolling has cost ${Math.round(spent * 10) / 10} of those bits.`
              : 'Re-roll budget spent — this phrase is as chosen as it may get.'}
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" disabled={!canRegenerate} onClick={() => regenerate(count)}>
          Re-roll all
        </Button>
        <Button onClick={() => onComplete(words)}>Hide these in the house →</Button>
      </div>
    </Screen>
  )
}
