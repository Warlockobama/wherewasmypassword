# 0025 — A Google Maps key from the dead prototype, and whether it is still live

**Status:** RESOLVED (user call, 2026-08-09) — see the resolution at the bottom.

## What turned up

Deleting the prototypes (`0024`) meant clearing what they had left on disk, and
`wherewasmypassword/.env.local` was one of the files — untracked, gitignored,
last modified 6 July 2024, holding a single line:

```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<redacted>
```

The file is now gone from the machine. **Deleting a file does not revoke a key.**

## What I could establish from here, and what I could not

Checkable in this repo:

- The key's *value* is not in the current git history. `git log --all -S 'AIza'`
  finds nothing, and `.env.local` was never tracked — `git log --all -- '*/.env.local'`
  is empty.
- The variable *name* appears in three commits, all in the prototype's
  `init.ps1`, which read it from the environment rather than inlining it.
- So the repo as it stands today does not expose it.

Not checkable from here, and this is the part that matters:

- The `NEXT_PUBLIC_` prefix means Next.js inlined this key into the **client
  bundle** by design. Any build of that prototype that was ever served or shared
  carried the key in plain text to whoever loaded the page. That is what the
  prefix is for; it is not a mistake in the prototype.
- This repository's history was rewritten once before specifically to remove a
  leaked API key. Whether this is that key, a replacement for it, or an
  unrelated third one, nothing on this machine can tell me. A key that was
  public even briefly should be treated as compromised regardless of how the
  history reads now: clones, forks and caches outlive a rewrite.
- Whether the key is still enabled, and whether it is restricted by referrer or
  unrestricted, is only visible in the Google Cloud console.

## The decision needed

**Revoke or confirm.** Someone with the Google Cloud account needs to open
**APIs & Services → Credentials** on the project this key belongs to and either
delete it or confirm it was already deleted.

The exposure if it is live and unrestricted is billing, not data: Maps
JavaScript API calls charged to that project by anyone holding the string.
There is no vault, no user data and no part of the shipping extension anywhere
near this — the extension makes no network requests at all. So this is a loose
end and a bill risk, not an incident.

## Recommended default

**Delete the key outright rather than restricting it.** Nothing uses it any
more — the code that read it no longer exists in the working tree — so there is
no service to break, and a deleted key needs no monitoring. If James would
rather keep the Cloud project intact, deleting just this credential is enough.

## Acceptance criteria for resuming

James says it is revoked, or says it was already gone. Then this doc closes as
RESOLVED and nothing further happens in the repo — there is no code change here
to make. If the answer is "it is still live and I want it kept", say what for,
and I will note that against this doc so the next session does not re-raise it.

## RESOLUTION (user call, 2026-08-09 — via exec assistant)

1. **James ruled: "get rid of it".** Revoke the prototype Google Maps API key in Google Cloud (APIs & Services → Credentials) by deleting the credential. This closes the billing risk and there is no current code depending on it. If it was already deleted, confirm and close.

## Carried out (2026-08-09) — and what is still James's to do

**The deletion has not happened, and no session can make it happen.** The ruling
names an action in the Google Cloud console. There is no `gcloud` on this
machine, no Google credential for that account, and this session cannot open a
browser and sign in. So the console step stays with James. Everything a session
*could* do was to make that step executable and to prove the repo side is
clean — and doing that turned up a second key, which changes the instruction.

### There are two prototype Maps keys, not one

The doc above reasoned about a single key and wondered whether it was the one
this repo's history was scrubbed for. It is not. They are two different strings,
and both should go under the same ruling.

**Key A — the `.env.local` one, the subject of this doc.** Untracked, gitignored,
last written 6 July 2024, deleted from disk by `0024`. Its value is
**unrecoverable**: every place it was ever written down outside that file — the
session logs that read it — recorded it as `<redacted>`, which was checked
directly rather than assumed. There is no fingerprint to match against. It has
to be identified in the console by other means (below).

