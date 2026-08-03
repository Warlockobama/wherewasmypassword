import { deriveKey } from '../crypto/kdf.ts'
import { decryptVault, fromBase64 } from '../crypto/vault.ts'
import type { StoredVault } from '../storage/db.ts'

/**
 * Prove that `passphrase` opens `record`.
 *
 * Two gates on the lock screen ask this, and neither *wants* the vault it
 * opens: putting back the vault a restore replaced (`decisions/0018`) and,
 * since `decisions/0019`, the restore itself. Both are asking who is at the
 * keyboard, not what is inside.
 *
 * The proof is the ordinary one: derive against the record's own salt and
 * parameters, and let GCM's authentication tag answer. There is no stored
 * verifier to check against and deliberately never has been.
 *
 * **What it costs to ask.** Answering that question means decrypting, because
 * the tag is the answer — so for a moment the whole plaintext exists in the
 * heap, credentials and all, on the screen whose ordinary contract is that it
 * does not. The `rawKey` is zeroed on every path out of here, but the plaintext
 * is not reachable to zero: `decryptVault` decodes it to a string and parses
 * it, and neither can be wiped in JavaScript. A verify-only decrypt would
 * shrink that to one buffer this could overwrite, and it is deliberately not
 * done, because it would also stop distinguishing an authentic-but-damaged
 * record from a wrong phrase — a difference `0018`'s undo relies on. Worth
 * knowing rather than implying otherwise: this is not a free question.
 *
 * `0019` widened where it is asked. Until then only the *archived* record was
 * proven here; the restore gate proves the live one too.
 *
 * Throws `WrongPassphraseError` for a phrase that does not open the record,
 * `DamagedVaultError` for one that opens but does not parse, and whatever
 * `deriveKey` throws for parameters it will not run. The caller has to be able
 * to tell those apart, because only the first is the user's fault.
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
