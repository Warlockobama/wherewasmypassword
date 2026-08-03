import { deriveKey } from '../crypto/kdf.ts'
import { decryptVault, fromBase64 } from '../crypto/vault.ts'
import { undoRestore, type StoredVault } from '../storage/db.ts'

/**
 * Put the vault a restore replaced back, once the phrase that opens it has been
 * proven (`decisions/0018`).
 *
 * The undo offer is the only vault-altering control on a locked device — it has
 * to be, since the case it exists for is a restore whose passphrase you do not
 * have, so there is no key to authenticate with. Without a gate, a moment at a
 * locked machine is enough to change which vault it opens: nothing is destroyed
 * and nothing is disclosed (both records are ciphertext, and since `0016` this
 * is a swap rather than a move), but the owner comes back, types the right
 * phrase, and is told it is wrong. James's call was that whoever wants the
 * previous vault back is the person who knows its phrase, and that this is
 * worth an Argon2id derive on the recovery path.
 *
 * The proof is the ordinary one: derive against the archived record's own salt
 * and parameters, and let GCM's authentication tag answer. There is no stored
 * verifier to check against and deliberately never has been.
 *
 * Throws `WrongPassphraseError` for a phrase that does not open the archive,
 * leaving both records exactly where they were. Returns the record that is now
 * live, or undefined if nothing was set aside after all.
 */
export async function undoRestoreWithPassphrase(
  passphrase: string,
  archived: StoredVault,
): Promise<StoredVault | undefined> {
  const rawKey = await deriveKey(passphrase, fromBase64(archived.salt), archived.kdfParams)
  try {
    await decryptVault(
      rawKey,
      { iv: fromBase64(archived.iv), ciphertext: fromBase64(archived.ciphertext) },
      archived,
    )
  } finally {
    // Zeroed whether or not it was right, and before the swap: this proves a
    // phrase, it does not open a vault, so the key has no further use here and
    // no path should leave it lying in the heap. The user types the phrase once
    // more to unlock, which is the one place a key is meant to be kept.
    rawKey.fill(0)
  }
  // The record that was proven, not merely "whatever is in the archive slot
  // now": another copy of the UI can restore a backup during the second that
  // the derive above takes, and putting back a vault nobody authenticated would
  // be this gate answering the wrong question. A slot that changed underneath
  // yields undefined, which the lock screen already reads as "gone".
  return undoRestore(archived)
}
