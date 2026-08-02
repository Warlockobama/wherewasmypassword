# 0018 — How long the undo-restore offer lives, and who may press it

**Status:** OPEN — recommended default below. Nothing is blocked: the offer
shipped as `0016` ruled, and the swap it performs cannot destroy a vault, so
this is about tightening a nuisance rather than closing a hole.

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
