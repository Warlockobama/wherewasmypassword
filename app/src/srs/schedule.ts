/** Expanding practice intervals, in days, after vault creation. */
const INTERVALS_DAYS = [1, 2, 4, 7, 14, 30]
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Next time a practice unlock is due. After the ladder is exhausted,
 * settle into a steady every-30-days rhythm.
 */
export function nextPracticeAt(createdAt: number, practicedAt: number[]): number {
  const step = practicedAt.length
  const last = step === 0 ? createdAt : Math.max(...practicedAt)
  const intervalDays = INTERVALS_DAYS[Math.min(step, INTERVALS_DAYS.length - 1)]
  return last + intervalDays * DAY_MS
}

export function isPracticeDue(createdAt: number, practicedAt: number[], now = Date.now()): boolean {
  return now >= nextPracticeAt(createdAt, practicedAt)
}

export function daysUntilPractice(createdAt: number, practicedAt: number[], now = Date.now()): number {
  return Math.max(0, Math.ceil((nextPracticeAt(createdAt, practicedAt) - now) / DAY_MS))
}
