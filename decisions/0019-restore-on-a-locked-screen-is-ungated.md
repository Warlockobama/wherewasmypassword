# 0019 — Restoring a backup is ungated, and it can consume the undo's archive

**Status:** OPEN — recommended default at the bottom; nothing has been changed
beyond correcting a claim in the README that this doc shows was not true.

## What prompted this

`0018` put the archived vault's passphrase in front of the undo, on the
reasoning — written into that doc, this README, and the code — that the undo was
*the only vault-altering control reachable on a locked device*. Building it and
then reviewing the result showed that sentence is wrong. "Restore from a backup
file instead" sits on the same locked screen, asks for nothing, and writes the
vault record.

The gate is still worth having: a press is cheaper than bringing a file, and it
was the press that anyone passing a locked machine could make. But the claim
that motivated it overstated what it bought, and one specific consequence
deserves a decision rather than a paragraph.

## The consequence

There is one archive slot, and a restore overwrites it unconditionally.

Live vault V, nothing set aside. Someone restores their own backup B: archive
becomes V, live becomes B — the state `0018` is about, and the passphrase gate
correctly stops them undoing it. So they restore B a second time. The archive
slot takes B (whatever is live at that moment), **V is gone from disk**, and no
passphrase was asked for at any point. The gate now protects a slot that the
control above it emptied for free.

This is not new behaviour — `0016` chose one slot deliberately, and `db.test.ts`
has pinned "the first vault is gone for good" as intended retention since then.
What is new is that `0018` spent an Argon2id derive on the assumption that the
archive was reachable only through the gate.

## The decision

Four options, cheapest first:

- **Leave it, and say so.** The README paragraph is already written (this run).
  Honest, costs nothing, and the loss needs someone at your unlocked-enough
  machine *with a backup file in hand* — a real but narrow attacker.
- **Refuse to overwrite a non-empty archive.** One line: if something is already
  set aside, a restore keeps it rather than replacing it. Closes the two-restore
  path completely. The cost is that the second restore's outgoing vault is not
  recoverable, which is the opposite trade from today and arguably worse for the
  honest case (restore the wrong file twice in a row while sorting through
  backups).
- **Gate restore on the incoming backup's passphrase.** Symmetrical with `0018`
  and re-uses its code — prove you can open the file before it replaces
  anything. It authenticates the person as *someone who owns the incoming
  vault*, which is not the same as owning the machine, so it stops a passer-by
  and not a determined one. It also adds an Argon2id wait to the honest recovery
  path, where the user is about to type that same phrase anyway.
- **Gate restore on the *live* vault's passphrase.** The only one that
  authenticates the owner of what is being destroyed. It also makes restore
  unusable in the case it mainly exists for — a vault whose phrase you have
  lost — unless it falls back to ungated when there is no live vault, which is
  most of the value gone.

**Recommended default:** the second — refuse to overwrite a non-empty archive —
paired with the README paragraph. It is the smallest change that removes the
"destroy the archive for free" path, it needs no new passphrase prompt on a
recovery screen, and it does not weaken the honest single-restore case at all.
If that trade reads wrong, leaving it as-is with the README paragraph is a
defensible answer and costs nothing more.

## What is already true

- The undo gate itself ships and is unaffected by whichever way this goes.
- A restore is now one transaction (`restoreVault`), so it can no longer race an
  undo in another tab and overwrite the vault that undo just proved and put
  back. That was a separate defect found in the same review and is fixed.
- The README's security-model section now describes the ungated restore and the
  single slot, and points here.

## Acceptance criteria for resuming

A pick from the four. The recommended one is a line in `restoreVault` plus a
test that a second restore leaves the first vault set aside, and a sentence on
the restore confirmation panel explaining why nothing was set aside this time.
