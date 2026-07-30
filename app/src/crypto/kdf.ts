import { argon2id } from 'hash-wasm'
import { normalizePassphrase } from './wordlist.ts'

export interface KdfParams {
  algorithm: 'argon2id'
  memoryKiB: number
  iterations: number
  parallelism: number
}

// OWASP-recommended class of settings; stored with the vault so they can
// be raised later without breaking existing vaults.
export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: 'argon2id',
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
}

/**
 * Whether a set of KDF parameters is one we are willing to hand to Argon2id.
 *
 * Every parameter set reaching this function is untrusted: it arrives either
 * from a backup file the user was given, or from the IndexedDB record, which
 * anyone with the browser profile directory can rewrite. `memoryKiB: 2**31`
 * would ask for two terabytes on every unlock attempt and wedge the vault
 * permanently — and because the header is not authenticated, the user would
 * be told their passphrase was wrong.
 *
 * The bounds are wide enough to allow raising the defaults later (up to 1 GiB)
 * without a code change.
 */
export function kdfParamsAreSupported(params: KdfParams | undefined): params is KdfParams {
  const inRange = (n: unknown, lo: number, hi: number) =>
    typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi

  return (
    !!params &&
    params.algorithm === 'argon2id' &&
    inRange(params.memoryKiB, 8 * 1024, 1024 * 1024) &&
    inRange(params.iterations, 1, 10) &&
    inRange(params.parallelism, 1, 4)
  )
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  // Checked here rather than at each call site so no path into Argon2id can
  // miss it: the backup path was guarded and the stored-vault path was not.
  if (!kdfParamsAreSupported(params)) {
    throw new Error('unsupported key-derivation settings')
  }
  return argon2id({
    password: normalizePassphrase(passphrase),
    salt,
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: 'binary',
  })
}
