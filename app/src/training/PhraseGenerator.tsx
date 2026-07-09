import { useState } from 'react'
import { IMAGEABLE_WORDLIST } from '../crypto/imageable-wordlist.ts'
import {
  DEFAULT_WORDS,
  MAX_WORDS,
  MIN_WORDS,
  generatePassphrase,
  phraseEntropyBits,
  rerollWord,
} from '../crypto/wordlist.ts'
import { Button, Panel, Screen, Title } from '../ui.tsx'

export default function PhraseGenerator({ onComplete }: { onComplete: (words: string[]) => void }) {
  const [count, setCount] = useState(DEFAULT_WORDS)
  const [words, setWords] = useState<string[]>(() => generatePassphrase(DEFAULT_WORDS))

  const bits = phraseEntropyBits(count)

  const setCountAndRegen = (n: number) => {
    setCount(n)
    setWords(generatePassphrase(n))
  }

  return (
    <Screen>
      <Title>Your Master Passphrase</Title>
      <Panel className="space-y-2 text-sm leading-relaxed">
        <p>
          These words are chosen by cryptographic dice from a list of{' '}
          {IMAGEABLE_WORDLIST.length.toLocaleString()} <em>picturable</em> words — things you can
          actually see, hold, or watch move, because that&apos;s what the house needs. No one,
          including you, gets to pick them: that randomness is the entire strength of your vault, so
          don&apos;t hunt for words you &quot;like&quot;; re-roll only if a word refuses to become an
          image.
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
            onClick={() => setCountAndRegen(n)}
            className={`h-8 w-8 rounded-full border-2 text-sm font-bold transition-all ${
              n === count
                ? 'border-amber-glow bg-amber-glow text-white'
                : 'border-dusk/40 text-dusk hover:border-dusk'
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
              title="Re-roll this word"
              aria-label={`Re-roll word ${i + 1}`}
              onClick={() => setWords(rerollWord(words, i))}
              className="text-dusk/40 transition-colors hover:text-amber-glow"
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
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => setWords(generatePassphrase(count))}>
          Re-roll all
        </Button>
        <Button onClick={() => onComplete(words)}>Hide these in the house →</Button>
      </div>
    </Screen>
  )
}
