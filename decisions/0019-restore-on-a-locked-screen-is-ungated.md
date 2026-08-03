# 0019 — Restoring a backup is ungated, and it can consume the undo's archive

**Status:** RESOLVED (user call, 2026-08-03) — see the resolution at the bottom.

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
  single slot, and points here. (Rewritten once this was ruled on — see
  **Implemented** below. Restore is gated as of 2026-08-03.)

## Acceptance criteria for resuming

A pick from the four. The recommended one is a line in `restoreVault` plus a
test that a second restore leaves the first vault set aside, and a sentence on
the restore confirmation panel explaining why nothing was set aside this time.

## RESOLUTION (user call, 2026-08-03 — via exec assistant)

1. **Ruling:** "both, with a option to configure that behavior" — require a passphrase check for both the incoming backup (prove it can be opened) and the live vault being overwritten (prove ownership of what would be destroyed), with a configuration option to adjust this behavior when appropriate. This changes restore from ungated to gated and may impact recovery flows, so tests and UI messaging should reflect the configured mode.

## Implemented (2026-08-03)

Both proofs, and a three-step setting for the option. The ladder is `both`
(default) → `incoming` → `off`; every step down is strictly weaker than the one
above, which is what lets "anything unreadable means the top of the list" be a
rule rather than a guess.

**Where the policy lives.** `vault/restore.ts`, not the component. It exports
`requiredProofs`, `awaitingProof` and `restoreVaultWithProof`, and it is the
only thing that decides. Three properties are deliberate:

- The preference is read **at the commit**, not when the screen mounted. A gate
  raised in another tab applies to the restore that is halfway through being
  confirmed, not to the next page load.
- The check runs **inside the write transaction**, against the record actually
  being displaced (`restoreVault` now takes an `authorize` callback). Deciding
  beforehand would decide about a record another context can swap out in
  between — the same second-wide window `0018` had to close on the undo, and
  wider now that a restore costs one or two Argon2id derives.
- `authorize` is **required**, for the reason `undoRestore`'s `expecting` is: a
  future caller writing `restoreVault(file)` would otherwise get the ungated
  write and a clean build.

**What a proof is.** `vault/prove.ts`, extracted from `undo.ts` so both gates on
the lock screen are the same code: derive against the record's own salt and
parameters, let GCM's tag answer, zero the key on every path. The undo's
behaviour is unchanged; its own suite still passes untouched.

**What the screen asks.** The backup's phrase first — if the file cannot be
opened there is no point troubling anyone about the vault it would replace — and
then this device's. When one phrase opens both, it is typed once: the phrase
that opened the file is tried against the live vault before the second field
appears. The wasted derive when they differ is a second on a path already
spending two, which beats making everyone type the same words twice. Only
`WrongPassphraseError` is swallowed there; parameters the browser will not run
still surface.

**Where the setting is.** "Restoring a backup" in the unlocked app's
Housekeeping column, and nowhere else. A switch that could weaken the gate from
the lock screen would *be* the gate. It lives in the same IndexedDB the vault
does rather than in `chrome.storage.local` where the popup preference lives,
because the lock screen exists in the hosted build too and a gate that silently
evaporates in one of the two builds is precisely the overclaim this doc opened
with. It is in the existing `meta` store under a second key rather than a store
of its own: a new store means a schema version bump, and an upgrade an old tab
can block is a hang at load with nothing the new page can do about it.
`deleteVault` does not clear it — the preference is about this browser, not
about any vault, and clearing it would silently re-arm a gate the user had
turned off on the screen they would next meet.

**The recommended default in this doc was not taken, and one consequence
stands.** There is still one archive slot, and a second restore still spends it.
What changed is who can: under the default gate, authorising that second restore
means opening the vault the first one installed. The two-restore path that
started this doc — bring your own backup, press twice, the device's original
vault leaves disk with no passphrase typed — is closed at the first press.

**The cost, stated rather than hidden.** With the default gate and no memory of
this device's phrase, this browser will not restore over that vault. That is the
trade the ruling chose, and there is no button here that undoes it, because a
button that did would be the bypass. The way out is outside the app: clearing
the extension's data erases a vault nobody could have opened anyway. Anyone
standing at the machine could always do that much; what they cannot do is
quietly leave a *different* vault in its place, which is the substitution the
gate is for. The lock-screen panel says this at the moment it asks, and so does
the setting.

**First run is not gated, and that is not an exception.** `requiredProofs`
returns nothing when there is no live vault: both proofs exist to protect a
vault that is on this device, and with none, a restore displaces nobody. The
welcome screen's "already have a backup? restore it" therefore costs no extra
derive in front of the unlock that derives the same key from the same words. It
still goes through the gate rather than around it, so a vault created in another
tab a moment earlier cannot be quietly overwritten — the check sees the record
that is actually there.

**Tests.** A new `vault/restore.test.ts` on real Argon2id and real AES-GCM
(cheap parameters, real algorithms — the gate is a decryption, so a stub would
test nothing): both proofs required by default; one phrase satisfying both; each
half alone refused with the missing half named and *both records untouched*;
each configured mode; the preference re-read at the commit rather than cached; a
preference rewritten to rubbish still refusing; a live vault re-keyed after the
proof refused, while one merely edited under the same key is allowed and the
edited record is what goes aside; and a browser with no vault restoring freely.
`db.test.ts` gains the storage half: a refused `authorize` writing *neither*
slot, the hook seeing the record it displaces, and the settings round-trip,
fail-closed validation, coexistence with the practice schedule, and survival of
`deleteVault`.

**Prose corrected.** The README paragraph that said restore was ungated, the
comment in `LockScreen.tsx` that said so, the header of `undo.test.ts` that said
so, and the note in `0018` that left it open.
