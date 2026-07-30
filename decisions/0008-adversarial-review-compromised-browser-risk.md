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

## Second pass (2026-07-30, later the same day)

The review above was re-run adversarially, with the fixes it claims re-checked
against the code rather than taken on trust, and with the autofill path finally
exercised in a real browser. Priority 1 and priority 4 are now done.

### Priority 1 is answered: autofill has never worked

`app/scripts/autofill-check.mjs` loads the packed extension into a real
browser and drives the actual button. Every fill fails: `activeTab` is granted
to the tab that was active when the toolbar icon was clicked, and the icon's
first act is to open the app in a *new* tab. The grant and the target are never
the same tab. See `0009` item 3, which is now confirmed rather than suspected.

The rest of the fill path is sound — with a host permission added as a
diagnostic, 12 of 13 checks pass. So this is one permission-model problem, not
a broken feature.

### Where the review above was wrong

- **"Out of reach for anyone, permanently."** True today; "permanently" is not
  supportable while `0009` item 2 is open. A vault is frozen at its
  creation-time KDF parameters for life, against improving hardware.
- **The entropy claim had a hole underneath it.** 66.8 bits is arithmetically
  right, and the six-word floor cannot be bypassed — but re-rolling was
  unlimited, uncounted, and described in the code as "entropy-neutral". It is
  not: the user keeps only the draw they like, which is rejection sampling
  against a predicate an attacker can buy, because this wordlist was built from
  published concreteness norms. A user re-rolling until every word felt
  memorable could reach ~55 bits while the meter still read 66.8. **Fixed:**
  re-rolls are counted and charged, the meter shows the real number, and a
  six-bit budget holds the floor at about 60.8 bits.
- **"The key is zeroed on lock."** Largely theatre, and should not have been
  listed as a mitigation. The `CryptoKey` really is non-extractable, which is
  the part that matters. But `fill(0)` reaches one copy of at least five: the
  Argon2 WASM heap still holds the passphrase bytes and the derived key
  unwiped, the browser holds an internal key copy per save, the decrypted
  plaintext was not dropped on lock, and JS strings cannot be zeroed at all.
- **"Autofill's origin check was fixed."** It was added, but a credential
  saved without a URL passed an empty origin, which short-circuited the check
  entirely and filled any page silently — the URL-less entry (router, VPN) was
  the one with no protection at all. **Fixed:** absent origin now fails closed.
- **"Our own pages are refused as a fill target."** That guard reads
  `tab.url`, which an extension holding only `activeTab` never sees. It was
  inert. **Fixed:** it fails closed, and the content script checks its own
  protocol first hand.
- **"Page script could hold the vault open with synthetic events."** Not in the
  extension build — a web page cannot dispatch events into our document at all.
  The guard is still right for the hosted build.

### Also fixed in this pass

- The clipboard auto-clear almost never ran: it needed the tab focused, and the
  entire point of copying a password is to go elsewhere. It now survives being
  away, re-tries on return, uses wall-clock deadlines, and the UI no longer
  promises a 30-second stopwatch it cannot deliver.
- Auto-lock deadlines were `setTimeout` durations, so a laptop asleep for eight
  hours woke with 28 minutes still on its "absolute" 30-minute cap. Now
  wall-clock.
- Locking one tab left other open copies of the UI unlocked, each with its own
  key. Lock is now broadcast; the toolbar icon focuses the existing tab instead
  of opening another session.
- A copied password outlived the key: the pending clear held the plaintext
  after lock. Lock now clears it.
- KDF parameters were range-checked on the backup path but not on the stored
  vault — which is a file on disk. Anyone able to rewrite it could wedge the
  vault permanently, and the user would be told their passphrase was wrong.
  The check now lives in `deriveKey`, so no path can miss it.
- Backup parsing checked presence, not type: `salt: {}` sailed through. It now
  type-checks, bounds field size, and rebuilds the record field by field.
- Priority 4 is done: the unlock timeline is replaced by a count and a last
  date, and existing records are collapsed on the next load.
- A credential patch could overwrite its own `id` and `createdAt` (found by a
  new test on a path that had none).
- Autofill's "fill anyway" carried a bare `true`, so approval was reusable on
  whatever page happened to be active by the time it arrived; it now carries
  the origin the user was actually shown.

### Third pass: the second pass reviewed adversarially in turn

The fixes above were then handed to a reviewer told to find what was wrong with
them, which was worth doing — it found a regression the fixes had introduced
and several holes in them.

- **The visibility hardening broke itself on older browsers.** `checkVisibility`
  renamed its options in Chromium 125, and an unrecognised option is silently
  ignored rather than raising. Because the old computed-style checks had been
  moved into an `else`, Chromium 105–124 ended up checking *less* than before:
  `opacity: 0` and `visibility: hidden` password fields became fillable. Both
  option spellings are now passed, and the computed-style checks always run.
- **The re-roll budget could be laundered.** The per-word history was trimmed
  to the current word count, so re-rolling the seventh and eighth words and
  then dropping back to six refunded the charge — cycling the count gave
  unlimited re-rolls. The history is now kept at full length and spending only
  goes up.
- **The clipboard "is it still ours?" check was dead code.** Reading the
  clipboard needs the `clipboardRead` permission, which this extension does not
  request, so the read always failed and the code always cleared anyway. That
  behaviour is kept — it is what other password managers do, and the
  alternative is not clearing at all — but it is now stated rather than
  disguised, and a generation counter stops a clear already in flight from
  wiping a password copied since.
- **A bad backup file still destroyed the live vault before failing.** Fields
  were checked for type and size but not for being base64, so `salt: 'not
  base64!!'` passed, the restore committed, and `atob` threw at the next
  unlock. Base64 and per-field size limits are checked up front, timestamps
  are range-checked rather than merely finite, and `parseBackup('null')` no
  longer throws a raw TypeError at the user.
- **The toolbar-click fix could open a duplicate tab anyway** if focusing the
  window failed, and its exact-match URL filter would have missed a UI document
  carrying any query string.
- **Smaller:** the occlusion test rejected legitimate fields under scrolling or
  transparent ancestors; `onLock={lock}` passed React's event object as the
  "broadcast" flag; the delete-vault path did not clear the clipboard; the
  practice schedule returned `NaN` for a record with a non-numeric date;
  `urlMatches` and `credentialOrigin` disagreed about what counts as the same
  site.
- **Three tests were vacuous or tautological** and have been replaced with ones
  that fail when the fix is reverted, plus new coverage for the clipboard state
  machine (nine tests across the away-and-return sequence), the practice-record
  rewrite actually removing the timeline from disk, and the budget's
  monotonicity.

### Still open

`0009`, now four items: ciphertext padding, header binding, the KDF upgrade
path, popup-versus-tab, and the missing change-passphrase path.

Known and accepted rather than fixed: closing the tab within 30 seconds of a
Copy leaves the password on the system clipboard (nothing survives the page to
clear it — the UI says "cleared 30s after you return here" and means it), the
re-roll budget resets if the page is reloaded mid-onboarding, and the OS
clipboard history keeps its own copy regardless.
