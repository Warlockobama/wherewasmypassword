import { kdfParamsAreSupported } from '../crypto/kdf.ts'
import type { StoredVault } from './db.ts'

const FILE_KIND = 'wherewasmypassword-backup'

/**
 * Per-field ceilings. The ciphertext is the only field that is legitimately
 * large; a salt is 24 base64 characters and an IV is 16, so accepting eight
 * megabytes of either would be pure indulgence.
 */
const MAX_CHARS = { salt: 128, iv: 64, ciphertext: 8 * 1024 * 1024 }

/** Base64 as `toBase64` emits it. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

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
  // `JSON.parse('null')` and `JSON.parse('7')` both succeed, and reading
  // `.kind` off either throws a raw TypeError the user would be shown.
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Not a Where Was My Password backup file.')
  }
  const file = parsed as Partial<BackupFile>
  if (file.kind !== FILE_KIND || !file.vault || typeof file.vault !== 'object') {
    throw new Error('Not a Where Was My Password backup file.')
  }
  const v = file.vault
  // Presence is not enough: `salt: {}` or `iv: 7` would sail past a truthiness
  // check and only blow up later, deep inside the unlock path — by which point
  // the restore has already replaced the live vault. Base64 is checked here
  // for the same reason: `salt: 'not base64!!'` is a string of a sane length
  // and fails only when `atob` reaches it, one screen too late.
  // The length test is not pedantry: `atob` accepts 2 and 3 characters over a
  // multiple of four but throws on 1, and the alphabet regex alone cannot see
  // that. `salt: 'AAAAA'` used to pass here and fail as a raw DOMException at
  // unlock — after the restore had already replaced the live vault, which is
  // exactly the ordering this validation exists to prevent.
  const isField = (x: unknown, max: number) =>
    typeof x === 'string' &&
    x.length > 0 &&
    x.length <= max &&
    x.length % 4 !== 1 &&
    BASE64.test(x)
  // Both formats are accepted and the version is carried through unchanged: a
  // format-1 file has to keep saying 1, because that is what tells the unlock
  // path to decrypt it without the padding and header binding it was written
  // without. Restoring one and then saving upgrades it in place.
  if (
    (v.version !== 1 && v.version !== 2) ||
    !isField(v.salt, MAX_CHARS.salt) ||
    !isField(v.iv, MAX_CHARS.iv) ||
    !isField(v.ciphertext, MAX_CHARS.ciphertext)
  ) {
    throw new Error('Backup file is incomplete or from an unsupported version.')
  }
  if (!kdfParamsAreSupported(v.kdfParams)) {
    throw new Error('Backup file has unsupported key-derivation settings.')
  }
  // A timestamp far in the future is finite and would push the next practice
  // reminder past the end of the century, silently retiring the schedule.
  const now = Date.now()
  const timestamp = (x: unknown) =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= now ? x : now
  // Rebuild the record field by field rather than returning the parsed object:
  // whatever else the file carried does not get persisted to IndexedDB.
  return {
    version: v.version,
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
