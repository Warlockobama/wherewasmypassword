# 0017 — Deleting the parked popup key at its deadline, not merely refusing it

**Status:** RESOLVED (user call, 2026-08-03) — see the resolution at the bottom.

## What is already true

The opt-in five-minute popup session (`0015`) parks the derived key in
`chrome.storage.session`. Past the deadline nothing will hand that key back:
`resumePopupSession` refuses it and deletes it.

But *refusing* and *deleting* are different moments, and only refusal is
immediate. Deleting needs something to be running at the deadline, and at the
deadline there is nothing: the popup that parked the key was destroyed by the
browser the instant the user clicked away, and an MV3 service worker is killed
after about thirty idle seconds — a `setTimeout` in it does not survive.

So today the record is deleted on the next popup open, on the next start of the
worker (which sweeps — `public/background.js`), and unconditionally when the
browser closes, since that storage area is emptied. The gap left is: opt in,
unlock the popup, never open it again, and leave the browser running all day.
The key is unusable through the app from minute five, and still sitting in
browser memory at minute four hundred, where a debugger's storage pane or
anything that can run code in the extension's own context can read it.

## The decision

`chrome.alarms` is the only mechanism that reliably wakes an MV3 worker at a
future time. Using it would make "the key is gone after five minutes" true
rather than nearly true. It costs one more permission.

That is the whole question: **is closing this worth a third permission?**

`alarms` grants nothing outside the extension and shows the user no new warning
at install — it is about as small as a permission gets. Against that, the
permission set is deliberately pinned by a check in `npm run autofill` precisely
so that additions are decisions rather than drift, and `0011` ruled that the
popup flow must keep permissions "unchanged and unbroadened". `0015` has already
spent one on `storage`.

**Recommended default:** add `alarms`, set a one-shot alarm for the deadline
when a key is parked, clear it on every lock. It is perhaps fifteen lines and it
turns a documented "usually" into an "always". If the answer is no, the README
sentence stays as it is — it already says plainly that the key is refused at the
deadline and deleted the next time the extension runs — and nothing else changes.

Worth weighing honestly before answering: this only matters against an attacker
who is already inside the browser or at the keyboard, and `0008` concluded that
against the first of those nothing here survives anyway. It narrows a window,
it does not close a class.

## Acceptance criteria for resuming

A yes or no. If yes it is an hour, including a test that the alarm is armed on
park and cancelled on lock, and the permission check in `scripts/autofill-check.mjs`
updated to the new exact set.

## RESOLUTION (user call, 2026-08-03 — via exec assistant)

1. **Add the alarms permission and enforce deadline deletion**: James said "we'll go with that". Implement a one-shot alarm when a key is parked so the extension wakes and deletes it at the five-minute deadline, and clear the alarm on lock. Update tests and the permission check to match.
2. **Keep existing restrictions**: Continue to refuse access to the key after the deadline and avoid broadening behavior beyond the permission needed for deadline cleanup.

## Implemented (2026-08-03)

`alarms` is the fourth permission. Parking a key arms one one-shot alarm named
`popup-session-deadline` for the deadline the key already has — not five minutes
from the park, so ticking the box mid-session still ends when that session was
always going to end. Every clear cancels it, which means every lock: the popup's
Lock button, "Lock now" in the memory house, a passphrase change, a restore, an
undo, a delete, and turning the setting off. Always the one name, so a second
unlock replaces the wake-up rather than leaving one pointed at a key that is no
longer there.

The worker registers `chrome.alarms.onAlarm` at its top level — registered any
later there is nothing for the browser to start it *for*, and the alarm is
delivered to nobody. It deletes the record, then cancels the alarm; the two are
in that order deliberately, since the reverse can leave a key parked with
nothing left to sweep it.

Three things came with it that were not asked for and are worth naming:

1. **The worker now deletes what a reader would refuse, not merely what has
   expired.** Its old rule was `expiresAt <= now`, which misses a record dated
   *further ahead* than a whole session — what a clock stepped backwards leaves
   behind. `session.ts` has refused those since `0015`, so nothing would ever
   pick one up again, and nothing would ever delete it either. The worker now
   applies `withinLimit` to the letter.
2. **A worker start repairs a missing wake-up.** If a live key is parked and no
   alarm is armed — the browser refused it, or a sweep raced a park — the worker
   arms one. "A parked key always has something watching it" is the property
   this doc bought; leaving it resting on one call site would be a thinner
   version of it.
3. **A sweep that finds nothing parked deliberately does not cancel the alarm.**
   Parking a key is one of the things that starts the worker, so "no record" can
   mean "not written yet", and cancelling then would take the deadline away from
   a key about to exist. A stale alarm only ever wakes the worker to find
   nothing, which costs nothing.

**What it still does not close.** Chrome will not fire an alarm less than thirty
seconds out, so a key parked with seconds left on it — ticking the box four and
a half minutes in — can outlive its deadline by that much, refused the whole
time. And `0008` stands: against a browser already running an attacker's code
this narrows a window, it does not close a class.

**Gates:** `npm test` 156 passed, 18 of them new — eight in `session.test.ts`
(the wake-up armed for the deadline in hand, not armed while the session is off,
cancelled by a lock and by the switch, only ever one of them, and the key still
parked on a browser whose alarms API is missing or refuses), and ten in a new
`background.test.ts` covering the worker half, which had no tests at all before.
`npm run build` clean. `npm run autofill` 42/42 — five more than before,
including the deadline proved end to end in a real browser: a record parked in
the shape the popup writes, the alarm the popup arms, and then nothing but the
shipped worker, which wakes and deletes it. (`when` under thirty seconds is
clamped for a packed extension but not an unpacked one, which is what the
harness loads, so it costs a second rather than half a minute.)
`npm run visual` green.
