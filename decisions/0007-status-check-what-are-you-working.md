# 0007 — Status check: what are you working on and waiting on

**Status:** DIRECTIVE (user, 2026-07-30 — via exec assistant)

## The directive

James is checking in. Reply by appending a `## Status report (date)` section to this doc, and keep it short — it gets read aloud to him:

1. What you're working on right now (or last worked on).
2. What's blocked or waiting on James — for each, open a separate decision doc with `**Status:** OPEN` so his assistant can surface it and get you an answer.
3. Anything you'd recommend he prioritize next.

If nothing is waiting on him, say so plainly — that's a useful answer.

## Status report (2026-07-30)

1. **Last worked / just now.** The two most recent directives are both
   done and committed: v2 credential storage with autofill-first and
   30-second clipboard auto-clear (0004), and the polish/UX pass that
   fixed the demo-walk and quiz-walk animation timing (0005). This
   session re-ran every gate and found one real regression while
   checking: a vault created before the v2 credential feature has no
   `entries` field, so unlocking it crashed the unlocked screen. Fixed
   in the decrypt path with a test. Gates now: 34/34 tests pass,
   TypeScript clean, production build clean.

2. **One thing waiting on James:** decision doc `0006-mobile-version-
   proposal.md` is OPEN. The proposal compares PWA, Capacitor, and a
   React Native rewrite and recommends starting with a PWA. It needs
   four calls: platform priority, packaging, whether biometric unlock
   is wanted, and whether mobile is view-only or full parity. The PWA
   path can start immediately if James is fine with the recommendation.
   Nothing else is blocked.

3. **Recommended next.** Verify autofill end to end in a real browser —
   load the packed extension and fill an actual login page. It is
   covered by unit tests but has never been exercised against a live
   site, and it is the headline v2 feature.

### Addendum, later the same day

The mobile answer arrived (defer, focus on the extension) and the new
directive `0008` landed while this session was still running. Both were
picked up: mobile work is parked on a branch and off master, and the
compromised-browser review is written up in `0008` with the fixes committed.
Three calls now wait on James in `0009`, one of which — popup versus tab —
may be the reason autofill does not currently work at all.
