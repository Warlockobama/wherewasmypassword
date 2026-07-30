# 0013 — Let existing vaults move to stronger KDF parameters

**Status:** OPEN — split out of `0009`.

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
