# 0018 — How long the undo-restore offer lives, and who may press it

**Status:** RESOLVED (user call, 2026-08-03) — see the resolution at the bottom.

## What is already true

`0016` ruled that the archive lives "until the next restore or a passphrase
change", and the lock screen offers to put it back for exactly that long. Two
properties follow that the ruling did not weigh, because they were not visible
until the affordance existed:

**It never expires.** A restore in March is still offered in June if nothing has
replaced the archive. `0016` noted this and called it possible clutter.

**It sits before the passphrase.** It has to: the case it exists for is a
restore whose phrase you do not have, so there is no key to authenticate with.
That makes it the only vault-altering control reachable on a locked device.

Since the review that followed `0016` it is a *swap*, not a one-way move
(`5debd28`), which removes the sharp edge — a press cannot destroy anything, and
both records are ciphertext, so nothing is disclosed either. What is left is:
someone with a moment at a locked machine can change which vault the device
opens. The owner returns, types the right phrase, and is told it is wrong. The
vault is intact and one press puts it back, but the minute in between is a
person believing they have lost their passwords.

## The decision

Should the offer be bounded, and if so by what?

- **Leave it.** Cheapest, and honest: the failure mode is a scare, not a loss.
- **Bound it by time** — offer it for N days after the restore. Simple, but the
  number is arbitrary and the archive would outlive the offer.
- **Bound it by the vault being used** — withdraw it once the live vault has
  been *edited*, on the grounds that a vault someone has saved a credential into
  is one they meant to keep. Does not cover the honest case of restoring a stale
  backup of your own vault, noticing later, and wanting the newer one back — but
  in that case the archive is still on disk and this is a UI question only.
- **Gate it on the archived vault's passphrase** — before swapping, ask for the
  phrase that opens the vault being put back and derive against it. This is the
  only option that actually authenticates, and it fits the case: whoever wants
  the previous vault back is the person who knows its phrase. It costs a KDF
  derive and a second field on the lock screen.

**Recommended default:** the passphrase gate. It turns "anyone at the keyboard"
into "the owner", costs about thirty lines, and needs no arbitrary number. If
that reads as too much friction on a recovery path, the fallback is to leave it
and say so in the README's security model, which already describes what an
unattended locked machine does and does not protect.

## Acceptance criteria for resuming

A pick from the four. The passphrase gate is an afternoon including a test that
a wrong phrase leaves both records where they were; leaving it is a paragraph.

## RESOLUTION (user call, 2026-08-03 — via exec assistant)

1. **Require passphrase to use undo-restore**: James said "go with the passphrase". The undo-restore swap must prompt for the archived vault’s passphrase and only proceed when it validates; a wrong passphrase leaves both vault records unchanged.
2. **Keep a light fallback as a possible future option**: James said "maybe make it a toggleable option". If implemented later, a setting can allow leaving the behavior as-is, but the default must be passphrase-gated for security.

## Implemented (2026-08-03)

The confirmation panel now carries a passphrase field, and the swap happens only
after the phrase has opened the archived record: derive against *that* record's
own salt and parameters, decrypt, and let GCM's authentication tag answer, which
is the same proof the unlock form uses and the only one this design has. A
phrase that does not open it leaves both records where they were. The derived
key is zeroed either way, before the swap — this proves a phrase, it does not
open a vault.

The gate is a function (`src/vault/undo.ts`) rather than a handler, because the
property worth testing is the negative and a React handler is not reachable from
this suite. Six tests: the swap on the right phrase, both records untouched on a
wrong one, the live vault's own phrase *not* opening the one set aside (that
phrase is the one whoever performed the restore does have), an archived record
carrying key-derivation settings we refuse to run stopping before the swap,
nothing changing if another context took the archive first, and the one below.

**One hole found while building it.** Proving a phrase and performing the swap
are a whole Argon2id derive apart — about a second — and a restore in another
copy of the UI replaces what is set aside inside that second. The first cut
authenticated the record the screen was showing and then put back whatever was
in the archive slot by the time it got there, which is the gate answering a
different question than it asks. `undoRestore` now takes the record the caller
proved and compares it inside the transaction that does the swap, in the same
shape `saveVault` already used for a vault re-keyed underneath a stale context;
a slot that changed yields "nothing was set aside after all", which the lock
screen already handles.

Two things worth James knowing:

1. **The phrase is typed twice on a real recovery** — once to authorise the
   swap, once to unlock the vault it put back. The key from the first derive is
   deliberately thrown away rather than used to open the vault: unlocking also
   upgrades old key-derivation settings, which rewrites the record, and quietly
   rewriting a vault at the moment it is swapped back is not something a
   confirmation dialog should do. If the second Argon2id wait reads as friction
   on a recovery path, unlocking straight through is a small change.
