import { useRef, useState } from 'react'
import { deriveKey } from '../crypto/kdf.ts'
import { decryptVault, fromBase64, WrongPassphraseError, type VaultData } from '../crypto/vault.ts'
import { parseBackup } from '../storage/backup.ts'
import { saveVault, type StoredVault } from '../storage/db.ts'
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

  const restore = async (file: File) => {
    try {
      const restored = parseBackup(await file.text())
      await saveVault(restored)
      onRestored(restored)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
        {error && <p className="text-sm font-semibold text-brick">{error}</p>}
      </Panel>
      <button
        type="button"
        className="text-sm text-dusk/60 underline underline-offset-2 hover:text-dusk"
        onClick={() => fileRef.current?.click()}
      >
        Restore from a backup file instead
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void restore(f)
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
