# 0016 — The archived vault nobody can reach, and record rollback

**Status:** RESOLVED (user call, 2026-08-02) — see the resolution at the bottom.

## 1. The "we kept your old vault" promise cannot be acted on

Restoring a backup archives the vault it replaces, and the confirmation dialog
says so: *"The current vault is kept aside."* That archive is written on both
restore paths and **nothing in the app ever reads it back.** `loadArchivedVault`
exists and has no caller. So a user who restores the wrong file has, in
practice, destroyed their vault — the safety net is real on disk and unreachable
from the UI.

Two further wrinkles: a second restore overwrites the archive, so only the most
recent replaced vault survives; and changing the master passphrase now deletes
the archive outright, deliberately, because it is still encrypted under the
phrase being retired (`0012`).

**The decision:** add an "undo that restore" affordance, or stop promising it?

**Recommended default:** add it — a single line on the lock screen, shown only
when an archive exists, that puts the previous vault back. It is perhaps twenty
lines and it turns an unrecoverable mistake into a click. The alternative,
rewording the dialog to admit the copy is unreachable, is cheaper and worse.

The sub-question if yes: how long should the archive live? Recommended: until
the next restore or a passphrase change, which is what happens today — just
made visible.

## 2. Nothing stops an old vault record being put back

`0014` binds the header to the ciphertext, so a record cannot be *edited*. It
does not bind a record to a point in time, so a record can be *replaced whole*.
Anyone who can write to the browser profile directory can drop yesterday's
vault — the archive, or an old backup file — into place, and the user's correct
passphrase opens it without complaint. Credential edits since then are gone; a
password they rotated is live again.

This is a real limitation but not obviously one worth fixing: the defences
against it (a monotonic counter, a signed timestamp) all need somewhere to keep
state that the same attacker cannot also roll back, and inside a browser profile
there is no such place. The honest options are a **visible last-modified time**
on the unlocked screen, so a rollback is at least noticeable, or writing it into
the threat model and leaving it.

**Recommended default:** document it in the threat model and show the vault's
last-modified date on the unlocked screen. Do not attempt a rollback-proof
scheme we cannot actually anchor.

## Acceptance criteria for resuming

A yes/no on item 1 (plus the retention sub-question if yes), and a pick between
"document it" and "document it plus show the date" on item 2. Item 1 is an
afternoon; item 2 as recommended is an hour.

## UPDATE 2026-08-02 (guidance via exec assistant, not yet a ruling)

1. **Undo restore**: James said "let’s go with the recommendation". Add an "undo restore" affordance on the lock screen when an archive exists, restoring the previous vault. Keep the archive only until the next restore or a passphrase change, consistent with current behavior.
2. **Consequence**: The UI no longer promises an unreachable archive; accidental restore can be reversed with a click.

## RESOLUTION (user call, 2026-08-02 — via exec assistant)

1. **Undo restore**: James said "let’s go with the recommendation". Add an "undo restore" affordance on the lock screen when an archive exists, restoring the previous vault. Keep the archive only until the next restore or a passphrase change, consistent with current behavior.
2. **Rollback visibility**: James said "yeah, show it" to displaying a last-modified date on the unlocked screen. Document the rollback limitation in the threat model and show the vault last-modified time so a rollback is noticeable.
3. **Consequence**: Users can recover from accidental restores, and a replaced vault is more likely to be spotted. No attempt is made to implement rollback-proof storage without a trustworthy anchor.

## Implemented (2026-08-02)

**Item 1.** `undoRestore()` in `app/src/storage/db.ts` puts the archived record
back, in one transaction so there is no instant when either record is missing.
The lock screen carries it: a quiet line, shown only while a vault is set aside
— "Restored the wrong file? Put the previous vault back" — and one confirmation
naming the dates both vaults were last changed, so it is clear which way round
the swap goes.

**It is a swap, not a consume, and that is a change of mind worth naming.** The
first cut dropped the archive after using it, on the reasoning that the file
just restored is still on the user's disk. But the offer outlives the restore
that produced it: under the retention ruled here the archive survives until the
next restore or a passphrase change, so the line is still on the lock screen
months later — by which time the live vault holds credential edits that exist in
no backup file anywhere. Consuming the archive would let one curious press
destroy them: the same unrecoverable loss this decision exists to remove,
pointed the other way. Swapping means the worst a mistaken press can do is put
the wrong vault on screen, and pressing again puts it back.

Retention is otherwise exactly as ruled, which is exactly what already
happened: one slot, overwritten by the next restore, deleted by a passphrase
change.

The restore dialog's wording changes with it. "The current vault is kept aside,
but the app only ever opens the restored one" was the honest description of a
copy nobody could reach; it now says this screen can put it back.

**Item 2.** The unlocked screen shows "Vault last changed <date and time>" under
the header, with a tooltip saying what an unfamiliar date would mean. The
limitation itself is now a bullet in the README's security model, stated
plainly: the header binding stops a record being edited, not replaced whole;
every defence needs an anchor a browser profile cannot provide; so the date is
the signal, and no rollback-proof scheme was attempted.

Showing the stamp meant it had to start telling the truth. The automatic KDF
upgrade (`0013`) rewrites the record without touching a single credential, and
it was refreshing `updatedAt` when it did — so an old record, which is exactly
the kind that gets upgraded, would come out of its first unlock stamped with
today's date. That is today's date printed on precisely the planted vault the
signal exists to catch. `sealVault` now takes the stamp as an argument and the
upgrade carries the existing one through.

Two smaller corrections came with it. A restore or an undo replaces the live
record just as a passphrase change does, so it now locks every other open copy
of the UI — one left open would be showing credentials that are no longer on
disk, and its next save would fail. And the passphrase change's two pieces of
housekeeping — resetting the practice ladder, deleting the archive — were
sharing one `try`, so a failed practice write skipped the archive deletion; the
archive is not retried by anything, so that vault stayed on disk under the
phrase the user had just burned.

**One thing worth James knowing:** the undo line stays on the lock screen for as
long as an archive exists, which under the ruled retention can be indefinitely —
a restore in March is still undoable in June if nothing has replaced the
archive. That follows from "keep it until the next restore or a passphrase
change" rather than from a separate decision; if it reads as clutter, an expiry
is a small change and would need a ruling. That question, together with the fact
that the offer necessarily sits before the passphrase, is written up as `0018`.

**Also:** a restore and an undo both clear any parked popup session
(`decisions/0015`). The salt check would refuse that key anyway, but leaving a
key to a vault that is no longer the live one sitting in memory for five minutes
is not worth the reasoning.

**Gates:** `npm test` 138 passed — seven of them new here, covering the record
put back, the displaced record taking the archive slot so a second press undoes
the undo, the archive never being left pointing at the vault that is now live, a
no-op when nothing was restored, only the most recent replaced vault surviving,
a deleted vault leaving nothing set aside, and the KDF upgrade not restamping a
vault whose contents it did not touch. `npm run build` clean,
`npm run autofill` 37/37, `npm run visual` green.
