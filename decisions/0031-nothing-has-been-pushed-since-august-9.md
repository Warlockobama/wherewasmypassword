# 0031 — Everything finished since August 9 has never left this machine

**Status:** OPEN — one small permission question, and it is now visible from
outside.

## What is true right now

The last push was 2026-08-09. Everything committed since sits on this disk
only — twelve commits as this line is written, and the number is not the point:
it goes up every time a session finishes something while the doc asking whether
it may push is itself unpushed. Twice now it has been rewritten only to be stale
again the same morning, so read it as "everything since August 9" and take the
list below as the snapshot it was:

```
07cb56f  Measure the review panel's contrast on the layer it is actually drawn on
460a87c  Keep 0031's count honest as the pile grows
fd529d0  Make the review panel say the severity it means, and be readable
121293f  Count both unlocks when the tab and the popup land together
c9d9020  Say what v1.1.0's checksum can and cannot prove
1d91b55  Say what the docs were getting wrong, and open the three calls this leaves
011e60b  Stop the review going quiet on the passwords it exists to catch
53ca474  Open the vault that is on disk, not the one the page loaded with
04cfe19  Stop two archives from ever being called 1.1.0
941259c  Drive the review in a real browser, and say what it is in the README
ee19088  Review the vault for weak and reused passwords
cff2e32  Close 0025, and name the key the doc missed
```

That includes `.gitattributes` — `0028`'s actual fix — the password-review
feature and the three rulings just carried out on it, a vault-freshness fix, the
release guard, and every decision doc from `0028` on. All five gates were re-run
on the tip on 2026-08-12 and are green: 345 tests, the build, 39 journey checks,
42 autofill checks, and the visual pass. The build was also done the way a
stranger would do it — `git clone`, `npm ci`, `npm run build` in a directory
that had never seen this project — because `RELEASE.md` records that v1.1.0
shipped a tree which passed here and failed there, and a working tree cannot
tell the difference on its own.

## Why it stopped being only a tidiness question today

`0028`'s ruling has been carried out: the v1.1.0 release notes now say the
archive cannot be rebuilt from its tag, and that **line endings are now pinned**
so the next release can be. That page is public. The commit it refers to is not.
Anyone who follows the correction to the repository today sees the tree that
produced the problem, with no sign of the fix.

The published note was worded to survive that — it claims the state of the
project, not the state of a branch, and it links to nothing that is missing. But
the gap closes the moment somebody pushes, and until then the repo quietly
contradicts the correction.

## What is being asked

**May a session run `git push origin master`?** Sessions have been committing
and leaving the push to someone else, and nothing says whether that is a habit
or a rule. It is not a judgement call to make silently: a push to a public
repository is outward-facing, and `0022` put this repo in front of strangers.

1. **Sessions may push `master` when their gates are green.** What it costs: a
   session decides when work becomes public. What it buys: the repo stops
   drifting a week behind, and corrections like `0028`'s land whole.
2. **Sessions never push; James pushes.** Clean and predictable. It also means a
   published correction can sit contradicted for as long as it takes.
3. **This once, then ask again.** Push what has piled up, leave the standing
   question.

## Recommended default

**Option 1, with the release path carved out.** Pushing `master` publishes
reviewed, tested commits and nothing is tagged or released by it — `RELEASE.md`
already makes tagging and `gh release create` deliberate acts, and those should
stay James's. The commits waiting are the argument: each was finished, gated,
and then stalled on nobody having permission to finish the sentence.

If option 1 is too broad, option 3 gets the tree honest this week and leaves the
policy for later.

## Acceptance criteria for resuming

James says which. Nothing else is blocked on it — the work is committed and the
release notes are already correct.
