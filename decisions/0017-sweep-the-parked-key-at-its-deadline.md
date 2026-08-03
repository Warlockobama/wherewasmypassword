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
including the deadline proved in a real browser: a record parked in the shape
the popup writes, the alarm the popup arms, and then nothing but the shipped
worker's handler to delete it. (`when` under thirty seconds is clamped for a
packed extension but not an unpacked one, which is what the harness loads, so it
costs a second rather than half a minute.) `npm run visual` green.

## Adversarial review, same day

An independent pass over the change found five things worth fixing, one of them
worse than anything the decision was about.

1. **A browser with no `chrome.alarms` lost autofill entirely.** The worker
   registered `chrome.alarms.onAlarm` unguarded at its top level. A worker that
   throws while starting registers *nothing*, so the message listener below it
   never ran and both `wwmp-autofill-relay` and `wwmp-open-app` were dead —
   measured, not theorised. Every other browser API this file touches was
   already defended, and `session.ts` treats the alarms API as optional with two
   tests to say so; the worker was the one place that did not. Now guarded, with
   a test that a browser without the API still registers the relay and still
   sweeps.
2. **The park wrote the record before arming the alarm** — and the comment
   defending that order argued, correctly, for the opposite one. Nothing awaits
   `startPopupSession`, and a popup is destroyed the instant it loses focus, so
   being cut off between the two is real. An alarm with no record wakes the
   worker to find nothing; a record with no alarm is the whole gap. The alarm is
   armed first now, and again after the write.
3. **The clear counter does not cross documents.** It says "both live in the
   same popup", but the memory house has its own copy of this module and its own
   counter, and six of the clear call sites are in it. A "Lock now" there,
   landing inside a park here, can cancel an alarm this document never saw. Not
   closable with a counter — they are two ordinary racing writers of one storage
   area — so instead: arm on both sides of the write, and arm again whenever a
   popup resumes a session. Whatever an interleaving leaves parked has a
   deadline. The comment now says what is actually true.
4. **The worker's repair was inoperative on Chrome before 111 and never
   corrected a wrong time.** It asked `chrome.alarms.get` first, whose promise
   form is Chrome 111+ and which throws without a callback before that — a
   repair that silently never runs. And "an alarm exists" is not "an alarm for
   this deadline": a park whose `create` failed while an older alarm survived
   left the key watched by a wake-up at the wrong hour. It now simply says when
   the deadline is, every time; `create` on a fixed name replaces.
5. **Two of the ten worker tests passed vacuously**, including the one named for
   the headline behaviour: it parked an already-expired record, so the start-up
   sweep deleted it before the alarm was fired and the test passed with the
   handler deleted. Both rewritten and confirmed to fail under mutation, along
   with the rest.

Two smaller corrections came with them: the worker now applies the *shape* half
of the reader's rule as well as the deadline half, so a record with no key in it
is deleted rather than kept and armed for; and the alarm asks not to persist
across a browser restart where the browser knows that option (falling back to a
plain alarm where it does not), since the storage it sweeps is emptied at
browser close anyway and a persisted alarm is a note on disk of the minute a
vault was unlocked.

Two claims were also walked back rather than fixed. The comment that "parking a
key is what starts this worker" is wrong — `storage.session.set` starts a worker
only for a `storage.onChanged` listener, and there is none; the rule it was
defending (a sweep that finds nothing parked leaves the alarm alone) still
holds, because a fill message can start the worker while a popup is parking. And
the browser-level gate proves that a *running* worker handles its own alarm, not
that a stopped one is started for it: a worker with a debugger attached does not
idle out, so that half is Chrome's contract and outside what this harness can
observe.

**Gates after the fixes:** `npm test` 170 passed — seven more tests again, for
the order the park writes in, the fallback on both sides when a browser rejects
the persistence flag, the wake-up asking not to persist, the wake-up put back on
resume, a worker that starts without an alarms API, and a record with no key in
it. Every new test in both files was confirmed to fail under mutation of the
behaviour it names. `npm run build` clean, `npm run autofill` 42/42,
`npm run visual` green.
