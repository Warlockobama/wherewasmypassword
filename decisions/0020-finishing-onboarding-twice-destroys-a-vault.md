# 0020 — Finishing onboarding in a second tab destroys a vault, with no copy kept

**Status:** RESOLVED (user call, 2026-08-04) — see the resolution at the bottom.

## What prompted this

An adversarial review of the `0019` restore gate, looking for ways around it.
It did not find one. It found that the screen *next door* still has the property
`0019` was written to remove, in a worse form.

`Welcome.tsx` was changed this run to route its restore through the gate, on the
reasoning written into the code: "nothing *should* reach this screen with a
vault present, but 'should' is not a reason for the one destructive path to be
the unguarded one." The tutorial that same screen leads into ends at
`CreateVault`, which calls `sealVault(…)` with no `expecting` argument and so
reaches `saveVault(record)` — an unconditional `put` over whatever is in the
vault slot.

## The consequence

Two tabs on a browser with no vault, or two tabs after "Delete vault & start
over":

1. Tab A finishes the tutorial (or restores a backup) and now holds a vault.
2. Tab B, opened earlier and still walking its memory house, finishes minutes
   later and writes its own vault over the top.

Tab A's vault is gone. Not set aside — *gone*. The restore path at least keeps
one copy in the archive slot and offers it back on the lock screen; this path
keeps nothing, so there is nothing to undo and nothing to offer. It is the exact
harm `0016`, `0018` and `0019` have each spent a decision on, on the one screen
none of them looked at.

## What is already true

- It is not reachable from a locked screen. `App.tsx` has no `locked → welcome`
  transition, so this is not a lock-screen bypass and the `0019` gate is not
  weakened by it. Every other writer of the vault record — `ChangePassphrase`,
  `upgradeOnUnlock`, credential saves — passes `expecting` and is refused when
  the salt has moved.
  **[Corrected 2026-08-04: that last sentence was wrong. Only credential saves
  passed `expecting`; `ChangePassphrase` and `upgradeOnUnlock` went through
  `rekeyVault`, which had no such argument, and wrote unconditionally. Both
  could destroy a vault with no copy kept, by the same mechanism this doc is
  about. See the adversarial review at the end — they are fixed there.]**
- It needs the user's own second tab, or a second window they forgot about. It
  is a foot-gun rather than an attacker's path: nobody else can make tab B
  finish a tutorial.
- It is not new. It predates all three of those decisions.

## The decision

What should the last step of onboarding do when it finds a vault already there?

- **Refuse, and say so.** `sealVault` learns the same "there must be nothing
  here" check the restore now has, and `CreateVault` reports it: *this browser
  already has a vault — lock this tab and open it, or delete it first.* The user
  loses the walk they just did, which is real but recoverable: the phrase is in
  their head and the placement is the point. Nothing is destroyed.
- **Archive it, as a restore does.** The displaced vault goes to the archive
  slot and the lock screen offers it back. Symmetrical with `restoreVault`, and
  it costs the *other* thing in the slot. It also means an accidental second
  tutorial silently changes which vault the device opens, which is what `0018`
  decided was worth a passphrase.
- **Leave it.** Defensible on frequency — you have to open two tabs and finish
  two tutorials — but it is the only remaining path that destroys a vault with
  no copy at all, and it is one line of guard away from not being.

**Recommended default:** the first. It is the smallest change, it destroys
nothing in any ordering, and "you already have a vault" is a sentence a user can
act on. The second is more clever and buys less: the archive slot is more useful
holding a vault someone restored over than one they created over.

## Acceptance criteria for resuming

A pick. For the recommended one: an `expecting`-style refusal on the create
path, a message on `CreateVault`, and a test that a second create over a live
vault leaves the first vault exactly where it was.

## RESOLUTION (user call, 2026-08-04 — via exec assistant)

1. **Decision:** James said "go with that" to the recommended default. Onboarding must refuse creating a vault when one already exists, with an "you already have a vault" style message. This prevents silent overwrite and preserves the existing vault unchanged; add a test ensuring a second create attempt leaves the first vault intact.

## Implemented (2026-08-04)

`saveVault`'s `expecting` grows a second form. It was a record — "this vault,
still under the key I found it under", answered by a salt comparison. It is now
that record *or* `'no-vault'`, answered by whether the slot holds anything at
all, and both are checked inside the write transaction as before. The create
path could not have used the salt form: a vault sealed at the end of a tutorial
has a brand-new salt by definition, so every record already on disk looks like
somebody else's and there is nothing to compare against. A refusal raises
`VaultAlreadyExistsError` — its own class, because the answer differs from
`VaultSupersededError`'s "lock and unlock to continue": there is nothing to
re-read, the vault here is simply not the one you just built.

`rekeyVault` is the one door onto that write and is shared by all three things
that re-key — creating a vault, changing the passphrase, upgrading an old
vault's KDF settings — so it now has to be told which it is, as a required
argument with no default. That is deliberate in the same way `restoreVault`'s
`authorize` is: a future create path written as `rekeyVault(phrase, data, now)`
would otherwise compile straight into the unconditional overwrite this exists to
prevent, and the reasoning would be a rule nothing enforces.

`CreateVault` reports the refusal on a panel of its own with no "try again",
because trying again is the thing that must not happen, and offers the vault
that does exist instead — `App` clears the training material and routes that tab
to the lock screen, carrying the practice schedule the other tab wrote rather
than inventing a fresh one. The walk is lost, which is real; the phrase is in
the user's head and the vault is untouched.

