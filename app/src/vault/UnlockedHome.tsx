import { useState } from 'react'
import Palace from '../palace/Palace.tsx'
import type { VaultData } from '../crypto/vault.ts'
import { ClueCard, EmptySlot } from '../palace/rooms/shared.tsx'
import { LOCI } from '../palace/loci.ts'
import { downloadBackup } from '../storage/backup.ts'
import { deleteVault, type StoredVault } from '../storage/db.ts'
import { Button, Panel, Screen, Title } from '../ui.tsx'

export default function UnlockedHome({
  data,
  stored,
  daysUntilPractice,
  onLock,
  onDeleted,
}: {
  data: VaultData
  stored: StoredVault
  daysUntilPractice: number
  onLock: () => void
  onDeleted: () => void
}) {
  const [walking, setWalking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [step, setStep] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

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
        <h2 className="font-display text-lg text-dusk">Passwords</h2>
        <p className="text-sm text-dusk/80">
          Site credentials are coming in v2 — random per-site passwords stored under this same
          encryption, so this phrase stays the only one you ever memorize.
        </p>
      </Panel>

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
