import { argon2id } from 'hash-wasm'
import { normalizePassphrase } from './wordlist.ts'

export interface KdfParams {
  algorithm: 'argon2id'
  memoryKiB: number
  iterations: number
  parallelism: number
}

/**
 * The settings a vault written today gets. Stored with the vault so they can be
 * raised without breaking existing ones — and, since `decisions/0013`, actually
 * raised: an older vault is re-keyed to these on its next unlock.
 *
 * 256 MiB costs roughly 0.6s per unlock on ordinary hardware, behind the
 * spinner that is already there, and costs an attacker about four times as much
 * per guess as the 64 MiB this used to be. Memory is the parameter worth
 * spending on: it is what makes GPU and ASIC guessing expensive, where
 * iterations only cost time.
 */
export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: 'argon2id',
  memoryKiB: 256 * 1024,
  iterations: 3,
  parallelism: 1,
}

/**
 * Whether a vault's stored parameters are behind the current defaults, and so
 * whether it is worth re-deriving its key at unlock.
 *
 * Only the two parameters that cost an attacker anything are compared.
 * `parallelism` is a shape choice, not a strength one — raising it splits the
 * same memory across more lanes — so a vault is not dragged through a re-key
 * for it.
 */
export function kdfParamsAreOutdated(params: KdfParams): boolean {
  return (
    params.algorithm !== DEFAULT_KDF_PARAMS.algorithm ||
    params.memoryKiB < DEFAULT_KDF_PARAMS.memoryKiB ||
    params.iterations < DEFAULT_KDF_PARAMS.iterations
  )
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
