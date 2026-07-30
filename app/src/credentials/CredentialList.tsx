import { useState } from 'react'
import { Button, Panel } from '../ui.tsx'
import { isExtensionContext } from '../platform.ts'
import { requestAutofill } from './autofill.ts'
import { credentialOrigin } from './match-url.ts'
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
  // `expected` is null when the credential has no stored site at all, which
  // needs different words from a genuine mismatch.
  const [mismatch, setMismatch] = useState<{ page: string; expected: string | null } | null>(null)
  const canAutofill = isExtensionContext()

  const handleAutofill = async (overrideOrigin?: string) => {
    setStatus('Filling...')
    setMismatch(null)
    const result = await requestAutofill({
      username: cred.username,
      password: cred.password,
      expectedOrigin: credentialOrigin(cred.url),
      overrideOrigin,
    })
    if (result.ok && result.filled) {
      setStatus('Filled')
    } else if (result.reason === 'origin-mismatch' || result.reason === 'no-stored-origin') {
      // Never fill silently across origins: this is exactly what a look-alike
      // phishing page is counting on. A credential with no stored site gets
      // the same treatment rather than a free pass.
      setStatus(null)
      setMismatch({
        page: result.pageOrigin ?? 'this page',
        expected: result.reason === 'origin-mismatch' ? (result.expectedOrigin ?? 'the stored site') : null,
      })
      return
    } else if (result.reason === 'no-password-field') {
      setStatus('No login field found on page')
    } else if (result.reason === 'no-page-tab') {
      // Today this is the normal outcome: the extension's own tab is the
      // active one whenever this button is clicked. See decisions/0009.
      setStatus('Could not reach the login page — use Copy for now')
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
          {/* Autofill needs the extension APIs; on mobile/PWA it can't work,
              so copy-with-auto-clear becomes the primary action instead. */}
          {canAutofill && (
            <Button variant="primary" className="!px-3 !py-1 !text-sm" onClick={() => void handleAutofill()}>
              Autofill
            </Button>
          )}
          <Button
            variant={canAutofill ? 'secondary' : 'primary'}
            className="!px-3 !py-1 !text-sm"
            onClick={handleCopy}
          >
            Copy
          </Button>
        </div>
      </div>

      {status && (
        <p className="text-xs text-dusk/70">{status}</p>
      )}

      {mismatch && (
        <div className="space-y-2 rounded-lg border-2 border-brick/60 bg-brick/10 p-2 text-xs">
          {mismatch.expected ? (
            <p>
              This page is <strong className="break-all">{mismatch.page}</strong>, but this password
              is for <strong className="break-all">{mismatch.expected}</strong>. If you did not
              expect that, the page may be impersonating the real site.
            </p>
          ) : (
            <p>
              This password has no site saved against it, so there is nothing to check{' '}
              <strong className="break-all">{mismatch.page}</strong> against. Fill it only if this is
              the page you meant — adding the address to the entry lets it be checked next time.
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              className={`${ROW_ACTION} font-semibold text-brick`}
              onClick={() => void handleAutofill(mismatch.page)}
            >
              Fill anyway
            </button>
            <button type="button" className={ROW_ACTION} onClick={() => setMismatch(null)}>
              Cancel
            </button>
          </div>
        </div>
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
