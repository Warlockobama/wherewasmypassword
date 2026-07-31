import { randomBytes } from './random.ts'
import type { KdfParams } from './kdf.ts'
import type { Credential } from '../credentials/types.ts'

/** One word placed at one locus, with the user's vivid-imagery text. */
export interface Association {
  locusId: string
  word: string
  imagery: string
}

export interface VaultData {
  /** Schema of the *plaintext*, unrelated to the on-disk format version below. */
  version: 1
  words: string[]
  associations: Association[]
  createdAt: number
  /** Site credentials, encrypted under the same master key. */
  entries: Credential[]
}

/**
 * On-disk format of the encrypted record.
 *
 * 1 — bare JSON, ciphertext exactly as long as its plaintext, header unbound.
 * 2 — plaintext padded to a whole number of 4 KiB blocks behind a length
 *     prefix, and the header (format version, salt, KDF parameters) bound into
 *     the ciphertext as AES-GCM additional data.
 *
 * Version 1 is still readable; anything that writes a vault writes version 2,
 * so a vault upgrades the first time it is saved (see `decisions/0014`).
 */
export type VaultFormatVersion = 1 | 2
export const VAULT_FORMAT_VERSION = 2 satisfies VaultFormatVersion

/**
 * The plaintext is padded to a multiple of this before encryption.
 *
 * AES-GCM ciphertext is exactly as long as its plaintext, and the stored length
 * is readable without any key — from IndexedDB or from a backup file. Two
 * snapshots of an unpadded vault therefore reveal the length of whatever was
 * added between them, which is a direct hint at one site password's length.
 * 4 KiB is comfortably larger than a credential entry, so ordinary edits do not
 * move the block count at all.
 */
export const PAD_BLOCK_BYTES = 4096
const LENGTH_PREFIX_BYTES = 4

/** The header fields bound into the ciphertext. `StoredVault` satisfies this. */
export interface VaultHeader {
  version: VaultFormatVersion
  /** Base64, exactly as it is stored. */
  salt: string
  kdfParams: KdfParams
}

/** What a caller supplies when writing; the version is always the current one. */
export type NewVaultHeader = Omit<VaultHeader, 'version'>

export class WrongPassphraseError extends Error {
  constructor() {
    super('Decryption failed — wrong passphrase or corrupted vault.')
    this.name = 'WrongPassphraseError'
  }
}

class DamagedVaultError extends Error {
  constructor() {
    super('The vault decrypted but its contents are damaged.')
    this.name = 'DamagedVaultError'
  }
}

export interface EncryptedBlob {
  iv: Uint8Array
  ciphertext: Uint8Array
}

async function importAesKey(rawKey: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey as BufferSource, 'AES-GCM', false, [usage])
}

/**
 * The additional data that authenticates the header.
 *
 * Written as one canonical string rather than JSON on purpose: JSON key order
 * is a property of whoever built the object, and a header that re-serialised
 * differently would fail to decrypt a vault that is perfectly intact.
 */
function headerAad(header: VaultHeader): Uint8Array {
  const { algorithm, memoryKiB, iterations, parallelism } = header.kdfParams
  return new TextEncoder().encode(
    `wwmp-vault-v${header.version}|${header.salt}|${algorithm}|${memoryKiB}|${iterations}|${parallelism}`,
  )
}

function padPlaintext(body: Uint8Array): Uint8Array {
  const blocks = Math.ceil((LENGTH_PREFIX_BYTES + body.length) / PAD_BLOCK_BYTES)
  const padded = new Uint8Array(blocks * PAD_BLOCK_BYTES)
  // Big-endian, so the prefix is stable across machines rather than following
  // whatever byte order the CPU running the browser happens to prefer.
  new DataView(padded.buffer).setUint32(0, body.length, false)
  padded.set(body, LENGTH_PREFIX_BYTES)
  return padded
}

function unpadPlaintext(padded: Uint8Array): Uint8Array {
  if (padded.length < LENGTH_PREFIX_BYTES) throw new DamagedVaultError()
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength)
  const length = view.getUint32(0, false)
  // The plaintext is authenticated, so a bad length means corruption rather
  // than an attack — but it must not be allowed to read past the buffer.
  if (length > padded.length - LENGTH_PREFIX_BYTES) throw new DamagedVaultError()
  return padded.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + length)
}

/**
 * Encrypt the vault in the current format: padded plaintext, header bound in.
 *
 * The header is required rather than optional because binding it is the whole
 * point — an optional argument is one an upgrade path forgets to pass.
 */
export async function encryptVault(
  rawKey: Uint8Array,
  data: VaultData,
  header: NewVaultHeader,
): Promise<EncryptedBlob> {
  const key = await importAesKey(rawKey, 'encrypt')
  const iv = randomBytes(12)
  const padded = padPlaintext(new TextEncoder().encode(JSON.stringify(data)))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      additionalData: headerAad({ ...header, version: VAULT_FORMAT_VERSION }) as BufferSource,
    },
    key,
    padded as BufferSource,
  )
  return { iv, ciphertext: new Uint8Array(ciphertext) }
}

/**
 * There is deliberately no separate password verifier: the AES-GCM auth tag
 * failing IS the wrong-passphrase signal, so nothing extra derived from the
 * passphrase ever hits storage.
 *
 * A tampered header fails here too, since it is authenticated — and fails
 * closed, as a wrong passphrase, which is the safe direction.
 */
export async function decryptVault(
  rawKey: Uint8Array,
  blob: EncryptedBlob,
  header: VaultHeader,
): Promise<VaultData> {
  const key = await importAesKey(rawKey, 'decrypt')
  // Format 1 predates both padding and header binding, so it is decrypted the
  // way it was written. It is upgraded the next time anything saves it.
  const legacy = header.version === 1
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: blob.iv as BufferSource,
        ...(legacy ? {} : { additionalData: headerAad(header) as BufferSource }),
      },
      key,
      blob.ciphertext as BufferSource,
    )
  } catch {
    throw new WrongPassphraseError()
  }
  const body = legacy ? new Uint8Array(plaintext) : unpadPlaintext(new Uint8Array(plaintext))
  // Authentic but unparseable plaintext means a corrupt vault, not a wrong
  // passphrase — say so rather than surfacing a raw JSON parser message.
  let data: VaultData
  try {
    data = JSON.parse(new TextDecoder().decode(body)) as VaultData
  } catch {
    throw new DamagedVaultError()
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.words)) {
    throw new DamagedVaultError()
  }
  // Vaults written before v2 credential storage have no `entries` key; backfill
  // it so every caller can treat the array as always present.
  return {
    ...data,
    associations: Array.isArray(data.associations) ? data.associations : [],
    entries: Array.isArray(data.entries) ? data.entries : [],
  }
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
