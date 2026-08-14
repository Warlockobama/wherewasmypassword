# 0032 — v1.1.0 rejects a passphrase the user just changed. Does that reopen the release?

**Status:** OPEN — one release call, and the "what next" question behind it.

## Why this exists now

The queue is empty. Every doc from `0001` to `0031` is RESOLVED, DIRECTIVE or
SPLIT; `0031` was carried out today and `master` and `origin/master` are the same
commit for the first time since August 9. All five gates are green on that tip —
345 tests, the build, the visual pass, 42 autofill checks, 39 journey checks —
and the repository has no open Dependabot alerts.

So the question is what a session does next, and one candidate has changed since
it was last asked.

## What changed since `0027` said "let it ride"

`0027` asked whether the password review warranted v1.2.0 on August 11. James
said let it ride, and the doc's own argument for waiting was this sentence: the
review "is also not a fix for anything broken — nobody is at risk on v1.1.0 for
lack of it." That was true of the review. It is no longer true of the branch.

`53ca474` fixed a bug that is in the published zip. `App` reads the vault record
once, at page load, and hands it down; nothing on the lock screen read it again.
So after a master passphrase change, any lock screen sitting on top of a stale
copy of that record — another tab, or the same tab before the idle timer fired —
derives against the record that has been replaced. The consequence is exactly
backwards from what the product promises:

- the phrase the user has just spent a gauntlet memorising is **rejected**, with
  "That doesn't open the door";
- the phrase they were told is **retired opens the vault**, because the old
  record is still a self-consistent thing to decrypt;
- and every save after that is refused by the salt check.

Reloading the page clears it, and the popup was never affected — it re-reads on
every open. Nothing is destroyed and nothing leaks off the machine. But it is
reachable by doing the thing the app invites the user to do, it lands on the one
screen this product exists to make people trust, and a user on v1.1.0 has no way
to get the fix except a zip that does not exist yet.

`121293f` is the smaller one: two contexts unlocking in the same moment counted
one tick on the practice ladder instead of two, now a single transaction.

## What is being asked

1. **Does that fix warrant cutting v1.2.0, or does "let it ride" still hold?**
   `0027`'s reasoning was that the two experiments still with James — someone who
   is not the author installing the release, and the four-week cold-recall run —
   are aimed at v1.1.0, and cutting a release replaces the build they are aimed
   at. That reasoning is intact. What has changed is the cost of waiting: it is
   now a bug in a stranger's hands rather than a feature they do not have.

2. **If it rides, what should a session do next?** The three items `0026` left
   with James are all still outstanding — the store question, one non-author
   install, and the cold-recall test. Of the things a session can do alone,
   `0026` held Firefox until someone asks for it (nobody has asked, and no
   install is confirmed), and held import-from-the-browser's-password-store until
   it has a doc of its own about how a plaintext CSV of every password the user
   owns is handled and destroyed. Writing that doc is the one piece of that work
   that needs no ruling first.

## Recommended default

**Cut v1.2.0.** A session does `RELEASE.md` steps 1–5 and 8 — bump
`public/manifest.json` and `package.json` together, re-run the five gates, look
at the screenshots, package, and write `release-notes/v1.2.0.md` — and hands
James the two steps a session cannot do: step 6, the manual toolbar-click check
on a real login page, and step 7, the tag and `gh release create`. `0031`'s
ruling drew that line explicitly and it is not being asked to move.

Three things make now the moment rather than later:

- The fix reaches nobody until a zip exists, and there is no update channel to
  carry it afterwards either — whoever holds a zip stays on it.
- It would be **the first release whose checksum a stranger can reproduce**.
  `.gitattributes` pins line endings from `04cfe19`, and the corrected v1.1.0
  notes say in public that the next release can be rebuilt from its tag. Until
  one is cut, that is a promise nobody has tested.
- `master` cannot be packaged as 1.1.0 at all — `scripts/release-guard.mjs`
  refuses it (`0027`, `0028`). The version number is already stale in the only
  direction that matters.

Against it: the two experiments aimed at v1.1.0 have not reported, and neither
has been started as far as this repo knows. If they are about to run, holding is
reasonable — the bug needs a passphrase change to reach, and a first-time
installer will not make one on day one.

If the answer is to hold, the fallback is to write the CSV-import handling doc,
so that when import is wanted the decision is already waiting rather than
starting from nothing.

One thing that changed after this doc was written, the same evening: the
packaging path was hardened against four cases `RELEASE.md` claimed were already
refused and were not — optional permissions, a registered content script, an
inline source map, and an untracked file under `public/`, which is copied into
`dist/` byte for byte and so lands in the archive while nothing tracked has
changed. Zip entries are also ordered by their path inside the archive rather
than by the host's, so a Windows and a Linux build of the same commit cannot
diverge. None of that changes the answer below; it means that if the answer is
ship, the machinery doing it is in better shape than when the question was
asked.

## Acceptance criteria for resuming

James says ship it — the next session runs steps 1–5 and 8 and hands over the
zip, the checksum and the one manual check. Or he says hold, and names whether
the CSV-import doc is the right use of the meantime.
