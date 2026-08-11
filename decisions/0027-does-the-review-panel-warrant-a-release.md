# 0027 — Does the password review warrant cutting v1.2.0?

**Status:** RESOLVED (user call, 2026-08-11) — see the resolution at the bottom.

## Why this exists

The weak-and-reused pass `0026` asked for is built, tested and committed. It
is also, right now, reaching nobody: v1.1.0 is what the published zip contains,
there is no update channel, and `RELEASE.md` opens by saying so — whoever loaded
that zip stays on it until they notice a newer one and load it themselves.

So the feature exists on `master` and does not exist for any user. Closing that
gap means cutting a release, and two of the eight steps in `RELEASE.md` are ones
a session cannot do:

- **Step 6, the manual check.** A real login page, the toolbar button, the popup
  naming the site before Unlock and Fill. The list says: if the popup cannot name
  the site, stop. No harness substitutes for it.
- **Step 7, tag and publish.** `git tag` plus `gh release create` is outward
  facing and public. I am not taking that on unattended.

Everything before those two is done or reproducible on demand: gates are green
(319 unit tests over 18 files, `tsc -b` and the production build clean, and the
real-browser journey at 39 checks including four new ones that drive the panel).

## What is actually being asked

1. **Cut v1.2.0, or let this ride until something else is worth shipping with
   it?** A password review is a visible, self-contained addition, but it is also
   not a fix for anything broken — nobody is at risk on v1.1.0 for lack of it.
2. **If yes, who runs step 6?** It needs a browser, a real login page and about
   five minutes.

## Recommended default

**Let it ride.** Bump nothing yet. `0026` left two items with James — someone
who is not the author installing the release, and the four-week cold-recall
test — and both of those run against v1.1.0. Cutting v1.2.0 now replaces the
build those experiments are aimed at, for a feature neither of them is
testing. Better to gather what v1.1.0 tells us and ship the review with
whatever that turns up.

The cost of waiting is only that the review sits unused, and the person most
likely to benefit from it is the author, who can run it from source.

## Acceptance criteria for resuming

James says ship it — in which case the next session does steps 1–5 and step 8,
bumps `public/manifest.json` and `package.json` together, and hands him the zip
plus the one manual check. Or he says let it ride, and this closes with the
version untouched.

## RESOLUTION (user call, 2026-08-11 — via exec assistant)

1. **Ruling:** Let it ride for now. James said "yeah, let it ride for now," so do not cut v1.2.0 yet; keep v1.1.0 as the published zip while we continue gathering results and ship the review later with whatever else turns up.

## Carried out (2026-08-11)

Nothing shipped, which is the whole content of the ruling. `public/manifest.json`
and `package.json` both still read `1.1.0`, `v1.1.0` is still the only tag, and
the published zip is untouched — `b3561d88…44dd`, the same checksum the release
notes carry. No step of `RELEASE.md` was run beyond the gates, which were run to
confirm master is releasable whenever the answer changes: 320 tests over 18
files, `tsc -b` and the production build clean, `npm audit --omit=dev` zero.
(The doc above said 319; a screen assertion was added with the panel and the
count moved by one.)

**What waiting now costs, stated once so it is not a surprise later.** Master is
ahead of tag `v1.1.0` by the review panel — 1,187 lines across five files — while
still calling itself version 1.1.0. Anyone running `npm run package` on master
therefore writes `release/wherewasmypassword-1.1.0.zip` with contents the
published 1.1.0 does not have and a checksum that does not match the release
notes. The published artifact on GitHub is safe; the local file is what gets
overwritten, and it is recoverable by checking out the tag and packaging again.
This is a property of letting master run ahead of a version number, and it grows
with every feature that lands before the next release, so the packaging script
now refuses that case outright rather than leaving it to be noticed (`04cfe19`).
Checking that refusal is what turned up `0028`: the published checksum could not
be reproduced from the tag on any machine, for a reason that has nothing to do
with this ruling and everything to do with line endings.

Still with James, unchanged by this ruling and both aimed at v1.1.0: someone who
is not the author installing the release, and the four-week cold-recall test.
This doc closes.
