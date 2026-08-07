# 0024 — Dependabot is guarding a prototype nobody builds

**Status:** OPEN — needs a call from James.

## What turned up

Cutting the first release (`0022`) meant pushing to the public repo for the
first time in a while, which surfaced five open Dependabot pull requests:

| # | | |
|---|---|---|
| 7 | Bump postcss and next | `/wherewasmypassword` |
| 4 | Bump picomatch | `/wherewasmypassword` |
| 3 | Bump minimatch | `/wherewasmypassword` |
| 2 | Bump glob and sucrase | `/wherewasmypassword` |
| 1 | Bump brace-expansion and sucrase | `/wherewasmypassword` |

Every one of them is against `wherewasmypassword/` — the dead Next.js
Street-View prototype. Not one touches `app/`, which is the product. Dependabot
found a lockfile, and the lockfile belongs to code that has not been built since
the occlusion problem killed that approach.

So the alert channel that should tell us about a real dependency problem in the
shipping extension is instead five notifications about a Next.js app nobody
runs, and has been since 28 July.

## Why this is a decision and not a cleanup

`wherewasmypassword/`, `go_wwmp/` and `deeps/` are kept on purpose. `CLAUDE.md`
names them as dead, and the README explains what they were and why they failed —
that history is genuinely useful, and it is part of the honest story of the
project. Deleting them is not obviously right just because a bot is noisy about
one of them.

## The options

- **Delete the three dead prototype directories.** The story survives in the
  README and in git history. Dependabot goes quiet, the repo stops looking like
  it contains four half-projects, and a stranger arriving at a password manager
  sees the password manager. Irreversible only in the shallow sense — `git log`
  still has everything.
- **Keep them and scope Dependabot to `app/`.** A `.github/dependabot.yml`
  naming only `/app` for npm. Cheapest, changes nothing about the repo's shape,
  and leaves three unbuilt prototypes with vulnerable lockfiles sitting in a
  public repo — which is cosmetically bad for a security-sensitive project even
  though nothing installs them.
- **Keep them and delete just the lockfiles.** Splits the difference and leaves
  the prototypes unbuildable, which they already effectively are.
- **Do nothing.** Close the PRs as won't-fix and accept the noise.

## Recommended default

**Scope Dependabot to `app/`, and add one line to each dead directory's story.**
The alerts are the actual problem and a config file fixes them today. Deleting
the prototypes is a bigger, tidier change that should be its own choice rather
than something that happens because a bot complained — and the README leans on
them being there.

If James would rather the repo be just the product now that it has a public
release, deleting all three is a ten-minute change and I would do it in one
commit.

## Acceptance criteria for resuming

James picks one. Either way the five open PRs get closed, since none of them
touches anything that ships.
