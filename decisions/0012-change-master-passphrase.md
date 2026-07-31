# 0012 — There is no way to change the master passphrase

**Status:** RESOLVED (user call, 2026-07-31) — see the resolution at the bottom.

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

## RESOLUTION (user call, 2026-07-31 — via exec assistant)

1. **Implement master passphrase change and KDF upgrade together**: James said "go with the recommendation." Implement a change-passphrase feature that re-encrypts the vault with a fresh salt and current KDF parameters, and include the related KDF upgrade path from decision 0013 since it shares the same code path.
2. **Handle training and placement safely**: Changing the phrase invalidates prior memory-house placement and training. Force placement and practice for the new phrase, while allowing a skip with a clear warning.
3. **Security-sensitive handling**: Treat this as security-sensitive work; ensure appropriate review and tests before release.

## Implemented (2026-07-31)

"Change passphrase" sits in Housekeeping on the unlocked screen and runs as its
own flow (`app/src/vault/ChangePassphrase.tsx`):

1. **Confirm the current phrase.** The vault is already open so this proves
   nothing to the cryptography — it is there for whoever walks up to an
   unattended unlocked screen, for whom this would otherwise be a one-click way
   to lock the owner out forever. Compared in constant time against the key in
   memory.
2. **Generate and place.** The full `PhraseGenerator` and `PlacementJourney`,
   as at first run. Placement is not skippable.
3. **The gate.** The practice walks and mastery test are offered, and *can* be
   skipped as the resolution allows — behind a plain warning that the only copy
   of the new phrase is the one on screen and there is no recovery.
4. **Re-key.** The same `rekeyVault` as `0013`: new salt, current parameters,
   the whole vault re-encrypted. Entries come across untouched; the vault keeps
   its birthday; the practice schedule restarts at day one.

Two things the flow does that were not in the question. It **deletes the
archived `previous` vault**, which is still encrypted under the phrase being
retired — leaving it would hand anyone with the profile directory exactly the
vault the user was moving away from, which defeats the remediation case from
`0008`. And it says plainly, on the way in and on the way out, that **backup
files exported earlier still open with the old phrase**: they are separate
copies this cannot reach, and someone changing their phrase because it may be
known needs to hear that rather than assume otherwise.
