# 0022 — How does v1 actually reach a user's browser?

**Status:** RESOLVED (user call, 2026-08-07) — see the resolution at the bottom.

## The locked direction

`0006` settled it: no mobile app, focus on the extension. The extension is
built and works — MV3, `app/public/manifest.json` at version 1.1.0, `activeTab`
+ `scripting` + `storage` + `alarms`, popup autofill, no network permission at
all. What has never been decided is how anyone other than James installs it.

## What is true today

The only documented route is the developer one, in `README.md` under "Install
as a browser extension": clone, `npm run build`, enable Developer mode, Load
unpacked, point at `app/dist`. `dist/` is gitignored, so a checkout has nothing
installable in it. There is no packaging script, no zip, no release, no tag, no
store listing. Every gate in the repo assumes a build tree, not an artifact.

That is fine for one user who is also the developer. It is the whole story for
everyone else.

## The decision

Three routes, and they are not exclusive:

- **A tagged GitHub release with a zip.** Add `npm run package`: build, zip
  `dist/` as `wherewasmypassword-1.1.0.zip`, print a SHA-256. Users still Load
  unpacked, but from a downloaded folder rather than a toolchain. Cheap, no
  account, no review, no auto-update — and no auto-update means a user who
  installs a version with a bug stays on it until they notice a new one.
- **Chrome Web Store / Edge Add-ons.** Real installability, real update
  channel, and the extension ID becomes stable, which matters for
  `externally_connectable` later. Costs a developer account and a one-off fee,
  a privacy disclosure (easy here: nothing leaves the device), and a review
  that will ask why a password manager wants `scripting`. It also means
  accepting auto-update: whatever is signed and pushed reaches every installed
  vault silently. For this category of software that is the significant part
  of the decision, not the fee.
- **Neither yet.** Keep it a personal build. Say so plainly in the README so
  nobody reads "Install as a browser extension" as an invitation.

## Recommended default

**A, now; B only when James wants an audience.** Add the packaging script and
cut `v1.1.0` as a GitHub release with a checksum, so the thing is installable
by a person who is not holding a Node toolchain. Hold the store submission —
it is a one-way door on identity and auto-update, and it should be taken
deliberately rather than as a side effect of wanting an install link.

Doing A also forces the one thing the repo does not have: a release checklist
that ends with the manual browser check already written into the README.

## Acceptance criteria for resuming

James picks A, B, both, or neither. If A: I add `npm run package` and the
release checklist, and cut the tag. If B: I need to know whose developer
account and what the listing should say about data handling — that is a second
round of questions, not something to guess at.

## RESOLUTION (user call, 2026-08-07 — via exec assistant)

1. **Decision:** James said "one now" for a packaged download, and "we’ll go with the store once we have it stable and ready for an audience." Proceed with a tagged GitHub release and packaging workflow now (zip and checksum), and defer Chrome/Edge store submission until a later stage when stability and audience goals are met.
