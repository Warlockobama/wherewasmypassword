import { useEffect, useRef, useState } from 'react'
import { deriveKey } from '../crypto/kdf.ts'
import { decryptVault, fromBase64, WrongPassphraseError, type VaultData } from '../crypto/vault.ts'
import { parseBackup } from '../storage/backup.ts'
import {
  archiveCurrentVault,
  loadArchivedVault,
  saveVault,
  undoRestore,
  type StoredVault,
} from '../storage/db.ts'
import { clearPopupSession } from '../popup/session.ts'
import { upgradeNeeded, upgradeOnUnlock } from './seal.ts'
import { Button, Panel, Screen, Title } from '../ui.tsx'

export default function LockScreen({
  stored,
  practiceDue,
  onUnlock,
  onRestored,
}: {
  stored: StoredVault
  practiceDue: boolean
  onUnlock: (rawKey: Uint8Array, data: VaultData, stored: StoredVault, resealed: boolean) => void
  onRestored: (stored: StoredVault) => void
}) {
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingRestore, setPendingRestore] = useState<StoredVault | null>(null)
  // The vault a restore replaced, if one is still set aside. Its presence is
  // the whole condition for offering the undo (`decisions/0016`).
  const [archived, setArchived] = useState<StoredVault | null>(null)
  const [confirmingUndo, setConfirmingUndo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Shown while the vault is being brought forward, because on an old vault
  // that is a second Argon2id run and the wait roughly doubles. Silence there
  // reads as a hang.
  const [upgrading, setUpgrading] = useState(false)

  useEffect(() => {
    void loadArchivedVault()
      .then((v) => setArchived(v ?? null))
      .catch(() => setArchived(null))
  }, [])

  const unlock = async () => {
    if (!phrase.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const rawKey = await deriveKey(phrase, fromBase64(stored.salt), stored.kdfParams)
      const data = await decryptVault(
        rawKey,
        { iv: fromBase64(stored.iv), ciphertext: fromBase64(stored.ciphertext) },
        stored,
      )
      // Only now, with the phrase proven, can an old vault be moved to today's
      // key-derivation settings and vault format — deriving a new key needs the
      // phrase, and this is the only moment it is in hand (`decisions/0013`).
      setUpgrading(upgradeNeeded(stored) !== 'none')
      const brought = await upgradeOnUnlock(phrase, rawKey, data, stored)
      setPhrase('')
      onUnlock(brought.rawKey, data, brought.stored, brought.upgraded !== 'none')
    } catch (err) {
      setError(
        err instanceof WrongPassphraseError
          ? 'That doesn’t open the door. Walk the route in your mind: start at the mailbox.'
          : `Unlock failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setBusy(false)
      setUpgrading(false)
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
      // Whatever a popup is holding belongs to the vault that was just replaced.
      // Its salt no longer matches, so it would be refused anyway; not leaving
      // it parked for five minutes is cheaper than reasoning about that.
      await clearPopupSession()
      // `stored` is what was live a moment ago, which is what was just set
      // aside — so the undo appears without a second trip to the database.
      setArchived(stored)
      onRestored(pendingRestore)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingRestore(null)
    }
  }

  /**
   * Put back the vault this device had before the restore.
   *
   * Deliberately not offered as "are you sure" on a hair trigger: it replaces
   * the vault that is live now, which is the file the user chose. That file is
   * still on their disk, which is why one confirmation is enough.
   */
  const confirmUndo = async () => {
    try {
      const back = await undoRestore()
      setArchived(null)
      setConfirmingUndo(false)
      if (!back) return
      await clearPopupSession()
      onRestored(back)
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
        {busy && (
          <div className="flex items-center justify-center gap-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-dusk/20 border-t-amber-glow" />
            <span className="text-sm text-dusk/70">
              {upgrading
                ? 'Re-encrypting with stronger settings…'
                : 'Stretching passphrase (Argon2id)…'}
            </span>
          </div>
        )}
        {error && <p className="text-sm font-semibold text-brick">{error}</p>}
      </Panel>
      {pendingRestore ? (
        <Panel className="w-full space-y-3 border-brick/60 bg-brick/10 text-sm">
          <p>
            This replaces the vault already on this device with the backup from{' '}
            <strong>{new Date(pendingRestore.createdAt).toLocaleDateString()}</strong>. You will
            need the passphrase that belongs to that backup. The vault being replaced is kept
            aside — if this turns out to be the wrong file, this screen can put it back.
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

      {/* Offered for as long as a replaced vault is set aside — until the next
          restore overwrites it, or a passphrase change deletes it (`0012`). A
          restore that turns out to be wrong is usually noticed at the moment
          the phrase does not open it, which is this screen. */}
      {archived && !pendingRestore && !confirmingUndo && (
        <button
          type="button"
          className="text-sm text-dusk/60 underline underline-offset-2 hover:text-dusk"
          onClick={() => setConfirmingUndo(true)}
        >
          Restored the wrong file? Put the previous vault back
        </button>
      )}

      {archived && confirmingUndo && (
        <Panel className="w-full space-y-3 border-brick/60 bg-brick/10 text-sm">
          <p>
            This puts back the vault this device had before the restore, last changed{' '}
            <strong>{new Date(archived.updatedAt).toLocaleString()}</strong>, and opens with the
            passphrase <em>that</em> vault used. The backup file you restored from is untouched on
            your disk, so you can restore it again — but this device keeps only one vault aside, so
            it will not be offered twice.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button className="!border-brick !bg-brick" onClick={() => void confirmUndo()}>
              Put the previous vault back
            </Button>
            <Button variant="secondary" onClick={() => setConfirmingUndo(false)}>
              Keep the restored one
            </Button>
          </div>
        </Panel>
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
