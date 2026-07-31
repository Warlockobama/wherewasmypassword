import { useState } from 'react'
import { Button, Panel } from '../ui.tsx'
import { copyWithAutoClear } from './clipboard.ts'
import type { Credential } from './types.ts'

export default function CredentialList({
  credentials,
  onEdit,
  onDelete,
}: {
  credentials: Credential[]
  onEdit: (cred: Credential) => void
  onDelete: (id: string) => void
}) {
  if (credentials.length === 0) {
    return (
      <p className="text-sm text-dusk/60">
        No credentials stored yet. Add one to get started.
      </p>
    )
  }

  return (
    <div className="w-full space-y-2">
      {credentials.map((cred) => (
        <CredentialRow key={cred.id} cred={cred} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  )
}

const ROW_ACTION =
  'touch-manipulation py-2 text-xs text-dusk/60 underline underline-offset-2 hover:text-dusk active:text-dusk'

function CredentialRow({
  cred,
  onEdit,
  onDelete,
}: {
  cred: Credential
  onEdit: (cred: Credential) => void
  onDelete: (id: string) => void
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const handleCopy = async () => {
    try {
      await copyWithAutoClear(cred.password)
      // Deliberately not "auto-clears in 30s": the clear needs this tab to be
      // focused, so if the user is away it happens when they come back. Say
      // what actually happens rather than promising a stopwatch.
      setStatus('Copied — cleared 30s after you return here')
    } catch {
      setStatus('Copy failed')
    }
    setTimeout(() => setStatus(null), 3000)
  }

  return (
    <Panel className="w-full space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* All three truncate: on a phone this column is ~120px wide and an
              email address or long label would otherwise push the row wider. */}
          <p className="truncate font-semibold text-dusk">{cred.label}</p>
          {cred.url && (
            <p className="truncate text-xs text-dusk/50">{cred.url}</p>
          )}
          {cred.username && (
            <p className="truncate text-sm text-dusk/70">{cred.username}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {/* No Autofill button here on purpose. This tab is the active tab
              whenever it is on screen, so a fill from here has nowhere to go —
              it is the toolbar popup, opened while the login page is in front
              of you, that can reach the page. Copy is the fallback. */}
          <Button variant="primary" className="!px-3 !py-1 !text-sm" onClick={handleCopy}>
            Copy
          </Button>
        </div>
      </div>

      {status && (
        <p className="text-xs text-dusk/70">{status}</p>
      )}

      {/* Row actions are padded to a usable tap height, and Delete sits at the
          far end so a mistap can't land on Confirm delete. */}
      <div className="flex items-center gap-4 border-t border-dusk/10 pt-1">
        <button
          type="button"
          className={ROW_ACTION}
          onClick={() => onEdit(cred)}
        >
          Edit
        </button>
        {!confirming ? (
          <button
            type="button"
            className={`${ROW_ACTION} ml-auto text-brick/70 hover:text-brick active:text-brick`}
            onClick={() => setConfirming(true)}
          >
            Delete
          </button>
        ) : (
          <>
            <button
              type="button"
              className={`${ROW_ACTION} ml-auto`}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${ROW_ACTION} font-semibold text-brick`}
              onClick={() => onDelete(cred.id)}
            >
              Confirm delete
            </button>
          </>
        )}
      </div>
    </Panel>
  )
}
