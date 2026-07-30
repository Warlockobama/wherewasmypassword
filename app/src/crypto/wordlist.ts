import { IMAGEABLE_WORDLIST } from './imageable-wordlist.ts'
import { randomInt } from './random.ts'

// Generation draws from the concreteness-filtered list (picturable words only);
// entropy is honestly computed from that list's real size.
export const BITS_PER_WORD = Math.log2(IMAGEABLE_WORDLIST.length) // 11.14 for 2255

// 6 words = 66.8 bits. Five words (55.7 bits) is the one setting whose offline
// cracking cost is merely expensive rather than out of reach, and the vault is
// exactly the kind of material an attacker can attack offline at leisure — so
// the floor is the default.
export const MIN_WORDS = 6
export const MAX_WORDS = 8
export const DEFAULT_WORDS = 6

export function generatePassphrase(count: number = DEFAULT_WORDS): string[] {
  if (count < MIN_WORDS || count > MAX_WORDS) {
    throw new RangeError(`word count must be ${MIN_WORDS}-${MAX_WORDS}, got ${count}`)
  }
  return Array.from({ length: count }, () => randomWord())
}

/** Replace one word with a fresh uniform draw. See `rerollCostBits`. */
export function rerollWord(words: string[], index: number): string[] {
  const next = [...words]
  next[index] = randomWord()
  return next
}

/**
 * The most entropy a user may spend re-rolling, in bits.
 *
 * Re-rolling is NOT free, which the earlier "uniform replacement keeps
 * re-rolls entropy-neutral" comment got wrong. Each draw is uniform, but the
 * user keeps only the draw they like, and that is rejection sampling with a
 * predicate — memorability, familiarity, imageability — that an attacker can
 * buy off the shelf, since this wordlist was itself built from published
 * concreteness norms. Keeping roughly one word in four cuts the effective
 * alphabet to a quarter and a six-word phrase to about 55 bits: below the
 * five-word setting that was withdrawn for being too weak.
 *
 * Six bits still allows every word in a six-word phrase to be re-rolled once,
 * or one stubborn word to be re-rolled 63 times, and leaves a floor of about
 * 60.8 bits.
 *
 * This is a guardrail, not a boundary: the budget lives in component state, so
 * reloading mid-onboarding starts a fresh phrase with a fresh budget. That is
 * accepted. What it defends against is the user who re-rolls a dozen times
 * without realising it costs anything — and, just as much, a meter that used
 * to keep reporting 66.8 bits while they did it.
 */
export const MAX_REROLL_BITS = 6

/**
 * What has been spent choosing among alternatives. Picking one of k+1 offered
 * words costs log2(k+1) bits, and regenerating the whole phrase is charged the
 * same way — otherwise flipping the word count back and forth would be a free
 * re-roll.
 */
export function rerollCostBits(perWordRerolls: readonly number[], phraseRegenerations: number): number {
  const perWord = perWordRerolls.reduce((sum, k) => sum + Math.log2(k + 1), 0)
  return perWord + Math.log2(phraseRegenerations + 1)
}

export function phraseEntropyBits(wordCount: number, spentBits = 0): number {
  return Math.round((wordCount * BITS_PER_WORD - spentBits) * 10) / 10
}

/** Canonical form used for key derivation: lowercase, single-spaced. */
export function normalizePassphrase(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).join(' ')
}

function randomWord(): string {
  return IMAGEABLE_WORDLIST[randomInt(IMAGEABLE_WORDLIST.length)]
}
