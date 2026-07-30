import { useState } from 'react'
import { Button, Panel } from '../ui.tsx'
import { generateSitePassword } from './generate-password.ts'
import type { Credential } from './types.ts'

export default function CredentialForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Credential
  onSave: (fields: { label: string; url: string; username: string; password: string; notes: string }) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState(initial?.password ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [showPassword, setShowPassword] = useState(false)

  const valid = label.trim() !== '' && password !== ''

  return (
    <Panel className="w-full space-y-3">
      <h3 className="font-display text-lg text-dusk">
        {initial ? 'Edit credential' : 'Add credential'}
      </h3>

      <label className="block text-sm text-dusk/80">
        Label
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. GitHub"
          className="mt-1 block w-full rounded border border-dusk/30 bg-parchment px-3 py-1.5 text-dusk focus:border-amber-glow focus:outline-none"
        />
      </label>

      <label className="block text-sm text-dusk/80">
        Site URL
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com"
          className="mt-1 block w-full rounded border border-dusk/30 bg-parchment px-3 py-1.5 text-dusk focus:border-amber-glow focus:outline-none"
        />
      </label>

      <label className="block text-sm text-dusk/80">
        Username / email
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="you@example.com"
          className="mt-1 block w-full rounded border border-dusk/30 bg-parchment px-3 py-1.5 text-dusk focus:border-amber-glow focus:outline-none"
        />
      </label>

      <label className="block text-sm text-dusk/80">
        Password
        <div className="relative mt-1">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="block w-full rounded border border-dusk/30 bg-parchment px-3 py-1.5 pr-20 text-dusk focus:border-amber-glow focus:outline-none"
          />
          <button
            type="button"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-10 top-1/2 -translate-y-1/2 text-xs text-dusk/60 hover:text-dusk"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? 'hide' : 'show'}
          </button>
          <button
            type="button"
            title="Generate random password"
            aria-label="Generate random password"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-dusk/60 hover:text-dusk"
            onClick={() => setPassword(generateSitePassword(20))}
          >
            &#x2684;
          </button>
        </div>
      </label>

      <label className="block text-sm text-dusk/80">
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1 block w-full rounded border border-dusk/30 bg-parchment px-3 py-1.5 text-dusk focus:border-amber-glow focus:outline-none"
        />
      </label>

      <div className="flex gap-2 pt-1">
        <Button disabled={!valid} onClick={() => onSave({ label, url, username, password, notes })}>
          {initial ? 'Save changes' : 'Add'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Panel>
  )
}
