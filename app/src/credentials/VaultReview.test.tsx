// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import VaultReview from './VaultReview.tsx'
import type { Credential } from './types.ts'

/**
 * The review panel, driven through the screen (`decisions/0026`).
 *
 * `audit.test.ts` already proves which findings fire. What only a rendered
 * screen can prove is the part that matters if this feature goes wrong: that
 * no password reaches the DOM, that the way out of every complaint is wired to
 * the edit form, and that the panel says out loud what it cannot see rather
 * than letting a clean result imply more than it means.
 */

afterEach(cleanup)

const MASTER = ['correct', 'horse', 'battery', 'staple', 'ribbon', 'anchor']

function cred(partial: Partial<Credential> & { label: string; password: string }): Credential {
  return {
    id: partial.label,
    url: '',
    username: '',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

const renderReview = (credentials: Credential[], onEdit = vi.fn()) => {
  render(<VaultReview credentials={credentials} masterWords={MASTER} onEdit={onEdit} />)
  return onEdit
}

describe('VaultReview', () => {
  it('renders nothing at all for an empty vault', () => {
    const { container } = render(
      <VaultReview credentials={[]} masterWords={MASTER} onEdit={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('says everything passed without claiming the passwords are strong', () => {
    renderReview([cred({ label: 'Bank', password: 'Kq7!vRt2Ls9#xB' })])
    expect(screen.getByText(/Nothing to flag across 1 password\./)).toBeTruthy()
    // The caveat is not conditional on there being findings — a clean panel is
    // exactly where "passed these checks" could be misread as "strong".
    expect(screen.getByText(/is not the same as being strong/)).toBeTruthy()
    expect(screen.getByText(/makes no network requests at all/)).toBeTruthy()
  })

  it('counts flagged entries against the total', () => {
    renderReview([
      cred({ label: 'Bank', password: 'Kq7!vRt2Ls9#xB' }),
      cred({ label: 'Forum', password: '123456' }),
      cred({ label: 'Shop', password: 'monkey1' }),
    ])
    expect(screen.getByText('2 of 3 passwords have something worth fixing.')).toBeTruthy()
  })

  it('names the other entries a password is shared with', () => {
    renderReview([
      cred({ label: 'Bank', password: 'Shared-Password-9127' }),
      cred({ label: 'Router', password: 'Shared-Password-9127' }),
      cred({ label: 'Shop', password: 'Shared-Password-9127' }),
    ])
    // The advice is useless without saying where else to look, and the labels
    // are already on screen in the list above.
    expect(screen.getByText(/The same password is on Router and Shop\./)).toBeTruthy()
    expect(screen.getByText(/The same password is on Bank and Shop\./)).toBeTruthy()
  })

  it('counts the rest once a password is on more entries than a sentence can name', () => {
    // `auditVault` stops collecting labels after a handful, so the panel has to
    // say how many it is not naming. Reading out forty labels would be useless
    // anyway — the number is the alarming part.
    renderReview(
      Array.from({ length: 12 }, (_, i) => cred({ label: `Site ${i}`, password: 'one-for-all-9127' })),
    )
    expect(screen.getAllByText(/and 7 others\./).length).toBeGreaterThan(0)
    // Still the plain list when every one of them fits.
    cleanup()
    renderReview([
      cred({ label: 'Bank', password: 'p-9127-p' }),
      cred({ label: 'Router', password: 'p-9127-p' }),
    ])
    expect(screen.getByText(/The same password is on Router\./)).toBeTruthy()
  })

  it('puts the master passphrase at the top and says what it costs', () => {
    // Both of these are critical, and 'Forum' sorts before 'Webmail'. Severity
    // alone would therefore lead with the forum — but one of these loses one
    // account and the other loses every account and the house with it, so the
    // kind of finding has to outrank the label.
    renderReview([
      cred({ label: 'Forum', password: '123456' }),
      cred({ label: 'Webmail', password: MASTER.join(' ') }),
    ])
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(rows[0]).toContain('Webmail')
    expect(screen.getByText(/can open the vault itself/)).toBeTruthy()
  })

  it('never puts a password in the DOM', () => {
    // The whole reason `auditVault` returns ids and lengths rather than the
    // strings it was given.
    const { container } = render(
      <VaultReview
        credentials={[
          cred({ label: 'Bank', password: 'Shared-Password-9127' }),
          cred({ label: 'Router', password: 'Shared-Password-9127' }),
          cred({ label: 'Webmail', password: MASTER.join(' ') }),
        ]}
        masterWords={MASTER}
        onEdit={vi.fn()}
      />,
    )
    const html = container.innerHTML
    expect(html).not.toContain('Shared-Password-9127')
    for (const word of MASTER) expect(html).not.toContain(word)
  })

  it('hands the real credential back when Fix is pressed', () => {
    const forum = cred({ label: 'Forum', password: '123456' })
    const onEdit = renderReview([cred({ label: 'Bank', password: 'Kq7!vRt2Ls9#xB' }), forum])
    fireEvent.click(screen.getByRole('button', { name: 'Fix Forum' }))
    // The same object the list passes to the edit form, so Fix and Edit open
    // the identical screen.
    expect(onEdit).toHaveBeenCalledWith(forum)
  })

  it('gives every Fix button an accessible name of its own', () => {
    // On screen they all read "Fix", which is right beside the label. To anyone
    // navigating by button — a screen reader's list, or voice control saying
    // "click Fix" — identical names mean N indistinguishable targets, and the
    // cost of picking the wrong one is editing the wrong password.
    renderReview([
      cred({ label: 'Bank', password: 'Kq7!vRt2Ls9#xB' }),
      cred({ label: 'Forum', password: '123456' }),
      cred({ label: 'Shop', password: 'monkey1' }),
    ])
    expect(screen.getByRole('button', { name: 'Fix Forum' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fix Shop' })).toBeTruthy()
    // And none for the entry with nothing to fix.
    expect(screen.queryByRole('button', { name: 'Fix Bank' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Fix / })).toHaveLength(2)
  })

  it('opens the right entry when two credentials share an id', () => {
    // An import can hand two entries the same id; `auditVault` treats them as
    // two entries on purpose. Looking the credential back up by id would give
    // both rows the last of the pair — and `editCredential` patches every entry
    // with that id, so one Fix would rewrite both passwords.
    const bank = cred({ label: 'Bank', password: 'shared-9127-shared', id: 'dup' })
    const router = cred({ label: 'Router', password: 'shared-9127-shared', id: 'dup' })
    const onEdit = renderReview([bank, router])
    fireEvent.click(screen.getByRole('button', { name: 'Fix Bank' }))
    expect(onEdit).toHaveBeenCalledWith(bank)
  })

  it('reports several findings on one entry rather than only the worst', () => {
    // 'monkey1' is both too short and the classic decorated-word shape. Showing
    // one and hiding the other would have the user fix the length and think
    // they were done.
    renderReview([cred({ label: 'Shop', password: 'monkey1' })])
    expect(screen.getByText(/7 characters\./)).toBeTruthy()
    expect(screen.getByText(/the first pattern anything guessing tries/)).toBeTruthy()
  })

  it('says an entry with no password at all is empty rather than short', () => {
    renderReview([cred({ label: 'Legacy', password: '' })])
    expect(screen.getByText(/no password saved on this entry at all/)).toBeTruthy()
  })
})
