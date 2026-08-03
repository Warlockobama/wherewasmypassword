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
