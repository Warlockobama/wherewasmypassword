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
back and drops the archive, both in one transaction so there is no instant when
neither is the live vault. The lock screen carries it: a quiet line, shown only
while a vault is set aside — "Restored the wrong file? Put the previous vault
back" — and one confirmation naming the date that vault was last changed, since
the thing it replaces is the file the user chose a moment ago and still has.

Retention is exactly as ruled, which is exactly what already happened: the
archive lives until the next restore overwrites it or a passphrase change
deletes it. The undo consumes it too — an archive that survived its own undo
would offer to put back a vault that had already been put back.

The restore dialog's wording changes with it. "The current vault is kept aside,
but the app only ever opens the restored one" was the honest description of a
copy nobody could reach; it now says this screen can put it back.

**Item 2.** The unlocked screen shows "Vault last changed <date and time>" under
the header, with a tooltip saying what an unfamiliar date would mean. The
limitation itself is now a bullet in the README's security model, stated
plainly: the header binding stops a record being edited, not replaced whole;
every defence needs an anchor a browser profile cannot provide; so the date is
the signal, and no rollback-proof scheme was attempted.

**One thing worth James knowing:** the undo line stays on the lock screen for as
long as an archive exists, which under the ruled retention can be indefinitely —
a restore in March is still undoable in June if nothing has replaced the
archive. That follows from "keep it until the next restore or a passphrase
change" rather than from a separate decision; if it reads as clutter, an expiry
is a small change and would need a ruling.

**Also:** a restore and an undo both clear any parked popup session
(`decisions/0015`). The salt check would refuse that key anyway, but leaving a
key to a vault that is no longer the live one sitting in memory for five minutes
is not worth the reasoning.

**Gates:** `npm test` 135 passed — four of them new here, covering the record
put back, the archive being consumed so the same undo is not offered twice, a
no-op when nothing was restored, and only the most recent replaced vault
surviving. `npm run build` clean, `npm run autofill` 37/37, `npm run visual`
green.
