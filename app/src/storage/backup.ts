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
  return v
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
