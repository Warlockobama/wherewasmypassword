# 0028 — v1.1.0's published checksum cannot be reproduced from its tag

**Status:** OPEN — needs a call on what to tell whoever downloads v1.1.0.

## What was found, and how

Closing `0027` meant proving master is releasable whenever the answer changes,
which meant packaging from the tag and comparing. It does not match.

- Published: `wherewasmypassword-1.1.0.zip`, SHA-256 `b3561d88…44dd`, which is
  what the release notes tell a stranger to check against.
- Built from a fresh checkout of `v1.1.0` on this machine, same tools, same
  `node_modules`: `0e1eacd2…e445`.

The two archives differ in four files and nowhere else — `background.js`,
`content.js`, `manifest.json`, `popup.html` — and they differ only by one byte
per line. `background.js` is 15,850 bytes published and 16,202 from the
checkout: 352 lines, 352 carriage returns. Every bundled asset is byte-identical,
which is what says the build is not at fault.

The cause is `core.autocrlf=true`, git's Windows default. Blobs are stored LF
and checked out CRLF, and `public/` is copied into `dist/` verbatim — so the
line endings that ship are whatever the *checkout* produced. The working tree
that built the published archive had LF in those four files (they had been
rewritten in place and never re-checked-out), so the published zip is LF. Any
fresh checkout on Windows is CRLF.

The uncomfortable part: this means **nobody could reproduce v1.1.0**, not just
Windows users. A Linux or macOS checkout gives LF for those four files but also
LF for `index.html`, which the published archive has with CRLF. The only tree
that reproduces `b3561d88` is the one it was built from — which is why
`0025`'s check passed: it re-packaged from that same working tree.

## What is already done

- **`.gitattributes` pins `* text=auto eol=lf`** (`04cfe19`). From that commit
  on, the checkout decides what ships rather than the developer's git config,
  on every platform. The next release is reproducible in the way the README
  claims; this is not a decision, it is the fix.
- **README and `RELEASE.md` now say v1.1.0 is the exception.** A checksum that
  cannot be checked is worse than no checksum, so the claim is corrected rather
  than left standing.
- **`npm run package` refuses to build an archive under a version that is
  already a tag** unless the tree is that tag (`scripts/release-guard.mjs`) —
  the neighbouring way two files come to share one version.

## What needs James

**What do we owe whoever already has v1.1.0?** Three answers, and the middle one
is the recommendation.

1. **Say nothing.** The zip on GitHub is unchanged and safe; only the *check* is
   broken. Cheapest, and it leaves a published number that quietly means
   nothing.
2. **Amend the v1.1.0 release notes** to say the archive predates the line-ending
   fix and cannot be reproduced from the tag, pointing at the SHA-256 as an
   integrity check on the file we published rather than a proof of what is in
   it. Costs one edit on GitHub, which is outward-facing and therefore James's
   to make or to tell me to make.
3. **Re-cut v1.1.0** — delete and republish the asset built from a pinned
   checkout. Makes the property true retroactively and breaks anyone who
   recorded the old hash, for a difference that is entirely whitespace.

## Recommended default

**Option 2.** The download is not compromised and there is nothing to withdraw;
what is wrong is a sentence promising something checkable. Correcting the
sentence is proportionate, and it costs one paragraph in a release note. `0027`
said the review rides until something else is worth shipping — so v1.2.0, when
it comes, will be the first archive the reproducibility claim is true for, and
it will be true because of `.gitattributes` rather than because anyone
remembered.

## Acceptance criteria for resuming

James says which of the three, or "your call". Option 2 needs either his hands
on the GitHub release or an explicit go-ahead for a session to edit it via `gh` —
publishing to an outward-facing page is not something to assume.
