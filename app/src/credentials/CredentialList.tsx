import { useState } from 'react'
import { Button, Panel } from '../ui.tsx'
import { requestAutofill } from './autofill.ts'
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

  const handleAutofill = async () => {
    setStatus('Filling...')
    const result = await requestAutofill(cred.username, cred.password)
    if (result.ok && result.filled) {
      setStatus('Filled')
    } else if (result.reason === 'no-password-field') {
      setStatus('No login field found on page')
    } else if (result.reason === 'not-in-extension') {
      setStatus('Autofill requires the extension context')
    } else {
      setStatus('Could not reach page — try the clipboard fallback')
    }
    setTimeout(() => setStatus(null), 3000)
  }

  const handleCopy = async () => {
    try {
      await copyWithAutoClear(cred.password)
      setStatus('Copied (auto-clears in 30s)')
    } catch {
      setStatus('Copy failed')
    }
    setTimeout(() => setStatus(null), 3000)
  }

  return (
    <Panel className="w-full space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-dusk">{cred.label}</p>
          {cred.url && (
            <p className="truncate text-xs text-dusk/50">{cred.url}</p>
          )}
          {cred.username && (
            <p className="text-sm text-dusk/70">{cred.username}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="primary" className="!px-3 !py-1 !text-sm" onClick={handleAutofill}>
            Autofill
          </Button>
          <Button variant="secondary" className="!px-3 !py-1 !text-sm" onClick={handleCopy}>
            Copy
          </Button>
        </div>
      </div>

      {status && (
        <p className="text-xs text-dusk/70">{status}</p>
      )}

      <div className="flex gap-2 border-t border-dusk/10 pt-2">
        <button
          type="button"
          className="text-xs text-dusk/50 underline underline-offset-2 hover:text-dusk"
          onClick={() => onEdit(cred)}
        >
          Edit
        </button>
        {!confirming ? (
          <button
            type="button"
            className="text-xs text-brick/60 underline underline-offset-2 hover:text-brick"
            onClick={() => setConfirming(true)}
          >
            Delete
          </button>
        ) : (
          <>
            <button
              type="button"
              className="text-xs font-semibold text-brick underline underline-offset-2"
              onClick={() => onDelete(cred.id)}
            >
              Confirm delete
            </button>
            <button
              type="button"
              className="text-xs text-dusk/50 underline underline-offset-2"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </Panel>
  )
}
