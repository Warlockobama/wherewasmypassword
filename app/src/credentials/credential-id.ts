import { randomBytes } from '../crypto/random.ts'
import { toBase64 } from '../crypto/vault.ts'

/** 12 random bytes → 16-char URL-safe base64 ID (96 bits of entropy). */
export function newCredentialId(): string {
  return toBase64(randomBytes(12))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
