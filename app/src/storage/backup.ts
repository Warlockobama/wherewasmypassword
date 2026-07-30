import { kdfParamsAreSupported } from '../crypto/kdf.ts'
import type { StoredVault } from './db.ts'

const FILE_KIND = 'wherewasmypassword-backup'

/**
 * A base64 field big enough for any real vault and small enough that a hostile
 * file cannot fill the origin's storage quota on restore.
 */
const MAX_FIELD_CHARS = 8 * 1024 * 1024

export interface BackupFile {
  kind: typeof FILE_KIND
  exportedAt: number
  vault: StoredVault
}

export function serializeBackup(vault: StoredVault): string {
  const file: BackupFile = { kind: FILE_KIND, exportedAt: Date.now(), vault }
  return JSON.stringify(file, null, 2)
}

export function parseBackup(text: string): StoredVault {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Not a valid backup file (unreadable JSON).')
  }
  const file = parsed as Partial<BackupFile>
  if (file.kind !== FILE_KIND || !file.vault || typeof file.vault !== 'object') {
    throw new Error('Not a Where Was My Password backup file.')
  }
  const v = file.vault
  // Presence is not enough: `salt: {}` or `iv: 7` would sail past a truthiness
  // check and only blow up later, deep inside the unlock path.
  const isField = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length <= MAX_FIELD_CHARS
  if (v.version !== 1 || !isField(v.salt) || !isField(v.iv) || !isField(v.ciphertext)) {
    throw new Error('Backup file is incomplete or from an unsupported version.')
  }
  if (!kdfParamsAreSupported(v.kdfParams)) {
    throw new Error('Backup file has unsupported key-derivation settings.')
  }
  const timestamp = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : Date.now())
  // Rebuild the record field by field rather than returning the parsed object:
  // whatever else the file carried does not get persisted to IndexedDB.
  return {
    version: 1,
    salt: v.salt,
    iv: v.iv,
    ciphertext: v.ciphertext,
    kdfParams: {
      algorithm: 'argon2id',
      memoryKiB: v.kdfParams.memoryKiB,
      iterations: v.kdfParams.iterations,
      parallelism: v.kdfParams.parallelism,
    },
    createdAt: timestamp(v.createdAt),
    updatedAt: timestamp(v.updatedAt),
  }
}

/** Trigger a download of the encrypted vault as a .wwmp.json file. */
export function downloadBackup(vault: StoredVault): void {
  const blob = new Blob([serializeBackup(vault)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `vault-${new Date().toISOString().slice(0, 10)}.wwmp.json`
  a.click()
  URL.revokeObjectURL(url)
}
