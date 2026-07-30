import { useRef, useState } from 'react'
import { deriveKey } from '../crypto/kdf.ts'
import { decryptVault, fromBase64, WrongPassphraseError, type VaultData } from '../crypto/vault.ts'
import { parseBackup } from '../storage/backup.ts'
import { archiveCurrentVault, saveVault, type StoredVault } from '../storage/db.ts'
import { Button, Panel, Screen, Title } from '../ui.tsx'

export default function LockScreen({
  stored,
  practiceDue,
  onUnlock,
  onRestored,
}: {
  stored: StoredVault
  practiceDue: boolean
  onUnlock: (rawKey: Uint8Array, data: VaultData) => void
  onRestored: (stored: StoredVault) => void
}) {
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingRestore, setPendingRestore] = useState<StoredVault | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const unlock = async () => {
    if (!phrase.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const rawKey = await deriveKey(phrase, fromBase64(stored.salt), stored.kdfParams)
      const data = await decryptVault(rawKey, {
        iv: fromBase64(stored.iv),
        ciphertext: fromBase64(stored.ciphertext),
      })
      setPhrase('')
      onUnlock(rawKey, data)
    } catch (err) {
      setError(
        err instanceof WrongPassphraseError
          ? 'That doesn’t open the door. Walk the route in your mind: start at the mailbox.'
          : `Unlock failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setBusy(false)
    }
  }

  /**
   * Restoring replaces the vault that is already on this device, so it asks
   * first — and keeps the outgoing record. Without that, one wrong file (or
   * one hostile script) permanently destroys a vault with no other copy.
   */
  const stageRestore = async (file: File) => {
    setError(null)
    try {
      setPendingRestore(parseBackup(await file.text()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const confirmRestore = async () => {
    if (!pendingRestore) return
    try {
      await archiveCurrentVault()
      await saveVault(pendingRestore)
      onRestored(pendingRestore)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingRestore(null)
    }
  }

  return (
    <Screen>
      <Title>Where Was My Password</Title>
      {practiceDue && (
        <div className="w-full rounded-lg border-2 border-amber-glow bg-amber-glow/15 p-3 text-center text-sm">
          <strong>Time for a practice walk.</strong> Unlocking now — from memory, no notes — is exactly
          the rehearsal that makes the phrase permanent.
        </div>
      )}
      <FrontDoor />
      <Panel className="w-full space-y-3 text-center">
        <p className="text-sm text-dusk/80">Walk the house. Type the words in route order.</p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void unlock()
          }}
        >
          <input
            autoFocus
            type="password"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="your passphrase…"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-lg border-2 border-dusk/40 bg-parchment px-3 py-2 text-center font-display text-lg tracking-wide focus:border-amber-glow focus:outline-none"
          />
          <Button onClick={() => void unlock()} disabled={!phrase.trim() || busy}>
            {busy ? 'Deriving key…' : 'Unlock'}
          </Button>
        </form>
        {busy && (
          <div className="flex items-center justify-center gap-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-dusk/20 border-t-amber-glow" />
            <span className="text-sm text-dusk/70">Stretching passphrase (Argon2id)…</span>
          </div>
        )}
        {error && <p className="text-sm font-semibold text-brick">{error}</p>}
      </Panel>
      {pendingRestore ? (
        <Panel className="w-full space-y-3 border-brick/60 bg-brick/10 text-sm">
          <p>
            This replaces the vault already on this device with the backup from{' '}
            <strong>{new Date(pendingRestore.createdAt).toLocaleDateString()}</strong>. You will
            need the passphrase that belongs to that backup. The current vault is kept aside, but
            the app only ever opens the restored one.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button className="!border-brick !bg-brick" onClick={() => void confirmRestore()}>
              Replace my vault
            </Button>
            <Button variant="secondary" onClick={() => setPendingRestore(null)}>
              Keep the current vault
            </Button>
          </div>
        </Panel>
      ) : (
        <button
          type="button"
          className="text-sm text-dusk/60 underline underline-offset-2 hover:text-dusk"
          onClick={() => fileRef.current?.click()}
        >
          Restore from a backup file instead
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void stageRestore(f)
          e.target.value = ''
        }}
      />
    </Screen>
  )
}

/** The locked front door of the memory house. */
function FrontDoor() {
  return (
    <svg viewBox="0 0 240 200" className="w-48">
      <polygon points="20,80 120,18 220,80" fill="#b5654a" stroke="#2b2337" strokeWidth={4} />
      <rect x={40} y={80} width={160} height={112} fill="#faf5ea" stroke="#2b2337" strokeWidth={4} />
      <rect x={90} y={104} width={60} height={88} rx={4} fill="#4a3f63" stroke="#2b2337" strokeWidth={3} />
      <circle cx={140} cy={150} r={5} fill="#e8a03d" />
      <rect x={54} y={104} width={24} height={24} fill="#bcd7d4" stroke="#2b2337" strokeWidth={3} />
      <rect x={162} y={104} width={24} height={24} fill="#bcd7d4" stroke="#2b2337" strokeWidth={3} />
      {/* keyhole glow */}
      <circle cx={120} cy={148} r={30} fill="#e8a03d" opacity={0.12} />
    </svg>
  )
}
