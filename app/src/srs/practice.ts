import {
  freshPracticeMeta,
  loadPracticeMeta,
  savePracticeMeta,
  type PracticeMeta,
} from '../storage/db.ts'

/**
 * Count one practice unlock and return the updated record.
 *
 * Shared by the full tab and the toolbar popup: both unlocks are the same act
 * of recalling the phrase from memory, and the spaced-practice schedule would
 * drift into nagging if the popup — soon the more common way in — did not count.
 *
 * The current record is read from disk rather than taken from the caller's
 * state, because the two contexts have separate copies of it and the last one
 * to save should not roll the other's count back.
 */
export async function recordPracticeUnlock(now = Date.now()): Promise<PracticeMeta> {
  const current = (await loadPracticeMeta()) ?? freshPracticeMeta(now)
  const next: PracticeMeta = {
    ...current,
    practiceCount: current.practiceCount + 1,
    lastPracticedAt: now,
  }
  await savePracticeMeta(next)
  return next
}
