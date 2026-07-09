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

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  if (params.algorithm !== 'argon2id') {
    throw new Error(`unsupported KDF: ${params.algorithm as string}`)
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