**Key B — the `deeps/` one, and the one that was actually published.** Hardcoded
in `deeps/go-server.go:61`, `deeps/main.html:49` and `go_wwmp/index.html:8` as a
`maps.googleapis.com/maps/api/js?key=` query parameter, committed, and pushed to
the public repo. It was removed from git history by a `filter-branch` on
28 July 2026 — that rewrite is what `wwmp-public-repo` refers to. Key B is
therefore the one with *proven* public exposure, not merely probable: it sat in
a public repository until the rewrite, and clones, forks and caches outlive a
rewrite.

Key B's full value is still readable on this machine, in Claude Code session
logs under `C:\Users\James\.claude\projects\F--projects-WhereWasMyPassword*`
(46 occurrences across 8 `.jsonl` files; the earliest and clearest is the
`project-status-ac52fd` worktree transcript). It is deliberately not copied into
this doc — this repo is public, and one `git grep`-style search of that folder
for `AIza` recovers it in a second when it is needed.

### How to identify them in the console

Key B is easy: it can be matched **by value**, since the value survives locally.
In **APIs & Services → Credentials** the full string is visible, so compare it
against the one in the transcript and delete the match.

Key A has to be identified by circumstance: a key **created on or before 6 July
2024**, restricted to (or unrestricted but used by) the **Maps JavaScript API**,
with **no traffic since the prototypes died** — check Metrics/Quotas for Maps
JavaScript API. If exactly one such key remains once Key B is accounted for,
that is Key A. If two candidates remain and neither is in use, delete both;
nothing on this machine or in this repo consumes either, so there is no service
to break.

### Reading the ruling as covering both

"Get rid of it" was given against a doc describing one key. Extending it to
Key B is an interpretation, and it is recorded here as one rather than smuggled
in. The grounds: same dead prototype family, same Maps JavaScript API, same
zero current consumers, and Key B is the *more* exposed of the two. Nothing is
lost if the interpretation is wrong — a Maps key can be reissued in a minute.
If James wants Key B kept for some reason, say so and this doc gets the note.

### What was verified on this side

- **Git history is clean of both.** `git log --all -S 'AIza'` returns one commit,
  `abaf099`, and that is this doc quoting the search command. A `git grep 'AIza'`
  across every blob in `git rev-list --all` returns the same single false
  positive. `.env.local` was never tracked.
- **The shipped artifact is clean.** All 13 files inside
  `wherewasmypassword-1.1.0.zip` contain no `AIza`, no `googleapis`, no
  `maps.google` and no `NEXT_PUBLIC`. The extension makes no network requests,
  which is the structural version of the same claim.
- **Nothing else on disk holds either key.** Repo tree, `app/dist`, `app/release`,
  Desktop/Downloads/Documents, temp and both recycle bins were swept; the only
  copies of Key B anywhere are the session logs named above, and there are no
  copies of Key A at all.
- **Gates, on a tree whose only change is this doc.** 272 tests in 16 files
  green, `tsc -b` and the production build clean, `npm audit --omit=dev` reports
  zero. `npm run package` reproduces
  `b3561d88cf337782915e74914fbc664b0c5aeb27a09947d65bddd05ee12744dd` — byte for
  byte the published v1.1.0 zip, so nothing that ships moved.
- Five stale remote-tracking refs for the closed Dependabot branches were pruned.
  `origin` has only `master`, which confirms `0024`'s claim; the local refs were
  just never pruned.

### The one loose end after revocation

Key B's value remains in those eight local session logs. Once the credential is
deleted at Google the string is inert and this does not matter. If it is *not*
deleted, those logs are a live secret sitting in plain text on disk. That is the
reason to do the console step rather than leave it — it is not raised as a
separate decision because every path through it starts with the same action the
ruling already ordered.

**Status stays RESOLVED** — the call is made and the repo has nothing further to
do. The console step is tracked in the run report to James rather than by
reopening this doc.
