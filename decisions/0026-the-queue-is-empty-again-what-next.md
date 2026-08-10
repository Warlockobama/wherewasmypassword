# 0026 — The 0023 order is finished: what is the next slice?

**Status:** RESOLVED (user call, 2026-08-09) — see the resolution at the bottom.

## Why this exists

`0023` gave an order and it is now spent. All three items are committed:

- **End to end in a real browser** — `npm run journey` walks the whole product
  in one fresh profile, 35 checks against what is on screen (`bd804a1`).
- **The UI test gap** — four jsdom screen suites now cover the refusals that
  `0019` and `0020` exist to produce, including the `ChangePassphrase` file that
  `0023` singled out as missing (`b300d49`).
- **Release plumbing** — v1.1.0 is published with a reproducible zip and a
  checksum, and `RELEASE.md` is the checklist (`aae4278`, `339b3e7`).

`0024` then cleared the dead prototypes out. Every doc from `0001` to `0024` is
DIRECTIVE or RESOLVED, gates are green on a clean tree (272 tests, 16 files;
`tsc -b` and the production build clean), and nothing is queued. `0023` held
back new capability until those three were done. They are done, so the hold
expires with this doc.

## What is worth doing, and who can do it

Three of these need James rather than a session, which is the main thing to say
out loud.

1. **The store question.** `RELEASE.md` already says it deserves its own doc and
   names what it turns on: whose developer account, what the listing claims
   about data handling, and the real one — a store listing means auto-update, so
   whatever is signed and pushed reaches every installed vault silently. For a
   password manager that is the decision, not the fee. `0022` deferred it rather
   than declining it. **Needs James.**

2. **Does anyone actually have it?** v1.1.0 has existed for two days and nobody
   has been asked to install it. One person who is not the author, loading the
   zip and building a vault, would find more than any slice I could write.
   **Needs James** — there is no user I can recruit from here.

3. **Does the method work?** The whole product rests on a claim nothing in the
   repo tests: that a person recalls a six-word phrase weeks later from the
   house alone. Spaced reminders fire at 1, 2, 4, 7, 14 and 30 days, and the
   no-telemetry posture means the only way to know is for a human to do it and
   report. James built a vault during the journey work; four weeks of unlocking
   it cold is the experiment. **Needs James**, and it needs elapsed time more
   than effort.

4. **A weak-and-reused pass over the vault.** For each stored credential: length
   and character-class weakness, and reuse of the same password across entries.
   Entirely local, entirely inside the already-unlocked vault, no new
   permissions, no crypto change, no network — the "have I been pwned" version
   of this is the one that would need a network call, and this repo does not
   make network calls, so it is deliberately not that. **I can do this alone.**

5. **A second browser.** Firefox's MV3 differs on service workers and
   `activeTab`; Safari needs a wrapper. Widens who can install, changes nothing
   about the product. **I can do this alone**, but it is plumbing.

6. **Import from the browser's own password store.** The obvious v2 feature and
   the one I would not start without a decision: it means parsing an exported
   plaintext CSV of every password the user has, which is a file this project
   would otherwise never let exist. It needs its own doc about how that file is
   handled and destroyed before any of it is written.

## Recommended default

**James takes 3 and 2 — they cost him minutes and nothing else can produce
them — and I build 4 while that runs.** The weak-and-reused pass is the largest
piece of real user value reachable without a security decision, and it does not
block on anything.

Holding 1 until James wants it, 5 until someone asks for Firefox, and 6 until it
has a doc of its own.

## Acceptance criteria for resuming

James names a direction, or says "your call" — in which case I take the default
and start on the weak-and-reused pass.

## RESOLUTION (user call, 2026-08-09 — via exec assistant)

1. **James said: "your call".** Proceed with the recommended default direction.
2. **Execution plan:** James will handle the product validation items (having someone else try the release and running the long-term recall test over time) when possible, while the team starts work on the weak-and-reused password pass in the already-unlocked vault, with no new permissions and no network calls.
3. **Deferrals:** Store listing decisions, a second browser, and import-from-browser-password-store remain deferred until explicitly prioritized or documented.
