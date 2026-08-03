import { undoRestore, type StoredVault } from '../storage/db.ts'
import { provePassphrase } from './prove.ts'

/**
 * Put the vault a restore replaced back, once the phrase that opens it has been
 * proven (`decisions/0018`).
 *
 * The undo offer is a vault-altering control on a locked device, and the one
 * that costs nothing but a press — it has to be reachable there, since the case
 * it exists for is a restore whose passphrase you do not have, so there is no
 * key to authenticate with. Without a gate, a moment at a locked machine is
 * enough to change which vault it opens: nothing is destroyed and nothing is
 * disclosed (both records are ciphertext, and since `0016` this is a swap
 * rather than a move), but the owner comes back, types the right phrase, and is
 * told it is wrong. James's call was that whoever wants the previous vault back
 * is the person who knows its phrase, and that this is worth an Argon2id derive
 * on the recovery path.
 *
 * It is no longer the only such control to ask for something. Restoring a
 * backup file is on the same screen and was ungated, which made the sentence
 * this comment used to open with plainly wrong; `decisions/0019` put a gate in
 * front of that one too, and both now share `provePassphrase`.
 *
 * Throws `WrongPassphraseError` for a phrase that does not open the archive,
 * leaving both records exactly where they were. Returns the record that is now
 * live, or undefined if nothing was set aside after all.
 */
export async function undoRestoreWithPassphrase(
  passphrase: string,
  archived: StoredVault,
): Promise<StoredVault | undefined> {
  await provePassphrase(passphrase, archived)
  // The record that was proven, not merely "whatever is in the archive slot
  // now": another copy of the UI can restore a backup during the second that
  // the derive above takes, and putting back a vault nobody authenticated would
  // be this gate answering the wrong question. A slot that changed underneath
  // yields undefined, which the lock screen already reads as "gone".
  return undoRestore(archived)
}
