# 0015 — What the toolbar popup is allowed to do: session sharing, and Copy

**Status:** OPEN — two small follow-ons from shipping the popup (`0011`). Neither
blocks it; both are shipped one way today and can be changed on a word.

The popup from `0011` is built and filling. Building it surfaced two questions
that are genuinely James's call rather than defaults, because both trade a
security property for convenience.

## 1. Should the popup ever inherit an unlocked session?

**How it works today:** it does not. The popup asks for the master passphrase
every time it is opened, even if the full memory-house tab is unlocked in the
next tab along. A popup is destroyed by the browser the moment it loses focus,
so the key it derived dies with it — the key never exists anywhere except the
one short-lived context that derived it, which is the strongest version of the
local-only posture we can hold.

**What it costs:** typing a six-word diceware phrase, plus about a fifth of a
second of Argon2id, *every single fill*. For someone logging into four sites in
a morning that is four full recitations. The realistic failure mode is not that
they mind the typing — it is that they go back to Copy, which is the exact thing
`0004` asked us to move away from.

There is a real argument that this is a feature: the README's promise is that
every unlock is a rehearsal, and the practice schedule counts popup unlocks. But
spaced repetition is spaced on purpose; twenty rehearsals a day is not the
schedule working, it is the schedule being ignored.

**Recommended default:** add an opt-in "stay unlocked for 5 minutes", OFF by
default, with the key held in `chrome.storage.session` — memory-backed, never
written to disk, wiped when the browser closes — and cleared immediately by
"Lock". Say no and it stays as it is, which is safer and free.

**What that would give up:** the key becomes readable by anything that can run
code in the extension's own context or attach a debugger to it, for those five
minutes, and a laptop left unattended at a desk would fill passwords without the
phrase. Against the compromised-browser threat model in `0008` neither design
survives, so the honest framing is that this weakens an unattended-machine
property, not the malware one.

## 2. Should the popup offer Copy as well as Fill?

**How it works today:** it does not — Fill only. The full tab still has Copy.

The reason is not tidiness. The clipboard auto-clear needs a live document: it
waits for the tab to regain focus and only then blanks the clipboard, because
the browser refuses clipboard access to an unfocused page. A popup is gone
milliseconds after the user clicks away, so a password copied from it would sit
on the clipboard until something else overwrote it — quietly undoing the one
guarantee that makes Copy acceptable at all.

The workarounds both cost something: an offscreen document needs the `offscreen`
permission and keeps a hidden page alive holding the password, and handing the
clear to the service worker does not work at all (no DOM, no clipboard).

**Recommended default:** leave Copy out of the popup. When Fill cannot work —
no login field, an unusual page — the popup says so and the memory house is one
click away with a working, self-clearing Copy.

## Acceptance criteria for resuming

Each answer is a small, self-contained change: item 1 is a day, item 2 is an
hour plus a permission we would rather not add. Neither changes the vault
format. The autofill test covers the fill path either way.
