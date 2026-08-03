import { WrongPassphraseError } from '../crypto/vault.ts'
import {
  loadVaultSettings,
  restoreVault,
  VaultSupersededError,
  type StoredVault,
} from '../storage/db.ts'
import type { RestoreGate } from '../storage/settings.ts'
import { provePassphrase } from './prove.ts'

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
 * Both halves carry the record rather than a flag, so that claiming a proof
 * means naming what it was made against. The commit checks both: the incoming
 * record against the one it is being asked to install, and the live record
 * against the one it is about to displace. A boolean would let a proof made
 * about one record authorise a write of another — which is the whole of what
 * `0018` had to fix on the undo, and there is no reason to rebuild it here.
 */
export interface RestoreProofs {
  incoming: StoredVault | null
  live: StoredVault | null
}

/**
 * Nothing proven — the honest starting point, and all a fresh install needs.
 *
 * Frozen because it is handed straight into React state and into
 * `restoreVaultWithProof`. Nothing mutates it today, but one `proofs.live = …`
 * anywhere would weaken the gate for every restore in the process, silently and
 * permanently.
 */
export const NO_PROOFS: RestoreProofs = Object.freeze({ incoming: null, live: null })

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
    // A proof of one file does not authorise installing another. The screen
    // holds one staged record and cannot get here with a mismatch, which is
    // exactly why it costs nothing to make the rule structural rather than a
    // property of one caller.
    if (proofs.incoming && proofs.incoming !== incoming) throw new RestoreGateError('incoming')
    // Salt and not the whole record, matching `saveVault`: a credential saved
    // in another tab while this phrase was being typed rewrites the ciphertext
    // of the same vault, and the proof still holds for it. A different salt is
    // a different key, so the phrase that was typed says nothing about the
    // vault that would be pushed aside.
    if (live && proofs.live && live.salt !== proofs.live.salt) throw new VaultSupersededError()
  })
}

/**
 * Answer one of the gate's questions with `passphrase`, and return what is
 * proven after it.
 *
 * This is the sequencing the lock screen used to hold inline, moved here so it
 * can be tested against real Argon2id rather than only looked at. What it
 * encodes:
 *
 * - The backup's phrase is asked for first. If the file cannot be opened there
 *   is no point troubling anyone about the vault it would replace.
 * - When both are wanted, the phrase that opened the file is tried against the
 *   live vault before a second field appears. Restoring your own newer export
 *   is the ordinary case and one phrase opens both there; the wasted derive
 *   when they differ costs a second on a path already spending two, which beats
 *   making everyone type the same words twice.
 * - Only `WrongPassphraseError` from that opportunistic second try is
 *   swallowed. Anything else — key-derivation parameters this browser will not
 *   run, a damaged record — is a real failure of the live vault and has to be
 *   seen rather than turned into "type it again".
 *
 * Throws `WrongPassphraseError` when the phrase does not open the record the
 * gate is currently asking about, leaving `proofs` untouched.
 */
export async function proveNextForRestore(
  passphrase: string,
  incoming: StoredVault,
  live: StoredVault,
  required: RequiredProofs,
  proofs: RestoreProofs,
): Promise<RestoreProofs> {
  const asking = awaitingProof(required, proofs)
  if (!asking) return proofs
  if (asking === 'live') {
    await provePassphrase(passphrase, live)
    return { ...proofs, live }
  }
  await provePassphrase(passphrase, incoming)
  if (!required.live || proofs.live) return { ...proofs, incoming }
  try {
    await provePassphrase(passphrase, live)
  } catch (err) {
    if (!(err instanceof WrongPassphraseError)) throw err
    return { ...proofs, incoming }
  }
  return { incoming, live }
}
