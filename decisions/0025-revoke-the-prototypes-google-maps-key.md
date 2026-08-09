# 0025 — A Google Maps key from the dead prototype, and whether it is still live

**Status:** OPEN — needs one action outside this repo, which only James can take.

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
