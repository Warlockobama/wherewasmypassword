# 0015 — What the toolbar popup is allowed to do: session sharing, and Copy

**Status:** RESOLVED (user call, 2026-08-02) — see the resolution at the bottom.

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

**The flip side, worth knowing before answering:** "the browser destroys the
popup on blur" is the *only* thing that ends a popup session today — there is no
idle timer in it, so a popup that somehow keeps focus (devtools attached to it,
for instance) holds the key for as long as it is open. If the answer here is yes,
an explicit auto-lock has to come with it rather than after it.

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

## RESOLUTION (user call, 2026-08-02 — via exec assistant)

1. **Popup session behavior**: James said "I agree" to the suggested default. Add an opt-in "stay unlocked for 5 minutes" mode, OFF by default, with explicit auto-lock and lock-clearing behavior.
2. **Popup Copy**: James said "I agree" to the suggested default. Keep the popup Fill-only and do not add Copy to the popup; users can switch to the full tab for Copy when needed.

## Implemented (2026-08-02)

**Item 2 needed no code.** The popup is still Fill-only; nothing was added.

**Item 1** is `app/src/popup/session.ts`, which holds the whole bargain — the
opt-in, the deadline, and the clearing — so that no UI path can widen it by
forgetting a check. The switch is in two places: the popup (met at the moment of
typing the phrase for the fourth time) and the memory house's new "The toolbar
popup" panel (where there is room to say what it costs). Off until ticked.

The key is parked as base64 in `chrome.storage.session` — browser memory, never
written to disk, wiped when the browser closes, and closed to content scripts.
`chrome.storage.session` takes only JSON, so a non-extractable `CryptoKey`
cannot be stored instead; that is a real loss against `0008`'s "the
non-extractable CryptoKey is the part that matters", though a smaller one than
it sounds, since a handle that decrypts the vault yields the master phrase
inside it just as the raw bytes do.

Four things that were judgement calls inside the ruling, worth James knowing:

1. **The popup's session is the popup's own.** Unlocking the memory house does
   not park anything, so opening the popup beside an unlocked tab still asks for
   the phrase. A tab session runs up to thirty minutes and lending it out would
   have quietly turned "five minutes" into that.
2. **The five-minute cap now applies to the popup even with the setting off** —
   the explicit auto-lock item 1 asked for. This closes the flip side named
   above: a popup with devtools attached keeps focus and used to hold its key
   for as long as it stayed open.
3. **Idle auto-locks elsewhere do not end the session; explicit ones do.** "Lock
   now" in either place clears it, as do a passphrase change and a deleted
   vault. A memory-house tab locking itself on its 60-second hidden timer does
   not — otherwise switching from the memory house to a login page would kill
   the session about a minute later, which is exactly the case the feature is
   for. Cost: a popup left on screen through another tab's auto-lock shows the
   passphrase prompt although a valid session is still parked; reopening it
   picks the session back up.
4. **A resumed session records no practice unlock and performs no KDF upgrade.**
   Nobody recalled anything, so counting it would inflate the schedule into
   silence (the argument in §1 above); the upgrade needs the passphrase, and
   happens on the next real unlock instead.

**One permission was added: `storage`.** There is no other way to reach
`chrome.storage.session`. It grants access to nothing outside this extension and
shows no new warning at install, but the README's "asks for `activeTab` and
`scripting` and nothing else" was an absolute claim and has been corrected. The
autofill check that asserts the exact permission set caught this, as designed;
it now asserts the new set, plus that the shipped worker still pins session
storage to trusted contexts.

**Gates:** `npm test` 128 passed (12 new, covering the opt-in invariant, the
wall-clock deadline, a resume that cannot extend it, salt mismatch after a
re-key, malformed records, and clearing). Two of them were checked by reverting
the behaviour they describe and confirming they go red. `npm run build` clean.
`npm run autofill` 31/31 — one more check than before. The manual toolbar-click
pass in the README has not been run; it needs a person.

## Adversarial review, same day

The commit was reviewed against `0008`'s threat model. The opt-in itself held —
nothing can park a key without it, the memory house's key is never parked, and a
resume cannot extend the deadline — but four real defects were found in the
*edges* of the lifetime, and all four are fixed:

1. **An expired key was refused but never deleted.** Nothing runs at the
   deadline: the popup is long destroyed and an MV3 worker is killed after
   thirty idle seconds. The bytes could sit in browser memory for the rest of
   the day. The worker now sweeps at every start, and the popup sweeps on the
   no-vault path too. What is left of the gap — never touching the extension
   again while leaving the browser open — is written up in `decisions/0017`,
   which asks whether it is worth the `alarms` permission to close properly. The
   README no longer implies it is already closed.
2. **A deadline had no upper bound.** A clock stepped backwards (an NTP
   correction after a suspend, a dual-boot RTC disagreement) would have left a
   session running for the length of the step, with the popup counting down from
   sixty-five minutes. Both the write and the read now refuse anything further
   off than one whole session.
3. **A Lock landing mid-park could be undone by the write that followed it** —
   the next popup would open unlocked after the user explicitly locked. A
   generation counter, bumped by every clear and checked either side of the
   write, closes it. The key is also encoded before the first `await` now, so a
   popup torn down mid-call cannot park thirty-two zero bytes.
4. **Restore and undo-restore left the key parked.** Fixed as part of `0016`.

Two smaller things came with them: the mount effect now drops a key resumed
after teardown rather than orphaning it, and the two copies of the switch — popup
and memory house — stay in step through a storage listener instead of showing
opposite answers.

**Gates after the fixes:** `npm test` green, three tests more — one per defect
a test can express (137 in the suite, counting `0016`'s, which landed with
them). `npm run build` clean. `npm run autofill` 37/37 — the
harness gained a scenario proving in a real browser that a trusted extension
context can reach `chrome.storage.session` while a web page and an injected
content script cannot. It carries its own control: the same content script is
shown reading `chrome.storage.local`, so "cannot read the key" cannot pass by
failing to inject. The browser's own refusal is the evidence — *"Access to
storage is not allowed from this context."*
