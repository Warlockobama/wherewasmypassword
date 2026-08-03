import {
  loadVaultSettings,
  restoreVault,
  VaultSupersededError,
  type StoredVault,
} from '../storage/db.ts'
import type { RestoreGate } from '../storage/settings.ts'

/**
 * What a restore has to prove before a backup file may replace the vault on
 * this device (`decisions/0019`).
 *
 * Until that decision the answer was "nothing". The lock screen offered
 * "Restore from a backup file instead" beside a passphrase box, asked for
 * neither, and wrote the vault record — and doing it twice consumed the one
 * archive slot, so the vault the device started with left disk with no
 * passphrase typed at any point. The undo beside it had just been given an
 * Argon2id gate on the stated reasoning that it was the only vault-altering
 * control reachable on a locked device, which was simply wrong.
 *
 * James's ruling was "both, with an option to configure that behavior":
 *
 * - the **incoming** backup's passphrase, which says the file is one you can
 *   open rather than one you merely carried in;
 * - the **live** vault's passphrase, which says you own the vault that is about
 *   to be pushed aside. This is the half that actually authenticates the owner
 *   of what is being displaced, and the half that closes the two-restore path:
 *   the second restore has to open the first restore's vault.
 *
 * And the option, because the second half has a real cost. Restore exists most
 * of all for a vault whose phrase is gone, and asking for that phrase makes the
 * screen useless in exactly that case. `RestoreGate` is where the user says so;
 * it can only be changed from inside an unlocked vault, since a switch that
 * turned the gate off from the lock screen would be the gate.
 *
 * What that leaves, honestly: with the default gate and no memory of the live
 * vault's phrase, this browser will not restore over it. The way out is not a
 * button here — it is removing the extension's data, or the extension, which
 * erases a vault that could not be opened anyway. Anyone standing at the
 * machine could always do that much; what they cannot do is quietly leave a
 * *different* vault in its place, which is the substitution this is for.
 */
export interface RequiredProofs {
  incoming: boolean
  live: boolean
}

/**
 * What the caller has actually proven.
 *
 * `live` carries the record rather than a flag, so that claiming a live proof
 * means naming the record it was made against. The commit compares that record
 * with the one it is about to displace: a passphrase change in another tab
 * between the derive and the write leaves a vault the proof no longer says
 * anything about.
 */
export interface RestoreProofs {
  incoming: boolean
  live: StoredVault | null
}

/** Nothing proven — the honest starting point, and all a fresh install needs. */
export const NO_PROOFS: RestoreProofs = { incoming: false, live: null }

/**
 * What the gate asks for, given whether there is a live vault to replace.
 *
 * With nothing to replace there is nothing to prove. That is not the gate being
 * lenient: both proofs exist to protect a vault that is on this device, and on
 * a browser that has none, a restore destroys nothing and displaces nobody.
 * It also keeps the first-run "already have a backup? restore it" path free of
 * an Argon2id wait immediately before the unlock that derives the same key.
 */
export function requiredProofs(gate: RestoreGate, replacing: boolean): RequiredProofs {
  if (!replacing) return { incoming: false, live: false }
  switch (gate) {
    case 'both':
      return { incoming: true, live: true }
    case 'incoming':
      return { incoming: true, live: false }
    case 'off':
      return { incoming: false, live: false }
  }
}

/** Which proof is still outstanding, or null when the gate is satisfied. */
export function awaitingProof(
  required: RequiredProofs,
  proofs: RestoreProofs,
): 'incoming' | 'live' | null {
  if (required.incoming && !proofs.incoming) return 'incoming'
  if (required.live && !proofs.live) return 'live'
  return null
}

/**
 * A restore that the gate refused.
 *
 * `missing` says which half, because the two are answered by different people:
 * the incoming one by whoever brought the file, the live one by whoever owns
 * this device's vault.
 */
export class RestoreGateError extends Error {
  constructor(readonly missing: 'incoming' | 'live') {
    super(
      missing === 'incoming'
        ? 'The backup file’s passphrase has not been proven.'
        : 'The passphrase of the vault on this device has not been proven.',
    )
    this.name = 'RestoreGateError'
  }
}

/**
 * Replace the live vault with `incoming`, having proven what this device asks
 * for.
 *
 * The gate is read here, at the commit, rather than taken from the caller. A
 * screen that read the preference when it mounted and then enforced its own
 * copy would enforce whatever was true a minute ago; the point of raising the
 * gate is that it applies to the next restore, not the next page load.
 *
 * The check itself runs inside the write transaction, against the record
 * actually being displaced (`restoreVault`'s `authorize`). Deciding beforehand
 * would decide about a record another context can swap out in between, which is
 * the same second-wide window `0018` had to close on the undo.
 *
 * Throws `RestoreGateError` when a required proof is missing, and
 * `VaultSupersededError` when the vault being replaced is no longer the one the
 * caller authenticated. Both leave every record exactly where it was.
 */
export async function restoreVaultWithProof(
  incoming: StoredVault,
  proofs: RestoreProofs,
): Promise<void> {
  const { restoreGate } = await loadVaultSettings()
  await restoreVault(incoming, (live) => {
    const required = requiredProofs(restoreGate, live !== undefined)
    const missing = awaitingProof(required, proofs)
    if (missing) throw new RestoreGateError(missing)
    // Salt and not the whole record, matching `saveVault`: a credential saved
    // in another tab while this phrase was being typed rewrites the ciphertext
    // of the same vault, and the proof still holds for it. A different salt is
    // a different key, so the phrase that was typed says nothing about the
    // vault that would be pushed aside.
    if (live && proofs.live && live.salt !== proofs.live.salt) throw new VaultSupersededError()
  })
}
