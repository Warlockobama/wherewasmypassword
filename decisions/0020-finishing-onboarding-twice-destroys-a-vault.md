# 0020 — Finishing onboarding in a second tab destroys a vault, with no copy kept

**Status:** RESOLVED (user call, 2026-08-04) — see the resolution at the bottom.

## What prompted this

An adversarial review of the `0019` restore gate, looking for ways around it.
It did not find one. It found that the screen *next door* still has the property
`0019` was written to remove, in a worse form.

`Welcome.tsx` was changed this run to route its restore through the gate, on the
reasoning written into the code: "nothing *should* reach this screen with a
vault present, but 'should' is not a reason for the one destructive path to be
the unguarded one." The tutorial that same screen leads into ends at
`CreateVault`, which calls `sealVault(…)` with no `expecting` argument and so
reaches `saveVault(record)` — an unconditional `put` over whatever is in the
vault slot.

## The consequence

Two tabs on a browser with no vault, or two tabs after "Delete vault & start
over":

1. Tab A finishes the tutorial (or restores a backup) and now holds a vault.
2. Tab B, opened earlier and still walking its memory house, finishes minutes
   later and writes its own vault over the top.

Tab A's vault is gone. Not set aside — *gone*. The restore path at least keeps
one copy in the archive slot and offers it back on the lock screen; this path
keeps nothing, so there is nothing to undo and nothing to offer. It is the exact
harm `0016`, `0018` and `0019` have each spent a decision on, on the one screen
none of them looked at.

## What is already true

- It is not reachable from a locked screen. `App.tsx` has no `locked → welcome`
  transition, so this is not a lock-screen bypass and the `0019` gate is not
  weakened by it. Every other writer of the vault record — `ChangePassphrase`,
  `upgradeOnUnlock`, credential saves — passes `expecting` and is refused when
  the salt has moved.
- It needs the user's own second tab, or a second window they forgot about. It
  is a foot-gun rather than an attacker's path: nobody else can make tab B
  finish a tutorial.
- It is not new. It predates all three of those decisions.

## The decision

What should the last step of onboarding do when it finds a vault already there?

- **Refuse, and say so.** `sealVault` learns the same "there must be nothing
  here" check the restore now has, and `CreateVault` reports it: *this browser
  already has a vault — lock this tab and open it, or delete it first.* The user
  loses the walk they just did, which is real but recoverable: the phrase is in
  their head and the placement is the point. Nothing is destroyed.
- **Archive it, as a restore does.** The displaced vault goes to the archive
  slot and the lock screen offers it back. Symmetrical with `restoreVault`, and
  it costs the *other* thing in the slot. It also means an accidental second
  tutorial silently changes which vault the device opens, which is what `0018`
  decided was worth a passphrase.
- **Leave it.** Defensible on frequency — you have to open two tabs and finish
  two tutorials — but it is the only remaining path that destroys a vault with
  no copy at all, and it is one line of guard away from not being.

**Recommended default:** the first. It is the smallest change, it destroys
nothing in any ordering, and "you already have a vault" is a sentence a user can
act on. The second is more clever and buys less: the archive slot is more useful
holding a vault someone restored over than one they created over.

## Acceptance criteria for resuming

A pick. For the recommended one: an `expecting`-style refusal on the create
path, a message on `CreateVault`, and a test that a second create over a live
vault leaves the first vault exactly where it was.

## RESOLUTION (user call, 2026-08-04 — via exec assistant)

1. **Decision:** James said "go with that" to the recommended default. Onboarding must refuse creating a vault when one already exists, with an "you already have a vault" style message. This prevents silent overwrite and preserves the existing vault unchanged; add a test ensuring a second create attempt leaves the first vault intact.
