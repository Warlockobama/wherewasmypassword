import type { StoredVault } from './db.ts'

const FILE_KIND = 'wherewasmypassword-backup'

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
  if (file.kind !== FILE_KIND || !file.vault) {
    throw new Error('Not a Where Was My Password backup file.')
  }
  const v = file.vault
  if (v.version !== 1 || !v.salt || !v.iv || !v.ciphertext || !v.kdfParams) {
    throw new Error('Backup file is incomplete or from an unsupported version.')
  }
  assertSaneKdfParams(v.kdfParams)
  return v
}

/**
 * A backup file is untrusted input, and its KDF parameters are fed straight to
 * Argon2id on the next unlock. Unchecked, `memoryKiB: 2**31` would ask for two
 * terabytes and wedge the unlock screen for good.
 */
function assertSaneKdfParams(params: StoredVault['kdfParams']): void {
  const inRange = (n: unknown, lo: number, hi: number) =>
    typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi

  if (
    params.algorithm !== 'argon2id' ||
    !inRange(params.memoryKiB, 8 * 1024, 1024 * 1024) ||
    !inRange(params.iterations, 1, 10) ||
    !inRange(params.parallelism, 1, 4)
  ) {
    throw new Error('Backup file has unsupported key-derivation settings.')
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
