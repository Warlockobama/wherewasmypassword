# 0014 — Pad the ciphertext and bind the vault header

**Status:** OPEN — lowest priority of the four. Split out of `0009`.

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
