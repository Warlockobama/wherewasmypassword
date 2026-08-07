# 0023 — The directive queue is empty: what should the next slice be?

**Status:** RESOLVED (user call, 2026-08-07) — see the resolution at the bottom.

## Why this exists

Every doc from `0001` to `0021` is now DIRECTIVE or RESOLVED, and the work each
one asked for is committed. Gates on a clean tree: 224 tests, TypeScript clean,
production build clean. There is nothing queued. Rather than pick a direction
unilaterally and spend a week of sessions on it, here are the four candidates
with what each buys.

## The candidates

1. **Test the UI half.** Every test in this repo runs under `node` with no DOM
   (`app/vite.config.ts`: `environment: 'node'`), so there is not one React
   component test. The crypto, storage and vault logic are well covered; the
   screens are reviewed, not tested. That includes the refusal panels that
   `0019` and `0020` exist to produce — the last adversarial review said so
   itself, and `ChangePassphrase` still has no test file. Cost: a jsdom
   environment plus `@testing-library/react` in devDependencies — a supply-chain
   addition to a password manager, dev-only but worth James knowing about,
   which is why I have not just done it.
2. **Use it for real, end to end.** Build, load unpacked, create a vault from
   scratch, walk the house, store a credential, fill it on a real login page,
   export a backup, restore it. The autofill harness covers the fill path in
   two passes but substitutes the `activeTab` grant; the first-run journey has
   never been walked end to end by anyone but the tutorial's author. This is
   the cheapest way to find the thing no test is shaped like.
3. **Release plumbing** — see `0022`, which is the same question narrowed to
   distribution.
4. **New capability.** Nothing is asked for. Plausible: importing credentials
   out of the browser's own password store, a second memory house for a second
   vault, a "which of my passwords are weak" pass. All are v2-sized, and none
   is more valuable than the app being installable and proven.

## Recommended default

**2, then 1, then 3.** Walk it end to end first — a real first run is the only
check that can surprise us, and the bugs it finds outrank any test I would
write guessing at the same screens. Then close the UI test gap, so the next
security change to a screen can be verified rather than argued. Then release
plumbing, if `0022` comes back as "ship it".

Holding off on 4 entirely until the first three are done.

## Acceptance criteria for resuming

James names an order, or says "your call" — in which case I take the default
above and start with the end-to-end walk.

## RESOLUTION (user call, 2026-08-07 — via exec assistant)

1. **Decision:** James said "we'll go with that order." Proceed with the recommended priority: end-to-end real browser walk first, then add UI tests with a DOM environment, then release plumbing. Do not start new v2 capabilities until those are done.
