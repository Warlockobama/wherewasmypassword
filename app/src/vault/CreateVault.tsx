import { useState } from 'react'
import { DEFAULT_KDF_PARAMS, deriveKey } from '../crypto/kdf.ts'
import { randomBytes } from '../crypto/random.ts'
import { encryptVault, toBase64, type Association, type VaultData } from '../crypto/vault.ts'
import { downloadBackup } from '../storage/backup.ts'
import {
  freshPracticeMeta,
  requestPersistence,
  saveVault,
  savePracticeMeta,
  type StoredVault,
} from '../storage/db.ts'
import { Button, Panel, Screen, Title } from '../ui.tsx'

type Status = 'idle' | 'working' | 'done' | 'error'

export default function CreateVault({
  words,
  associations,
  onDone,
}: {
  words: string[]
  associations: Association[]
  onDone: (rawKey: Uint8Array, data: VaultData, stored: StoredVault) => void
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [detail, setDetail] = useState('')
  const [result, setResult] = useState<{ rawKey: Uint8Array; data: VaultData; stored: StoredVault } | null>(null)

  const create = async () => {
    setStatus('working')
    try {
      setDetail('Stretching your passphrase into a key (Argon2id, 64 MB)…')
      const salt = randomBytes(16)
      const passphrase = words.join(' ')
      const rawKey = await deriveKey(passphrase, salt)

      setDetail('Encrypting your vault…')
      const now = Date.now()
      const data: VaultData = { version: 1, words, associations, createdAt: now, entries: [] }
      const blob = await encryptVault(rawKey, data)

      setDetail('Saving to this browser…')
      const stored: StoredVault = {
        version: 1,
        salt: toBase64(salt),
        kdfParams: DEFAULT_KDF_PARAMS,
        iv: toBase64(blob.iv),
        ciphertext: toBase64(blob.ciphertext),
        createdAt: now,
        updatedAt: now,
      }
      await saveVault(stored)
      await savePracticeMeta(freshPracticeMeta(now))
      await requestPersistence()

      setResult({ rawKey, data, stored })
      setStatus('done')
    } catch (err) {
      setDetail(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  return (
    <Screen>
      <Title>Seal the Vault</Title>
      <Panel className="w-full space-y-4 text-center">
        {status === 'idle' && (
          <>
            <p>
              Your phrase now lives in your head — and only there. Next we turn it into an encryption
              key and create your vault, stored <strong>encrypted, on this device only</strong>. Your
              words and images go inside the vault too, so you can revisit the house after unlocking.
            </p>
            <p className="text-sm text-dusk/70">
              Nothing about your phrase is stored in readable form. If you forget it, nobody can
              recover the vault — that&apos;s the deal that makes it strong. Keep practicing.
            </p>
            <Button onClick={() => void create()}>Create my encrypted vault</Button>
          </>
        )}
        {status === 'working' && (
          <div className="space-y-3">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-dusk/20 border-t-amber-glow" />
            <p className="text-sm text-dusk/80">{detail}</p>
          </div>
        )}
        {status === 'error' && (
          <div className="space-y-3">
            <p className="font-semibold text-brick">Something went wrong: {detail}</p>
            <Button onClick={() => void create()}>Try again</Button>
          </div>
        )}
        {status === 'done' && result && (
          <div className="space-y-4">
            <p className="text-lg font-semibold text-sage">Your vault is sealed. 🎉</p>
            <p className="text-sm">
              One last thing: browsers can evict local storage. Download an <strong>encrypted</strong>{' '}
              backup file — it&apos;s exactly as unreadable as the vault itself, so it&apos;s safe to
              keep anywhere.
            </p>
            <div className="flex justify-center gap-3">
              <Button variant="secondary" onClick={() => downloadBackup(result.stored)}>
                Download backup
              </Button>
              <Button onClick={() => onDone(result.rawKey, result.data, result.stored)}>Enter the vault</Button>
            </div>
          </div>
        )}
      </Panel>
    </Screen>
  )
}
