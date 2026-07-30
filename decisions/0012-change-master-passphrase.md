# 0012 — There is no way to change the master passphrase

**Status:** OPEN — split out of `0009`.

## The problem

The compromised-browser review (`0008`) concluded that if the vault is ever
open while the browser is compromised, the master phrase is burned permanently
and the only remedy is a new vault with a new phrase. **That remedy is not
implementable today.** There is no change-passphrase path, and the only route
to a new vault is Delete, which erases every stored credential with it. A user
who suspected a compromise would have to transcribe every password by hand
first.

There is a second cost: a phrase the user is still learning is effectively
permanent from the moment the vault is created. If they later decide the
imagery is not sticking, they cannot re-roll without losing the vault.

## The decision

Implement "change master passphrase"? The code is small — at unlock the
plaintext is already in hand, so a fresh salt, current KDF parameters, and a
re-encrypt is the whole job. It shares its code path with the KDF upgrade in
`0013`.

**Recommended default:** yes, implement it, together with `0013` since they
are one code path. Changing the phrase also means the memory-house placements
and the training schedule for the old phrase are stale — the recommendation is
to walk the user through placing the new phrase and reset the practice
schedule, keeping the vault contents untouched.

This is flagged rather than just built because it touches key derivation and
re-encrypts the whole vault, which the repo's rules treat as security-
sensitive.

## The one sub-question

Should changing the phrase force the user back through the placement and
mastery gate for the new phrase (safer: they actually learn it), or let them
skip straight to a working vault (faster, but they now hold a phrase they have
not memorized)? Recommended: force placement, allow skipping the gauntlet with
a clear warning.

## Acceptance criteria for resuming

A yes/no on implementing it, plus the sub-question if the answer is yes.
