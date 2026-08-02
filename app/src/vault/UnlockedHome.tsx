import { useEffect, useState } from 'react'
import Palace from '../palace/Palace.tsx'
import type { VaultData } from '../crypto/vault.ts'
import { ClueCard, EmptySlot } from '../palace/rooms/shared.tsx'
import { LOCI } from '../palace/loci.ts'
import { downloadBackup } from '../storage/backup.ts'
import { deleteVault, VaultSupersededError, type StoredVault } from '../storage/db.ts'
import { Button, Panel, Screen, Title } from '../ui.tsx'
import { isExtensionContext } from '../platform.ts'
import type { Credential } from '../credentials/types.ts'
import CredentialList from '../credentials/CredentialList.tsx'
import CredentialForm from '../credentials/CredentialForm.tsx'
import {
  addCredential,
  editCredential,
  deleteCredential,
} from '../credentials/vault-credentials.ts'
import {
  popupSessionEnabled,
  setPopupSessionEnabled,
  watchPopupSessionPreference,
} from '../popup/session.ts'

export default function UnlockedHome({
  data,
  stored,
  rawKey,
  daysUntilPractice,
  resealed,
  onLock,
  onDeleted,
  onVaultChanged,
  onChangePassphrase,
}: {
  data: VaultData
  stored: StoredVault
  rawKey: Uint8Array
  daysUntilPractice: number
  /** This unlock also re-encrypted the vault to current settings. */
  resealed: boolean
  onLock: () => void
  onDeleted: () => void
  onVaultChanged: (data: VaultData, stored: StoredVault) => void
  onChangePassphrase: () => void
}) {
  const [walking, setWalking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [step, setStep] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

  // Credential management state
  const [formMode, setFormMode] = useState<'hidden' | 'add' | 'edit'>('hidden')
  const [editingCred, setEditingCred] = useState<Credential | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clues = Object.fromEntries(
    LOCI.map((l) => {
      const assoc = data.associations.find((a) => a.locusId === l.id)
      return [
        l.id,
        assoc ? (
          <ClueCard key={l.id} word={assoc.word} imagery={assoc.imagery} anchorEmoji={l.anchor.emoji} />
        ) : (
          <EmptySlot key={l.id} />
        ),
      ]
    }),
  )

  /**
   * A save can now be refused rather than merely fail: if the vault was
   * re-keyed in another tab, writing this one would put the retired key back.
   * Silence there would look exactly like success and lose the edit, so every
   * save path reports.
   */
  const saveError = (err: unknown) =>
    setError(
      err instanceof VaultSupersededError
        ? 'This vault was re-encrypted in another tab, so this change was not saved. Lock and unlock to pick up the new one — your entry is still in the form.'
        : `Could not save: ${err instanceof Error ? err.message : String(err)}`,
    )

  const handleAddCredential = async (fields: {
    label: string; url: string; username: string; password: string; notes: string
  }) => {
    setSaving(true)
    setError(null)
    try {
      const [nextData, nextStored] = await addCredential(rawKey, data, stored, fields)
      onVaultChanged(nextData, nextStored)
      setFormMode('hidden')
    } catch (err) {
      saveError(err)
    } finally {
      setSaving(false)
    }
  }

  const handleEditCredential = async (fields: {
    label: string; url: string; username: string; password: string; notes: string
  }) => {
    if (!editingCred) return
    setSaving(true)
    setError(null)
    try {
      const [nextData, nextStored] = await editCredential(rawKey, data, stored, {
        id: editingCred.id,
        ...fields,
      })
      onVaultChanged(nextData, nextStored)
      setFormMode('hidden')
      setEditingCred(undefined)
    } catch (err) {
      saveError(err)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteCredential = async (id: string) => {
    setError(null)
    try {
      const [nextData, nextStored] = await deleteCredential(rawKey, data, stored, id)
      onVaultChanged(nextData, nextStored)
    } catch (err) {
      saveError(err)
    }
  }

  if (walking) {
    return (
      <Screen wide>
        <Title>A Walk Through Your House</Title>
        <p className="-mt-2 text-center text-sm text-dusk/70">
          Guess before you open — the recall is what strengthens the memory.
        </p>
        <Palace
          stepIndex={step}
          onStepChange={(i) => {
            setStep(i)
            setOpenId(null)
          }}
          clues={clues}
          openLocusId={openId}
          onLocusClick={(id) => setOpenId(openId === id ? null : id)}
          activeLocusCount={data.words.length}
        />
        <Button variant="secondary" onClick={() => setWalking(false)}>
          Done walking
        </Button>
      </Screen>
    )
  }

  return (
    <Screen>
      <Title>Vault Unlocked</Title>
      <p className="-mt-2 text-center text-sm text-dusk/70">
        Created {new Date(data.createdAt).toLocaleDateString()} · next practice{' '}
        {daysUntilPractice === 0 ? 'today' : `in ${daysUntilPractice} day${daysUntilPractice === 1 ? '' : 's'}`}
      </p>
      {/* On screen because nothing here can prove a vault record was not
          swapped for an older one — the defences against that all need an
          anchor a browser profile cannot give us. A date the owner recognises
          is the honest substitute: it makes a rollback noticeable, which is
          the most this can offer (`decisions/0016`). */}
      <p
        className="-mt-3 text-center text-xs text-dusk/50"
        title="If this is older than the last change you remember making, this device may be holding an older copy of your vault."
      >
        Vault last changed {new Date(stored.updatedAt).toLocaleString()}
      </p>

      {/* Silent re-encryption would be the wrong kind of quiet: the vault on
          disk is not the file it was a minute ago, and anyone keeping backups
          should know a fresh one is worth taking. */}
      {resealed && (
        <p className="w-full rounded-lg border-2 border-sage/50 bg-sage/10 p-2 text-center text-sm text-dusk/80">
          This vault was re-encrypted with stronger settings as you unlocked it. Nothing inside
          changed — but an older backup file still uses the older ones.
        </p>
      )}

      <Panel className="w-full space-y-3">
        <h2 className="font-display text-lg text-dusk">Keep the phrase alive</h2>
        <p className="text-sm text-dusk/80">
          Every unlock is a rehearsal. Between unlocks, you can stroll the house and peek into the
          compartments — your words and images live safely inside the encrypted vault.
        </p>
        <Button onClick={() => setWalking(true)}>Walk the house</Button>
      </Panel>

      <Panel className="w-full space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-dusk">Passwords</h2>
          {formMode === 'hidden' && (
            <Button
              variant="secondary"
              className="!px-3 !py-1 !text-sm"
              onClick={() => {
                setEditingCred(undefined)
                setFormMode('add')
              }}
            >
              + Add
            </Button>
          )}
        </div>
        <p className="text-sm text-dusk/80">
          {isExtensionContext()
            ? 'To fill a login page, go to it and click the Where Was My Password button in the toolbar: the popup there types the password straight into the page, so it never touches the clipboard. Copy is the fallback — it is cleared 30 seconds after you come back to this tab, though your operating system may keep its own clipboard history.'
            : 'Copy puts a password on the clipboard and clears it 30 seconds after you return to this tab — your operating system may still keep a clipboard history of its own. Install the browser extension for autofill that skips the clipboard entirely.'}
        </p>
        <CredentialList
          credentials={data.entries}
          onEdit={(cred) => {
            setEditingCred(cred)
            setFormMode('edit')
          }}
          onDelete={(id) => void handleDeleteCredential(id)}
        />
      </Panel>

      {formMode === 'add' && (
        <CredentialForm
          onSave={(f) => void handleAddCredential(f)}
          onCancel={() => setFormMode('hidden')}
        />
      )}

      {formMode === 'edit' && editingCred && (
        <CredentialForm
          initial={editingCred}
          onSave={(f) => void handleEditCredential(f)}
          onCancel={() => {
            setFormMode('hidden')
            setEditingCred(undefined)
          }}
        />
      )}

      {saving && (
        <p className="text-sm text-dusk/60">Encrypting and saving...</p>
      )}

      {error && (
        <p className="w-full rounded-lg border-2 border-brick/60 bg-brick/10 p-3 text-sm font-semibold text-brick">
          {error}
        </p>
      )}

      <PopupSessionSetting />

      <Panel className="w-full space-y-3">
        <h2 className="font-display text-lg text-dusk">Housekeeping</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => downloadBackup(stored)}>
            Export encrypted backup
          </Button>
          <Button variant="secondary" onClick={onLock}>
            Lock now
          </Button>
          <Button variant="secondary" onClick={onChangePassphrase}>
            Change passphrase
          </Button>
        </div>
        {!confirmingDelete ? (
          <button
            type="button"
            className="text-sm text-brick underline underline-offset-2"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete vault & start over…
          </button>
        ) : (
          <div className="space-y-2 rounded-lg border-2 border-brick/60 bg-brick/10 p-3 text-sm">
            <p>
              This erases the vault from this browser permanently. Only a backup file (plus your
              passphrase) could bring it back. Sure?
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="!border-brick !text-brick"
                onClick={() => {
                  void deleteVault().then(onDeleted)
                }}
              >
                Yes, delete everything
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </Screen>
  )
}

/**
 * The toolbar popup's opt-in five-minute session, set out where there is room
 * to be honest about it (`decisions/0015`). The same switch is in the popup,
 * where it is met at the moment of typing the phrase for the fourth time; this
 * is where someone reviewing what their password manager does will look for it.
 *
 * The switch only ever governs the *popup's* own unlocks. This tab's key is
 * never parked anywhere: a memory-house session runs up to thirty minutes, and
 * lending it out would quietly turn "five minutes" into that.
 */
function PopupSessionSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    void popupSessionEnabled()
      .then(setEnabled)
      .catch(() => setEnabled(false))
    // The same setting has a switch in the popup, and a security setting
    // showing two different answers in two places is worse than not offering it
    // twice. Whichever one is used, both follow.
    return watchPopupSessionPreference(setEnabled)
  }, [])

  // Nothing to offer when there is no popup — the same bundle is also served as
  // a plain web page — and nothing to show until the setting has been read.
  if (!isExtensionContext() || enabled === null) return null

  const toggle = (on: boolean) => {
    // The switch follows the write rather than leading it, so a refused write
    // leaves the user looking at what is actually true.
    void setPopupSessionEnabled(on)
      .then(() => setEnabled(on))
      .catch(() => {})
  }

  return (
    <Panel className="w-full space-y-3">
      <h2 className="font-display text-lg text-dusk">The toolbar popup</h2>
      <p className="text-sm text-dusk/80">
        Normally the popup asks for your passphrase every time you open it, and the key it makes
        is gone a moment later — the browser destroys the popup as soon as you click away. Four
        logins in a morning means saying the phrase four times.
      </p>
      <label className="flex cursor-pointer items-start gap-2 text-sm text-dusk">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5 size-4 accent-amber-glow"
        />
        <span className="font-semibold">Let the popup stay unlocked for 5 minutes</span>
      </label>
      <p className="text-sm text-dusk/80">
        With this on, the popup keeps the key for five minutes after you unlock it — held in
        browser memory, never written to disk, and gone when the browser closes. The five minutes
        run from the unlock and are not extended by using it. The cost is real: until the time is
        up, anyone at this computer can fill your passwords without knowing the phrase. Turning
        this off ends any session already running, and so does <strong>Lock now</strong>.
      </p>
    </Panel>
  )
}
