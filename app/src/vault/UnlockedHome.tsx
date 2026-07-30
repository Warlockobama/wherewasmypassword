import { useState } from 'react'
import Palace from '../palace/Palace.tsx'
import type { VaultData } from '../crypto/vault.ts'
import { ClueCard, EmptySlot } from '../palace/rooms/shared.tsx'
import { LOCI } from '../palace/loci.ts'
import { downloadBackup } from '../storage/backup.ts'
import { deleteVault, type StoredVault } from '../storage/db.ts'
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

export default function UnlockedHome({
  data,
  stored,
  rawKey,
  daysUntilPractice,
  onLock,
  onDeleted,
  onVaultChanged,
}: {
  data: VaultData
  stored: StoredVault
  rawKey: Uint8Array
  daysUntilPractice: number
  onLock: () => void
  onDeleted: () => void
  onVaultChanged: (data: VaultData, stored: StoredVault) => void
}) {
  const [walking, setWalking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [step, setStep] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

  // Credential management state
  const [formMode, setFormMode] = useState<'hidden' | 'add' | 'edit'>('hidden')
  const [editingCred, setEditingCred] = useState<Credential | undefined>(undefined)
  const [saving, setSaving] = useState(false)

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

  const handleAddCredential = async (fields: {
    label: string; url: string; username: string; password: string; notes: string
  }) => {
    setSaving(true)
    try {
      const [nextData, nextStored] = await addCredential(rawKey, data, stored, fields)
      onVaultChanged(nextData, nextStored)
      setFormMode('hidden')
    } finally {
      setSaving(false)
    }
  }

  const handleEditCredential = async (fields: {
    label: string; url: string; username: string; password: string; notes: string
  }) => {
    if (!editingCred) return
    setSaving(true)
    try {
      const [nextData, nextStored] = await editCredential(rawKey, data, stored, {
        id: editingCred.id,
        ...fields,
      })
      onVaultChanged(nextData, nextStored)
      setFormMode('hidden')
      setEditingCred(undefined)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteCredential = async (id: string) => {
    const [nextData, nextStored] = await deleteCredential(rawKey, data, stored, id)
    onVaultChanged(nextData, nextStored)
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
            ? 'Autofill types a password straight into the login page, so it never touches the clipboard. Copy is the fallback: it is cleared 30 seconds after you come back to this tab, though your operating system may keep its own clipboard history.'
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

      <Panel className="w-full space-y-3">
        <h2 className="font-display text-lg text-dusk">Housekeeping</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => downloadBackup(stored)}>
            Export encrypted backup
          </Button>
          <Button variant="secondary" onClick={onLock}>
            Lock now
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
