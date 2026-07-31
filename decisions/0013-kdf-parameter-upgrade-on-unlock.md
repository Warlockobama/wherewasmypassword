# 0013 — Let existing vaults move to stronger KDF parameters

**Status:** RESOLVED (user call, 2026-07-31) — see the resolution at the bottom.

## The problem

Argon2id parameters are stored per-vault specifically so they can be raised
later, but nothing ever raises them. A vault is frozen at its creation-time
settings for life, while attacker hardware keeps improving. A vault created
today is as weak in five years as it is now.

The upgrade is easy: at unlock the key is already in hand, so a fresh salt,
the current parameters, and a re-encrypt is enough. Same code path as the
change-passphrase work in `0012`.

## The decision — two questions

1. **Raise the default memory cost from 64 MiB to 256 MiB?** Unlock goes from
   roughly 0.2s to roughly 0.6s, behind the existing spinner, and costs an
   attacker about 4x more per guess. Is the slower unlock acceptable?
   *Recommended: yes.*
2. **Upgrade automatically on unlock, or offer it explicitly?** Automatic is
   silent and means nobody is left behind on weak parameters; explicit is more
   honest but most users will never click it. *Recommended: automatic, with a
   one-line note in the UI that the vault was re-encrypted.*

**Recommended default overall:** upgrade on unlock whenever the stored
parameters are weaker than the current default, and raise the default to
256 MiB.

This is flagged rather than just built because it changes key derivation, which
the repo's rules treat as security-sensitive.

## Acceptance criteria for resuming

Answers to the two questions above. Either can be answered alone.

## RESOLUTION (user call, 2026-07-31 — via exec assistant)

1. **Upgrade KDF parameters on unlock**: James said "yeah, that's fine" to the recommendation. Raise the default memory cost to 256 MiB and automatically upgrade existing vaults on unlock when their stored parameters are weaker, with a one-line UI note that the vault was re-encrypted.
2. **Security review expectation**: James noted the earlier security review "maybe should have caught some of that" and emphasized "we don't want to be using weak ciphers or crypto or anything like that." Treat this as security-sensitive, ensure review coverage, and verify we are not using weak cryptography.
3. **Testing and release**: Add appropriate tests for upgrade behavior and unlock performance, and include security review sign-off before release.

## Implemented (2026-07-31)

`DEFAULT_KDF_PARAMS` is now 256 MiB, 3 iterations, Argon2id — pinned by a test,
because that number is what an offline attacker pays per guess and lowering it
should have to argue with something first. The supported range already ran to
1 GiB, so no bounds moved.

`upgradeOnUnlock` runs straight after a successful decrypt, in both the full tab
and the toolbar popup — the popup included deliberately, since someone who only
ever fills from the toolbar would otherwise never be upgraded. It distinguishes
two cases: **re-key** when the stored parameters are weaker than today's (a new
salt and a fresh derivation, which is only possible at unlock because that is
the only moment the phrase exists), and **format** when the key is fine and only
the record is behind (a rewrite, no stretching). A vault whose parameters are
*stronger* than the defaults is left alone rather than dragged down to them.

The unlock spinner says "Re-encrypting with stronger settings…" while it happens,
because on an old vault this is a second Argon2id run and the wait roughly
doubles. Afterwards the unlocked screen carries a one-line note that the vault
was re-encrypted and that older backup files still use the older settings.

Failure is not fatal: if the upgrade cannot be written, the user is still let
into the vault they just opened correctly, and it is retried next unlock.

### What it actually costs — the estimate above was optimistic

Measured on this machine (Node 22, the same `hash-wasm` build the app ships,
3 iterations, average of three runs after a warm-up):

| memory | per derivation |
| --- | --- |
| 64 MiB (the old default) | **286 ms** |
| 256 MiB (the new one) | **1251 ms** |

So the real figures are roughly **0.3s → 1.25s**, not the 0.2s → 0.6s this doc
estimated when the question was put. The attacker-cost ratio is as advertised
(4.4x), but the user-facing wait is about twice what was described. The one
unlock that upgrades an old vault pays it twice — once on the old parameters,
once on the new — so that single unlock is around 1.5s.

Shipped at 256 MiB as ruled. Flagging the discrepancy because the ruling was
given against the smaller number: a second-and-a-quarter behind a spinner is
ordinary for a password manager, but if it feels slow in the hand, 128 MiB is a
one-constant change in `DEFAULT_KDF_PARAMS` and would land at roughly 0.6s,
which is what was originally described.

Tests: `app/src/vault/seal.test.ts` builds a genuine old vault — format-1 bytes
under a weakly derived key — proves it opens as it stands, upgrades it, and then
proves the upgraded record opens with the same passphrase the user still knows,
that the superseded key is zeroed, and that the old ciphertext no longer opens
under the new header.
