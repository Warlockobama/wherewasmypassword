# 0010 — Status check: what are you working on and waiting on

**Status:** DIRECTIVE (user, 2026-07-30 — via exec assistant)

## The directive

James is checking in. Reply by appending a `## Status report (date)` section to this doc, and keep it short — it gets read aloud to him:

1. What you're working on right now (or last worked on).
2. What's blocked or waiting on James — for each, open a separate decision doc with `**Status:** OPEN` so his assistant can surface it and get you an answer.
3. Anything you'd recommend he prioritize next.

If nothing is waiting on him, say so plainly — that's a useful answer.

## Status report (2026-07-30)

1. **Last worked.** Nothing new is in flight — every directive so far is done
   and committed. The last one, `0008`, hardened the app against a compromised
   browser and proved out the fill path in a real browser. This session re-ran
   all the gates on a clean tree and they pass: 78 tests, TypeScript clean,
   production build clean.

2. **Four things are waiting on James, and everything left is one of them.**
   They were bundled in one doc, which was hard to answer piecemeal, so each is
   now its own OPEN doc:

   - `0011` — **autofill does not work at all**, confirmed in a real browser.
     The extension opens in a new tab, which moves the permission grant off the
     login page, so the fill can never reach it. Three ways out: a small popup,
     remembering the tab the icon was clicked on, or dropping autofill and
     accepting the clipboard. **Answer this one first.**
   - `0012` — there is no way to change the master passphrase, so the advice in
     `0008` ("start a new vault") cannot actually be followed without losing
     every stored password.
   - `0013` — existing vaults are frozen at their creation-time key-derivation
     strength forever; should they upgrade on unlock, and should unlock get
     slower (0.2s to 0.6s) in exchange for costing an attacker four times more?
   - `0014` — vault file size leaks the length of a newly added password to
     anyone holding two backups; padding fixes it but changes the vault format.

3. **Recommended priority: `0011`.** Autofill is the headline v2 feature and
   keeping passwords off the clipboard was the point of directive `0004`.
   Right now neither is true. `0012` is the next most valuable, and it is a
   safety net rather than a feature. `0013` and `0014` are real but can wait.
