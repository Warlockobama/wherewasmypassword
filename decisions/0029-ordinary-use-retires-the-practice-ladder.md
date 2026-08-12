# 0029 — Six days of ordinary use retires the practice ladder

**Status:** RESOLVED (user call, 2026-08-12) — see the resolution at the bottom.

## The behaviour

`nextPracticeAt` indexes `INTERVALS_DAYS = [1, 2, 4, 7, 14, 30]` by
`practiceCount` (`srs/schedule.ts`), and `recordPracticeUnlock` increments
`practiceCount` on **every** unlock (`srs/practice.ts`), from both the full tab
and the toolbar popup.

So a person who creates a vault on Monday and unlocks once a day to fill a login
is at the top rung by Sunday: Tuesday's unlock schedules the next prompt two days
out, Wednesday's four, Thursday's seven, Friday's fourteen, Saturday's thirty.
They have never once recalled the phrase across a gap longer than a day, and the
app now intends to leave them alone for a month. With the popup it is faster
still — six fills in one morning puts the ladder at its top on day zero.

That is the inverse of expanding retrieval practice, which is the one claim the
whole product rests on: the intervals only mean something if each one is a gap
the user actually recalled across.

## Why it is a decision and not a bug fix

Because the fix has to choose what an unlock *is*, and the code already argues
both sides. `README` says "unlocking **is** the rehearsal", and `Popup.tsx`
declines to count a *resumed* five-minute session precisely because "counting it
would inflate the spaced-practice schedule into silence" — an argument that
applies just as well to the sixth keyed unlock of the same morning. Nobody has
said which reading is intended, and the difference is visible to the user as how
often the app asks them to prove they still know their phrase.

Three shapes, all small to implement:

1. **Advance only when the practice was due.** An unlock earlier than
   `nextPracticeAt` still records `lastPracticedAt` (it *was* a rehearsal) but
   does not move the step. The ladder then measures gaps actually survived. A
   heavy user is asked at 1, 2, 4, 7, 14, 30 days regardless of how often they
   unlock in between.
2. **Advance at most once per day.** Cheaper to reason about, and stops the
   popup's morning burst; still lets six consecutive days climb the whole
   ladder without a single long gap.
3. **Leave it.** Take the position that unlocking often *is* mastery, and the
   ladder is a floor on nagging rather than a measure of recall.

## Recommended default

**Option 1.** It is the one that matches what the intervals are for, it needs no
new stored field (`nextPracticeAt` is already computable from the record), and it
changes nothing for the user the schedule was designed around — someone who
unlocks when prompted sees exactly the same sequence. What it removes is the
case where routine use silently switches the training off.

Worth stating: this cannot be validated from here. `0026` left the four-week
cold-recall test with James, and that experiment is the only thing that can say
whether the ladder works at all. This is about not retiring it before it has
run.

## Also here, and deliberately not fixed

`recordPracticeUnlock` is a read-modify-write across two transactions
(`loadPracticeMeta` then `savePracticeMeta`). The tab and the popup unlocking at
the same moment both read *n* and both write *n+1*, losing one tick. It is real,
it is one practice count, and the fix depends on which option above is chosen —
so it waits for the same ruling rather than being patched twice.

## Acceptance criteria for resuming

James picks a shape, or says "your call" — in which case option 1 goes in, with
the counter made transactional in the same change.

## RESOLUTION (user call, 2026-08-12 — via exec assistant)

1. **Leave it as-is.** James said users who use it a lot probably don’t need the practice, and frequent unlocking can count as enough practice to reduce prompts. The spaced schedule remains a floor on nagging rather than a strict measure of recall gaps.

## What was done (2026-08-12)

Option 3, so `srs/schedule.ts` and `INTERVALS_DAYS` are untouched and every
keyed unlock still advances the ladder. `recordPracticeUnlock` now says that is
the intent rather than leaving the next reader to wonder whether it was noticed.

The lost update the doc parked — "it waits for the same ruling rather than being
patched twice" — is fixed, because the ruling no longer changes what the fix
would look like. `updatePracticeMeta` in `storage/db.ts` does the read, the
increment and the write on **one** readwrite transaction; IndexedDB runs those
one at a time over a store, so the tab and the popup unlocking in the same
moment now count twice instead of once. It migrates a legacy record on the way
through for the same reason `loadPracticeMeta` does — otherwise a record still
carrying the old timeline would be counted from a `practiceCount` it does not
have, and the timeline would survive the write.

Three tests cover it (`storage/db.test.ts`), and they are careful about what
they claim: the in-memory stand-in for `idb` cannot serialise transactions, so
the atomicity itself is IndexedDB's and untested here. What is asserted is the
half that is ours — one `readwrite` transaction over `meta`, a `get` and a `put`
on it, and nothing issued outside it, which is exactly how the gap would come
back. The real-browser journey gate exercises the path against genuine
IndexedDB.

**Status stays RESOLVED.**
