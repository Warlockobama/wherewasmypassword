import { deriveKey } from '../crypto/kdf.ts'
import { decryptVault, fromBase64 } from '../crypto/vault.ts'
import type { StoredVault } from '../storage/db.ts'

/**
 * Prove that `passphrase` opens `record`, and nothing else.
 *
 * Two gates on the lock screen need this and neither needs the vault it opens:
 * putting back the vault a restore replaced (`decisions/0018`) and, since
 * `decisions/0019`, the restore itself. Both are asking *who is this*, not
 * *what is inside*.
 *
 * The proof is the ordinary one: derive against the record's own salt and
 * parameters, and let GCM's authentication tag answer. There is no stored
 * verifier to check against and deliberately never has been.
 *
 * The key is zeroed whether or not it was right, and before this returns. This
 * proves a phrase, it does not open a vault, so the key has no further use here
 * and no path should leave it lying in the heap — the user types the phrase
 * once more to unlock, which is the one place a key is meant to be kept.
 *
 * Throws `WrongPassphraseError` for a phrase that does not open the record, and
 * whatever `deriveKey` throws for parameters it will not run — the caller has
 * to be able to tell those apart, because only the first one is the user's
 * fault.
 */
export async function provePassphrase(passphrase: string, record: StoredVault): Promise<void> {
  const rawKey = await deriveKey(passphrase, fromBase64(record.salt), record.kdfParams)
  try {
    await decryptVault(
      rawKey,
      { iv: fromBase64(record.iv), ciphertext: fromBase64(record.ciphertext) },
      record,
    )
  } finally {
    rawKey.fill(0)
  }
}
