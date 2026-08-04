import { useState } from 'react'
import { DEFAULT_KDF_PARAMS } from '../crypto/kdf.ts'
import type { Association, VaultData } from '../crypto/vault.ts'
import { downloadBackup } from '../storage/backup.ts'
import {
  freshPracticeMeta,
  requestPersistence,
  savePracticeMeta,
  VaultAlreadyExistsError,
  type StoredVault,
} from '../storage/db.ts'
import { rekeyVault } from './seal.ts'
import { Button, Panel, Screen, Title } from '../ui.tsx'

type Status = 'idle' | 'working' | 'done' | 'error' | 'exists'

export default function CreateVault({
  words,
  associations,
  onDone,
  onExistingVault,
}: {
  words: string[]
  associations: Association[]
  onDone: (rawKey: Uint8Array, data: VaultData, stored: StoredVault) => void
  /**
   * Another copy of the UI sealed a vault on this device while this one was
   * still walking its memory house (`decisions/0020`). There is nothing to
   * enter here, and the vault that exists is the one to open.
   */
  onExistingVault: () => void
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [detail, setDetail] = useState('')
  const [result, setResult] = useState<{ rawKey: Uint8Array; data: VaultData; stored: StoredVault } | null>(null)

  const create = async () => {
    setStatus('working')
    try {
      setDetail(
        `Stretching your passphrase into a key (Argon2id, ${DEFAULT_KDF_PARAMS.memoryKiB / 1024} MB)…`,
      )
      const now = Date.now()
      const data: VaultData = { version: 1, words, associations, createdAt: now, entries: [] }
      // Same path as changing the passphrase and as raising an old vault's
      // settings: derive under a fresh salt, encrypt, save — except that this
      // one refuses to land on a vault already there (`decisions/0020`).
      const { rawKey, stored } = await rekeyVault(words.join(' '), data, now, 'create')

      setDetail('Saving to this browser…')
      // Only after the vault itself landed. A refusal above must leave the
      // other tab's practice schedule alone as well: resetting the ladder for a
      // vault this screen did not create would be a smaller version of the same
      // damage, and nothing would put it back.
      await savePracticeMeta(freshPracticeMeta(now))
      await requestPersistence()

      setResult({ rawKey, data, stored })
      setStatus('done')
    } catch (err) {
      if (err instanceof VaultAlreadyExistsError) {
        setStatus('exists')
        return
      }
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
        {/* No "try again": trying again is the thing that must not happen. The
            only way out is the vault that is already here. */}
        {status === 'exists' && (
          <div className="space-y-3">
            <p className="font-semibold text-brick">This browser already has a vault.</p>
            <p className="text-sm">
              Another tab or window finished setting one up while this one was open. Nothing was
              saved here, and <strong>the vault already on this device is untouched</strong> — this
              screen will not write over it.
            </p>
            <p className="text-sm text-dusk/70">
              The phrase you just learned guards nothing, so let it go and use the one that vault was
              made with. If you really did mean to start again, open the vault and use
              &ldquo;Delete vault &amp; start over&rdquo; inside it.
            </p>
            <Button onClick={onExistingVault}>Open the vault on this device</Button>
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
