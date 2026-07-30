/** Expanding practice intervals, in days, after vault creation. */
const INTERVALS_DAYS = [1, 2, 4, 7, 14, 30]
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How much practice history the schedule needs. Deliberately just a count and
 * the most recent date: the schedule never wanted the full unlock timeline,
 * and storing one was a privacy leak (see `PracticeMeta`).
 */
export interface PracticeHistory {
  practiceCount: number
  lastPracticedAt: number | null
}

/**
 * Next time a practice unlock is due. After the ladder is exhausted,
 * settle into a steady every-30-days rhythm.
 */
export function nextPracticeAt(createdAt: number, history: PracticeHistory): number {
  // Type-checked rather than compared to null: this record comes off disk, and
  // a missing or non-numeric date would otherwise make every date downstream
  // NaN — which reads as "practice is never due" and renders as "NaN days".
  const step = typeof history.practiceCount === 'number' ? history.practiceCount : 0
  const last = typeof history.lastPracticedAt === 'number' ? history.lastPracticedAt : createdAt
  const intervalDays = INTERVALS_DAYS[Math.min(step, INTERVALS_DAYS.length - 1)]
  return last + intervalDays * DAY_MS
}

export function isPracticeDue(createdAt: number, history: PracticeHistory, now = Date.now()): boolean {
  return now >= nextPracticeAt(createdAt, history)
}

export function daysUntilPractice(
  createdAt: number,
  history: PracticeHistory,
  now = Date.now(),
): number {
  return Math.max(0, Math.ceil((nextPracticeAt(createdAt, history) - now) / DAY_MS))
}
