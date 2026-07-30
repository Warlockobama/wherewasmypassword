# 0009 — Vault format hardening, and popup vs tab for autofill

**Status:** SPLIT (2026-07-30) — superseded by four separate OPEN docs, one per
question, so each can be surfaced and answered on its own. Answer them there;
this doc is kept as the background write-up. The splits:

- `0011-autofill-popup-or-remembered-tab.md` (was item 3 — answer this first)
- `0012-change-master-passphrase.md` (was item 4)
- `0013-kdf-parameter-upgrade-on-unlock.md` (was item 2)
- `0014-pad-ciphertext-and-bind-header.md` (was item 1)

Follows the adversarial review in `0008`. Everything in that review that could
be fixed without changing the vault format or the product's shape has been
fixed and committed. These cannot.

## 1. Pad the ciphertext (and bind the header)

AES-GCM ciphertext is exactly as long as its plaintext, and the plaintext is
unpadded JSON. So the stored length — visible without any key, in IndexedDB or
in a backup file — leaks roughly how many credentials exist.

The word-count argument for padding turns out to be the weaker one, and the
original wording here overstated it. Measured, the difference between a six-,
seven- and eight-word phrase is about a hundred bytes, which the user's own
imagery text swamps; and an attacker searches the six-word tier first anyway,
so knowing the count saves them at most a bit and a half of triage.

**The real argument is the second one:** two snapshots plus the plaintext
`updatedAt` reveal the length of an individual newly-added site password. That
is directly search-space-reducing against that one site, and it needs only a
backup taken twice.

Separately, the stored header (salt, KDF params, version) is not authenticated.
Tampering with it only causes derivation to fail closed, so this is corruption,
not disclosure — but binding it as AES-GCM additional data is three lines.

**Recommended default:** pad the plaintext to the next 4 KiB with a length
prefix, bind the header as additional data, and bump the vault version so old
vaults still open and are upgraded on the next save.

**The decision:** this changes the encrypted vault format. It is a security-
sensitive change, so per the repo's own rule it is not being made on a guess.
Say go and it ships with a migration; say no and the leak stays as documented.

## 2. Let existing vaults move to stronger KDF parameters

The parameters are stored per-vault specifically so they can be raised later,
but nothing ever raises them: a vault is frozen at its creation-time settings
for life while attacker hardware keeps improving. The upgrade is easy — at
unlock the key is already in hand, so a fresh salt and a re-encrypt is enough.

**Recommended default:** upgrade on unlock whenever the stored parameters are
weaker than the current default, and raise the default memory from 64 MiB to
256 MiB (unlock goes from roughly 0.2s to roughly 0.6s, behind the existing
spinner, and costs an attacker about 4x more).

**The decision:** is the slower unlock acceptable? And is an automatic silent
re-encrypt on unlock acceptable, or should it be offered explicitly?

## 3. Popup versus tab — CONFIRMED IN A REAL BROWSER: autofill does not work

This was written as a suspicion. It has now been tested, and it is worse than
suspected: **autofill has never worked, at all.** Not "sometimes fills the
wrong place" — it cannot fill anything.

The test is `app/scripts/autofill-check.mjs` (`npm run build && npm run
autofill`). It loads the real packed extension into a real browser, serves a
real login page, and clicks the real button. Every fill attempt fails with
*"Cannot access contents of the page. Extension manifest must request
permission to access the respective host."*

The reason is the permission model, not the code. `activeTab` is granted for
whichever tab was active when the toolbar icon was clicked — and the very next
thing the icon does is open the app in a **new** tab, which then becomes the
active one. So the grant sits on the page the user was looking at, while the
fill request targets the extension's own tab, which can never be scripted.
There is no ordering of clicks that fixes this from a full tab.

The same run proves the rest of the fill path is sound. Re-run with a host
permission added — a diagnostic, not something the extension ships — and 12 of
13 checks pass: the origin check refuses a look-alike page, names both origins,
honours an explicit approval and refuses a stale one, skips hidden, tiny,
transparent, off-screen, disabled and covered fields, puts the username in the
login form rather than the newsletter box, and does not stack listeners across
repeated fills. Only the "from the extension tab" case still fails, which is
this item.

So the decision below is no longer a matter of taste. Until it is answered,
every password goes via the clipboard.

The standard fix is a small popup for the "unlock and fill" case, keeping the
full tab for the memory house. That aligns the permission grant, the active
tab, and the user's intent.

**Recommended default:** add a compact popup (unlock, search, fill) and keep
the full tab for training and palace walks. The palace UI genuinely needs the
space; the fill flow genuinely needs the popup.

**Alternative if you would rather not build a popup:** request host permissions
so the extension can address a chosen tab directly. That is a much broader
permission and works against the local-only, minimal-permission posture — not
recommended.

**A third option, now that the cause is known:** keep the full tab, but capture
the target tab from `chrome.action.onClicked`'s `tab` argument at the moment of
the click, remember it, and fill *that* tab. It needs no new permission and no
new UI. It is less obvious to the user than a popup — they click the icon on
the login page, walk their house, and the fill lands back where they came from
— but it is much the smaller change.

**The decision:** build the popup, do the remembered-tab version, or accept
that autofill does not work and make the clipboard the only path (in which
case the Autofill button should go, rather than sitting there failing).

## 4. There is no way to change the master passphrase

Related, and found while reviewing the above. Doc `0008` says that if the vault
is ever open while the browser is compromised, the master phrase is burned
permanently and the only remedy is "creating a new vault with a new phrase".
That remedy is not implementable today: there is no change-passphrase path, and
the only route to a new vault is Delete, which erases every credential with it.
A user who suspected a compromise would have to transcribe every password by
hand first.

The fix is the same code as item 2 — at unlock the plaintext is already in
hand, so a fresh salt, current parameters, and a re-encrypt is the whole job.

**Recommended default:** implement "change master passphrase" together with the
KDF upgrade path, since they are one code path.

## Acceptance criteria for resuming

Any one of the four unblocks work on its own. Item 3 is the one to answer
first: it is the difference between the headline feature working and not, and
it is confirmed broken rather than suspected.