**One thing found while building it.** The derive happens before the write is
refused, so a refusal that merely threw would leave a live vault key — derived
from a phrase the user has just been told to let go of — sitting in the heap of
a screen they are about to walk away from. `rekeyVault` now zeroes it on any
failure of the save, refusal or otherwise, and that is tested by wrapping the
real `deriveKey` and reading the buffer back afterwards.

**Gates:** `npm test` 218 passed, nine of them new here (five in `db.test.ts`
for what a write may land on — two of which pin the pre-existing salt check,
which had no coverage at all; four in `seal.test.ts` for the create path, one of
them the key wipe above).
`npm run build` clean, `npm run visual` all passed, `npm run autofill` 42/42.
Each new guard test was also run with its guard disabled and confirmed to fail.

## Adversarial review, same day

Three reviews — one hunting ways around the gate, one on the screen and its
wiring, one on whether the tests and comments say true things. The gate itself
held: `rekeyVault(…, 'create')` has one caller, `storage/db.ts` is still the only
module that touches the vault store, the popup and the service worker only read,
and the check is genuinely inside one transaction (an `await` on an IndexedDB
request keeps a transaction alive; it is an `await` on Argon2id or a settings
read that would not, which is what `restoreVault`'s "decide synchronously" is
about). What the reviews found was next door, and worse.

**The two writes either side of the gate were still unconditional.** `0020`'s
"what is already true" said `ChangePassphrase` and `upgradeOnUnlock` passed
`expecting` and were refused when the salt moved. They did not — both went
through `rekeyVault`, which had no such argument. The ruling was taken on a
premise that was false for two of the three writers it named; the sentence is
corrected in place above. `ChangePassphrase` holds the record it read while the
user walks placement and quizzes, which is minutes, and `upgradeOnUnlock` writes
from the record the lock screen loaded at mount. A second tab deleting that
vault and creating another inside either window ended with the write destroying
it — no archive, nothing to offer back, the same harm this doc is about, on two
more screens. `purpose` now carries the record (`'create' | { replacing }`), so
the salt check that existed all along applies to them.

**`saveVault` failed open on an empty slot.** A record `expecting` means "this
vault is there", but an absent one was treated as no objection, so a tab still
unlocked on a deleted vault put the whole thing back — its credentials, and the
phrase the user was walking away from — on its next credential save. Since this
change, the resurrected vault then refuses the tutorial they went to the welcome
screen to start. Deleting a vault also never broadcast a lock, unlike every
other operation that changes which vault the device opens, which is what left
that tab holding a live key; it does now.

**The create screen could tell the user the opposite of the truth.** The
housekeeping after the seal — practice schedule, storage persistence — was
inside the same `try` as the seal itself, so a failure there landed on the error
screen, which offers "Try again". That retry is now refused by this tab's own
vault, and the refusal panel would have said another tab made it and that the
phrase just learned guards nothing: the user told to discard the only phrase
that opens the vault they had in fact just created, at the moment a backup file
matters most. Housekeeping is non-fatal now, the same way the second half of a
passphrase change already was.

**And three smaller ones.** The refusal copy asserted *which* tab won, which the
check cannot know — a welcome-screen restore in another tab does it too — and
pointed at "Delete vault & start over" without saying what to do if you cannot
open the vault that is there; it now names clearing the extension's data, the
same honest dead end `0019` wrote onto the lock screen. Every refusal left an
unhandled `AbortError`: `idb` creates `tx.done` when the transaction is wrapped
and the abort rejects it, and nothing was awaiting it on that path. And the
route out of the refusal read the vault with no error handling, having already
cleared the walk, so a failed read left a button that silently did nothing.

**The comments were overclaiming in two places, and are fixed.** "The one case
where a salt comparison would be no use" was wrong: passing the fresh record as
`expecting` would refuse whenever anything was in the slot — the right answer,
reached by leaning on salt uniqueness rather than on the property being
asserted, and reported as "lock and unlock to continue", which is advice for a
different problem. And `rekeyVault` is the one door onto a *re-key*, not onto a
vault write: `sealVault(key, data, header)` and `saveVault(record)` both still
compile into an unconditional put, which is now written down rather than implied
away.

**The tests were verifying one caller of three.** Mislabelling the KDF upgrade
as a create passed the entire suite, because nothing in the upgrade tests ever
put a vault in the stand-in's slot — so the guard was never armed on the path
where a silent failure would have stopped every future upgrade dead, with
`upgradeOnUnlock` swallowing the error by design. Those tests now set the disk
state, and four mutations — each guard disabled in turn — were confirmed to fail
the suite.

**Left uncovered, and worth saying rather than implying.** There are still no
React component tests anywhere in this repo — `vite.config.ts` runs tests under
`node` with no DOM — so the whole UI half of this decision is reviewed, not
tested: the refusal panel, the deliberate absence of "Try again" on it, and all
of `App`'s routing to the vault that exists. `ChangePassphrase` has no test file
at all; its precondition is held by the type and by `rekeyVault`'s own tests.
And the transactional claim underneath all of this is still asserted in prose:
the `idb` stand-in these suites share has no isolation and no real rollback, so
nothing here would notice if the check moved outside the transaction.

**Gates after the fixes:** `npm test` 224 passed (six more), `npm run build`
clean, `npm run visual` all passed, `npm run autofill` 42/42.
