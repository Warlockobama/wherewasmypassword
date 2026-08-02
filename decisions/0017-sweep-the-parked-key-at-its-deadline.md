# 0017 — Deleting the parked popup key at its deadline, not merely refusing it

**Status:** OPEN — recommended default below; the gap is closed as far as it
can be without a ruling, so nothing is blocked on this.

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
