import { randomInt } from '../crypto/random.ts'

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*-_=+?'
const ALL = UPPER + LOWER + DIGITS + SYMBOLS

/**
 * Generate a cryptographically random password of the given length.
 * Guarantees at least one character from each class (upper, lower, digit,
 * symbol) by placing one forced pick, then filling the rest uniformly from
 * the full alphabet, then shuffling the whole thing.
 */
export function generateSitePassword(length = 20): string {
  if (length < 4) throw new RangeError('Password must be at least 4 characters')

  const chars: string[] = [
    UPPER[randomInt(UPPER.length)],
    LOWER[randomInt(LOWER.length)],
    DIGITS[randomInt(DIGITS.length)],
    SYMBOLS[randomInt(SYMBOLS.length)],
  ]
  for (let i = 4; i < length; i++) {
    chars.push(ALL[randomInt(ALL.length)])
  }
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
