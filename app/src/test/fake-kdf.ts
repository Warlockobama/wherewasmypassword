import { normalizePassphrase } from '../crypto/wordlist.ts'

/**
 * A stand-in for `deriveKey` that is instant instead of correct.
 *
 * The real one is 256 MiB of Argon2id and takes the better part of a second on
 * purpose — which is right for a vault and wrong for a test file that opens one
 * a dozen times. Everything downstream of the key stays real: the AES-GCM
 * encryption, the header binding, the auth tag that IS the wrong-passphrase
 * signal. Only the stretching is skipped.
 *
 * It keeps the two properties every test here leans on: the same phrase and
 * salt always give the same key, and different ones never do. It deliberately
 * does NOT keep the real function's refusal of out-of-range KDF parameters — a
 * test that needs that should use the real `deriveKey`.
 *
 * This module imports nothing from `crypto/kdf.ts`, so a test can mock that
 * module with a factory that pulls this one in without a circular import.
 */
export function fakeDeriveKey(
  passphrase: string,
  salt: Uint8Array,
  _params?: unknown,
): Promise<Uint8Array> {
  const seed = new TextEncoder().encode(
    `${normalizePassphrase(passphrase)}|${[...salt].join(',')}`,
  )
  // FNV-1a, run 32 times with the byte index folded in. Not a hash anyone
  // should rely on for anything — just a spread that is stable across runs.
  const key = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    let h = 0x811c9dc5 ^ i
    for (const byte of seed) {
      h ^= byte
      h = Math.imul(h, 0x01000193) >>> 0
    }
    key[i] = h & 0xff
  }
  return Promise.resolve(key)
}
