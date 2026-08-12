import { freshPracticeMeta, updatePracticeMeta, type PracticeMeta } from '../storage/db.ts'

/**
 * Count one practice unlock and return the updated record.
 *
 * Shared by the full tab and the toolbar popup: both unlocks are the same act
 * of recalling the phrase from memory, and the spaced-practice schedule would
 * drift into nagging if the popup — soon the more common way in — did not count.
 * `decisions/0029` settled that every keyed unlock counts, however often they
 * come: someone using the vault daily has earned the quiet.
 *
 * The current record is read from disk rather than taken from the caller's
 * state, because the two contexts have separate copies of it and the last one
 * to save should not roll the other's count back. Read and write are one
 * transaction for the sharper version of the same problem: unlock the tab and
 * the popup in the same moment and a load-then-save pair drops one of the two
 * ticks on the floor.
 */
export async function recordPracticeUnlock(now = Date.now()): Promise<PracticeMeta> {
  return updatePracticeMeta((current) => {
    const base = current ?? freshPracticeMeta(now)
    return { ...base, practiceCount: base.practiceCount + 1, lastPracticedAt: now }
  })
}
