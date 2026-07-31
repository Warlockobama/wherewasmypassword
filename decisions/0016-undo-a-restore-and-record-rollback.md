# 0016 — The archived vault nobody can reach, and record rollback

**Status:** OPEN — two findings from the security review of `0012`/`0013`/`0014`
that are outside those three decisions and need a scope call. Neither blocks
what shipped today.

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
