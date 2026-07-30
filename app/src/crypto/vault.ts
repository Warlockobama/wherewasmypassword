import { randomBytes } from './random.ts'
import type { Credential } from '../credentials/types.ts'

/** One word placed at one locus, with the user's vivid-imagery text. */
export interface Association {
  locusId: string
  word: string
  imagery: string
}

export interface VaultData {
  version: 1
  words: string[]
  associations: Association[]
  createdAt: number
  /** Site credentials, encrypted under the same master key. */
  entries: Credential[]
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('Decryption failed — wrong passphrase or corrupted vault.')
    this.name = 'WrongPassphraseError'
  }
}

export interface EncryptedBlob {
  iv: Uint8Array
  ciphertext: Uint8Array
}

async function importAesKey(rawKey: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey as BufferSource, 'AES-GCM', false, [usage])
}

export async function encryptVault(rawKey: Uint8Array, data: VaultData): Promise<EncryptedBlob> {
  const key = await importAesKey(rawKey, 'encrypt')
  const iv = randomBytes(12)
  const plaintext = new TextEncoder().encode(JSON.stringify(data))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  )
  return { iv, ciphertext: new Uint8Array(ciphertext) }
}

/**
 * There is deliberately no separate password verifier: the AES-GCM auth tag
 * failing IS the wrong-passphrase signal, so nothing extra derived from the
 * passphrase ever hits storage.
 */
export async function decryptVault(rawKey: Uint8Array, blob: EncryptedBlob): Promise<VaultData> {
  const key = await importAesKey(rawKey, 'decrypt')
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: blob.iv as BufferSource },
      key,
      blob.ciphertext as BufferSource,
    )
  } catch {
    throw new WrongPassphraseError()
  }
  return JSON.parse(new TextDecoder().decode(plaintext)) as VaultData
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
