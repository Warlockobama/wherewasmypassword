import { IMAGEABLE_WORDLIST } from './imageable-wordlist.ts'
import { randomInt } from './random.ts'

// Generation draws from the concreteness-filtered list (picturable words only);
// entropy is honestly computed from that list's real size.
export const BITS_PER_WORD = Math.log2(IMAGEABLE_WORDLIST.length) // 11.14 for 2257

export const MIN_WORDS = 5
export const MAX_WORDS = 8
export const DEFAULT_WORDS = 6

export function generatePassphrase(count: number = DEFAULT_WORDS): string[] {
  if (count < MIN_WORDS || count > MAX_WORDS) {
    throw new RangeError(`word count must be ${MIN_WORDS}-${MAX_WORDS}, got ${count}`)
  }
  return Array.from({ length: count }, () => randomWord())
}

/** Uniform replacement keeps per-word re-rolls entropy-neutral. */
export function rerollWord(words: string[], index: number): string[] {
  const next = [...words]
  next[index] = randomWord()
  return next
}

export function phraseEntropyBits(wordCount: number): number {
  return Math.round(wordCount * BITS_PER_WORD * 10) / 10
}

/** Canonical form used for key derivation: lowercase, single-spaced. */
export function normalizePassphrase(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).join(' ')
}

function randomWord(): string {
  return IMAGEABLE_WORDLIST[randomInt(IMAGEABLE_WORDLIST.length)]
}