2. **The toggle in ruling 2 is not built.** The ruling made it conditional
   ("if implemented later"), and the default it specifies is what now ships. It
   would be a preference beside the five-minute session switch; worth doing only
   if the gate turns out to be in someone's way.

**Gates:** `npm test` 170 passed, seven of them new here (six in `undo.test.ts`,
one in `db.test.ts` for the record-identity check; the rest of the rise since
`0016` is `0017`'s). `npm run build` clean, `npm run visual` green,
`npm run autofill` 42/42.

## Adversarial review, same day

Five things, two of them ways around the gate rather than faults in it.

1. **The gate made the undo slow, and two slow operations now share one
   screen.** The unlock form stays live while the undo panel derives, and an
   unlock started alongside can finish first and unmount the screen. The swap it
   was racing still lands on disk, and the callback that followed would then
   tell an app that is *already unlocked* that the live record is a different
   vault — leaving it holding one vault's key beside another vault's header.
   The next credential save would seal under the wrong key with a header
   `saveVault`'s salt check accepts, and write a record no passphrase can open,
   over the very vault the gate exists to protect. The two are mutually
   exclusive now, and the callback is not made after teardown: the app keeps
   what it unlocked and its next save is refused with "lock and unlock to
   continue", which loses nothing. This was the review's hardest finding and it
   was created by `0018` itself — before the gate, the undo was a
   sub-millisecond database call and could not lose that race.
2. **The write side of the same second-wide window was open.** The gate stops an
   undo putting back a record it did not authenticate. It said nothing about the
   restore going the other way, which was two writes — set aside, then replace —
   with the archive slot holding the *still live* vault in between. An undo in
   another tab landing there would put the proven vault back, and the restore's
   second write would then drop the new vault on top of it: the vault whose
   passphrase had just been proven, gone from disk with no other copy. The pair
   is now one transaction (`restoreVault`), which is the only shape that closes
   it. A gate the write side can walk around is not a gate.
3. **`sameRecord` compared the body and not the header.** Ciphertext and IV
   identify one write of one vault, so it looked sufficient — but the caller's
   claim is "I opened this record", and what it opened was the header as much as
   the body. Same ciphertext, same IV, `memoryKiB` rewritten to something no
   browser will run: anyone who can write the archive slot can write that, the
   proof upstream derives against the sane parameters held in memory and
   succeeds, and the swap installs a live vault no passphrase can open. The
   comparison is now the whole record, KDF parameters field by field.
4. **`expecting` was optional, so the compiler could not enforce the gate.** A
   comment saying "nothing in the UI may call this directly" is not a constraint;
   `undoRestore()` with no argument would have built cleanly and swapped
   unauthenticated. It is required now.
5. **The screen assumed what was on disk.** After a restore or an undo it set
   the offer from the record it happened to be holding, which another context
   may have replaced. It reads the archive back instead — the record the offer
   names is the one the gate will be asked to match — and the post-swap path no
   longer has a call that can throw between the disk changing and the screen
   being told, which would have left the user typing the right phrase for what
   was in front of them and being told it was wrong.

One thing the review found that is *not* fixed here: the undo is not the only
vault-altering control on a locked screen, only the one that costs nothing but a
press. Restoring a backup file is not gated either, and a second restore
overwrites the archive slot for good. That needs a ruling rather than a patch,
so it is `0019`, and the README says plainly meanwhile that restore is
ungated.

Two test gaps came with them. The `db.test.ts` fixture hardcoded one IV and one
ciphertext for every record and varied only the salt, so `sameRecord` could have
been mutated down to comparing salts alone with every test still green — the
fixture now varies all three, and the case is asserted directly. And the
unsupported-parameters test accepted any throw, where only one of them means
what the test claims; it names the error now.

Still uncovered, and worth saying rather than leaving implied: no test exercises
the *wiring*. Nothing fails if the passphrase field is removed from the panel or
the button is rewired to call `undoRestore` directly — `undo.test.ts` proves the
function, not that the screen uses it. Vitest cannot reach a React handler here
(no jsdom in this project), but `npm run visual` already drives a real browser
and never reaches a restore or undo state; a scenario there is the honest way to
close it.

**Gates after the fixes:** `npm test` 172 passed, two more tests than `0018`
shipped with — the restore setting aside and replacing as one operation, and the
tampered header refused. `npm run build` clean, `npm run visual` green,
`npm run autofill` 42/42.
