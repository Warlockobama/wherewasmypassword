# 0031 — Seven commits of finished work have never left this machine

**Status:** OPEN — one small permission question, and it is now visible from
outside.

## What is true right now

`master` is seven commits ahead of `origin/master`. The last push was
2026-08-09; everything since sits on this disk only:

```
1d91b55  Say what the docs were getting wrong, and open the three calls this leaves
011e60b  Stop the review going quiet on the passwords it exists to catch
53ca474  Open the vault that is on disk, not the one the page loaded with
04cfe19  Stop two archives from ever being called 1.1.0
941259c  Drive the review in a real browser, and say what it is in the README
ee19088  Review the vault for weak and reused passwords
cff2e32  Close 0025, and name the key the doc missed
```

That includes `.gitattributes` — `0028`'s actual fix — the password-review
feature, a vault-freshness fix, the release guard, and every decision doc from
`0028` on.

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
3. **This once, then ask again.** Push the seven, leave the standing question.

## Recommended default

**Option 1, with the release path carved out.** Pushing `master` publishes
reviewed, tested commits and nothing is tagged or released by it — `RELEASE.md`
already makes tagging and `gh release create` deliberate acts, and those should
stay James's. The seven commits waiting are the argument: each was finished,
gated, and then stalled on nobody having permission to finish the sentence.

If option 1 is too broad, option 3 gets the tree honest this week and leaves the
policy for later.

## Acceptance criteria for resuming

James says which. Nothing else is blocked on it — the work is committed and the
release notes are already correct.
