# 0008 — Adversarial review: compromised browser risk

**Status:** DIRECTIVE (user, 2026-07-30 — via exec assistant)

## The directive

James says: "Focus on what happens if the user's browser is compromised. Will the user's memorized password be enough to protect the vault?" Run an adversarial, abuse-case review starting from that threat scenario. Assess likely attack paths, including extension context exposure, DOM/script injection, clipboard handling, local storage/IndexedDB access, and crypto misuse. Provide concrete mitigations, tradeoffs, and a prioritized plan for hardening. If the answer depends on assumptions (browser, extension permissions, threat model), state them clearly and propose safer defaults.

## Review (2026-07-30)

### Assumptions

Chromium-based browser, MV3 extension with `activeTab` + `scripting` and no
host permissions. "Compromised browser" is read at three strengths, because
the answer differs sharply between them:

- **A. Hostile web page** — attacker script runs in some page, not in ours.
- **B. Hostile second extension** — installed alongside ours.
- **C. Malware with the browser profile / process** — can read files, and at
  the extreme can read our process memory.

### The direct answer

**Against a stolen vault (level C, file access), yes — the memorized
passphrase is enough, provided it is 6 words or more.**

The vault is Argon2id (64 MiB, t=3, p=1) then AES-256-GCM. A 6-word phrase
from the 2,255-word picturable list is 66.8 bits. At roughly 1,500 guesses
per second per high-end GPU, the expected cost to crack one vault is on the
order of trillions of dollars — out of reach for anyone, permanently. The
same is true of a stolen backup file, which carries exactly the same material.

The 5-word option was the exception at 55.7 bits: expensive but not absurd for
a state-scale attacker, and getting cheaper every year. **Five words is no
longer offered** — the floor is now 6.

**Against an attacker who is inside the browser while the vault is unlocked
(levels A and B, and C at its strongest), no — and no password manager's
master secret is.** Once the vault is open, the decrypted contents are in
memory by definition. This design has one extra sting worth stating plainly:
the master passphrase itself is stored inside the vault (it has to be — the
memory house shows it back to you), so a single successful compromise while
unlocked yields the master phrase permanently, not just today's passwords.
Rotating site passwords would not undo it; only creating a new vault with a
new phrase would.

That is inherent to the product, so the defence is to make the unlocked
window short and hard to extend, and to make sure a password never leaves the
vault toward a page that did not earn it.

### What was wrong, and is now fixed

1. **Autofill never checked the origin.** `urlMatches()` existed, was tested,
   and was never called in production. Nothing compared the page's origin to
   the credential's stored URL, so a look-alike phishing page would have been
   handed the real password. The origin now travels with the request and is
   re-checked *inside the page* by the content script; a mismatch refuses to
   fill and the UI names both origins and asks explicitly.
2. **Auto-lock could be defeated by a script.** The idle timer re-armed on any
   `keydown`, including a synthetic one, so page script could hold the vault
   open — and the master phrase in memory — indefinitely. Untrusted events are
   now ignored, and a 30-minute absolute session cap no activity can extend
   was added, plus a lock on `pagehide`.
3. **Hidden fields were fillable.** The visibility test failed only when a
   field was 0x0 in *both* dimensions, so a 1x1 or transparent harvesting
   field passed. It now also rejects tiny, transparent and off-screen fields,
   prefers the username in the same form as the password, and no longer falls
   back to any bare text input.
4. **Re-injection stacked listeners.** Every Autofill click injected the
   content script again, adding another listener and another retained copy of
   the password. Guarded.
5. **The service worker had no `connect-src`.** The strict CSP only ever
   applied to the page, not to the worker that handles plaintext passwords.
   The full policy now lives in the manifest, which covers both.
6. **A hostile backup file could brick the app.** KDF parameters from an
   untrusted file went straight into Argon2id; `memoryKiB: 2^31` would have
   asked for two terabytes on every unlock attempt. Now range-checked.
7. **Restore destroyed the existing vault silently.** It now asks first and
   keeps the outgoing record aside.
8. Smaller: exact-origin sender check instead of a scheme prefix,
   `externally_connectable: {ids: []}`, our own pages refused as a fill
   target, and the key is zeroed on the delete path as well as on lock.

### What is left, and why it needs a decision

Three items change the vault format or the product's shape, so they are
parked in `0009` rather than guessed at: padding the ciphertext (its length
currently leaks the credential count and, more importantly, the passphrase's
word count), binding the stored header as AES-GCM additional data, a path to
raise KDF parameters on existing vaults, and the popup-versus-tab question
below.

### One open worry that is not a code change

Because the extension opens its UI in a full tab rather than a popup, the
"active tab" at the moment of an Autofill click is the extension's own tab.
Autofill may therefore be failing in practice, not just filling the wrong
place — the origin check makes it *safe*, but not necessarily *working*. This
was found by reading the code; it has not been confirmed by loading the
extension and clicking the button, which is the next thing worth doing. The
fix likely means a small popup UI, which is a design call — see `0009`.

### Priority order

1. Confirm autofill end-to-end in a loaded extension (does it work at all?).
2. Decide `0009`: ciphertext padding + header binding + KDF upgrade path.
3. Decide `0009`: popup versus tab.
4. Privacy: the unlock-timestamp log is stored in plaintext beside the vault
   and grows forever — a precise activity timeline for anyone with the profile
   directory. Storing a count and a last-practiced date would serve the
   practice schedule identically.
