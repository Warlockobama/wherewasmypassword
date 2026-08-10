# 0027 — Does the password review warrant cutting v1.2.0?

**Status:** OPEN — needs James, because the last two steps are his.

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
