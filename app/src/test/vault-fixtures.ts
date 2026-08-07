import { DEFAULT_KDF_PARAMS } from '../crypto/kdf.ts'
import { encryptVault, toBase64, type VaultData } from '../crypto/vault.ts'
import type { StoredVault } from '../storage/db.ts'
import { fakeDeriveKey } from './fake-kdf.ts'

/**
 * Build a genuine `StoredVault` — real AES-GCM, real padding, real header
 * binding — sealed under `phrase`.
 *
 * Genuine matters here. A component test that hands the UI a hand-written
 * record proves the UI can render a refusal; one that hands it a record only
 * the right phrase opens proves the refusal is the *cryptography's* answer,
 * which is the thing every gate on the lock screen actually rests on.
 *
 * Each vault gets its own salt, derived from the phrase, so that two fixtures
 * are two different keys and `saveVault`'s salt precondition means something.
 */
export async function sealedUnder(
  phrase: string,
  overrides: Partial<VaultData> & { createdAt?: number; updatedAt?: number } = {},
): Promise<StoredVault> {
  const salt = new Uint8Array(16)
  const tag = new TextEncoder().encode(phrase)
  for (let i = 0; i < salt.length; i++) salt[i] = (tag[i % tag.length] ?? 0) + i

  const createdAt = overrides.createdAt ?? Date.parse('2026-01-01T00:00:00Z')
  const data: VaultData = {
    version: 1,
    words: phrase.split(' '),
    associations: [],
    createdAt,
    entries: [],
    ...overrides,
  }
  const rawKey = await fakeDeriveKey(phrase, salt)
  const header = { salt: toBase64(salt), kdfParams: DEFAULT_KDF_PARAMS }
  const { iv, ciphertext } = await encryptVault(rawKey, data, header)
  return {
    version: 2,
    salt: header.salt,
    kdfParams: DEFAULT_KDF_PARAMS,
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
  }
}
