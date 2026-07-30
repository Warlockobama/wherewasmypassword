# 0009 — Vault format hardening, and popup vs tab for autofill

**Status:** OPEN — needs James's call on three things

Follows the adversarial review in `0008`. Everything in that review that could
be fixed without changing the vault format or the product's shape has been
fixed and committed. These three cannot.

## 1. Pad the ciphertext (and bind the header)

AES-GCM ciphertext is exactly as long as its plaintext, and the plaintext is
unpadded JSON. So the stored length — visible without any key, in IndexedDB or
in a backup file — leaks roughly how many credentials exist, and, more
seriously, roughly how many words are in the master passphrase. Confirming a
shorter phrase would cut an attacker's search cost by a large factor. Two
snapshots taken over time also reveal the length of an individual password.

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

## 3. Popup versus tab (this one may be blocking autofill entirely)

Clicking the toolbar icon opens the app in a full browser tab. That means when
the user clicks Autofill, the active tab is the extension's own page, not the
login page they want filled — so the fill has probably been going nowhere.
The `activeTab` permission is also spent on whichever site happened to be open
when the icon was clicked, which is not the tab anyone wants.

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

**The decision:** build the popup, or leave autofill as a tab-only feature and
lean on the clipboard fallback?

## Acceptance criteria for resuming

Any one of the three unblocks work on its own. Item 3 is worth answering first,
because if autofill is broken in practice then it is the difference between a
headline feature working and not.
