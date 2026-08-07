# 0021 — Status check: what are you working on and waiting on

**Status:** DIRECTIVE (user, 2026-08-07 — via exec assistant)

## The directive

James is checking in. Reply by appending a `## Status report (date)` section to this doc, and keep it short — it gets read aloud to him:

1. What you're working on right now (or last worked on).
2. What's blocked or waiting on James — for each, open a separate decision doc with `**Status:** OPEN` so his assistant can surface it and get you an answer.
3. Anything you'd recommend he prioritize next.

If nothing is waiting on him, say so plainly — that's a useful answer.

## Status report (2026-08-07)

1. **Last worked.** `0020` — onboarding finishing in a second tab used to write
   over an existing vault with no copy kept. That's fixed, and an adversarial
   review of the fix found three more writers with the same flaw (change
   passphrase, the KDF upgrade on unlock, and a credential save resurrecting a
   deleted vault); those are fixed and committed too. Nothing has been in
   flight since. This session re-ran every gate on a clean tree: 224 tests,
   TypeScript clean, production build clean, visual checks pass, and all 42
   autofill checks pass in a real browser.

2. **Nothing is blocked, and that's the notable part — the queue is empty.**
   Every doc from `0001` to `0021` is done. Two things now need James rather
   than me, and each has its own OPEN doc:

   - `0022` — **how does this reach a browser other than James's?** The only
     install route is clone-and-build; there's no zip, no release, no store
     listing. Recommended: cut a downloadable release now, hold the store
     submission, because a store listing means accepting silent auto-update
     into people's password vaults and that should be a deliberate choice.
   - `0023` — **what should the next slice be?** Four candidates, recommended
     order: walk the whole thing end to end in a real browser first, then
     close the UI test gap (there is not one React component test in the
     repo — the screens the last two security decisions produced are
     reviewed, not tested), then release plumbing.

3. **Recommended priority: `0023`, and "your call" is a fine answer to it.**
   If he'd rather not choose, the default is the end-to-end walk — the app has
   never been used start to finish by anyone but its own tutorial, and that's
   the cheapest place left to find a real bug. `0022` matters the moment he
   wants anyone else to try it.
