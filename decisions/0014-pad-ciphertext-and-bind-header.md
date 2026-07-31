# 0014 — Pad the ciphertext and bind the vault header

**Status:** RESOLVED (user call, 2026-07-31) — see the resolution at the bottom.

## The problem

AES-GCM ciphertext is exactly as long as its plaintext, and our plaintext is
unpadded JSON. So the stored length — readable without any key, from IndexedDB
or from a backup file — leaks information.

The sharp version of this: **two snapshots plus the plaintext `updatedAt`
reveal the length of an individual newly-added site password.** That directly
shrinks the search space against that one site, and it needs only a backup
taken twice. (The weaker version — inferring the master phrase's word count
from vault size — turns out to be worth at most a bit and a half of triage to
an attacker, so it is not the argument here.)

Separately, the stored header (salt, KDF parameters, version) is not
authenticated. Tampering with it only makes derivation fail closed, so this is
corruption rather than disclosure — but binding it as AES-GCM additional data
is about three lines.

## The decision

Change the encrypted vault format? **Recommended default:** pad the plaintext
to the next 4 KiB with a length prefix, bind the header as additional data, and
bump the vault version so existing vaults still open and are upgraded on their
next save.

Say go and it ships with a migration and tests for old-format vaults; say no
and the length leak stays, documented in the threat model.

This is flagged rather than just built because it changes the encrypted vault
format, which the repo's rules treat as security-sensitive.

## Acceptance criteria for resuming

A go/no-go. If go, it lands with a round-trip test proving a pre-change vault
still opens and is upgraded in place.

## RESOLUTION (user call, 2026-07-31 — via exec assistant)

1. **Go for padding and header binding**: James chose the recommendation. Pad the vault plaintext to the next 4 KiB with a length prefix, bind the header as AES-GCM additional data, and bump the vault version.
2. **Migration and compatibility**: Include a migration so existing vaults still open and are upgraded on next save, with round-trip tests proving pre-change vaults open and upgrade in place.
3. **Security-sensitive handling**: Treat as security-sensitive; ensure review and test coverage before release.

## Implemented (2026-07-31)

Vault format **2**: the plaintext is padded to a whole number of 4 KiB blocks
behind a four-byte big-endian length prefix, and the header — format version,
salt, KDF parameters — is bound in as AES-GCM additional data. `VaultData` and
`StoredVault` were already two different "version" fields; the on-disk one is
now `VaultFormatVersion` and the plaintext one is untouched.

Migration is by writing, not by a migration step: `app/src/vault/seal.ts` is the
only place a record is written and it always stamps the current format, so a
vault upgrades the first time anything saves it — a credential edit, an unlock
that re-keys it, a passphrase change. Format 1 is still read, without padding
and without the binding, exactly as it was written.

Tests: `crypto.test.ts` proves the block quantisation, that adding a password no
longer changes the stored length (the actual leak this was about), that a header
which is not the one the vault was sealed under does not open it, and that a
genuine pre-change vault — encrypted the old way, with no padding — still opens
and that its length really was its plaintext's length. `vault-credentials.test.ts`
proves a format-1 record comes back as format 2 after one save.
