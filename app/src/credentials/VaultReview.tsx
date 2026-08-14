import { useMemo } from 'react'
import { Button, Panel } from '../ui.tsx'
import { auditVault, type CredentialAudit, type Finding, type Verdict } from './audit.ts'
import type { Credential } from './types.ts'

/**
 * The weak-and-reused review (`decisions/0026`).
 *
 * All of the reasoning is in `audit.ts`; this file is the prose and the way out.
 * Two rules shape it:
 *
 * **No password is ever rendered.** `auditVault` hands back ids, lengths and
 * verdicts and nothing else, so nothing this component *draws* can contain a
 * password. Note what that does and does not buy: the plaintext `credentials`
 * and `masterWords` are still props on this component, because the Fix button
 * has to hand the real entry back to the edit form — so they remain visible to
 * React devtools exactly as they are on the list above. What is ruled out is a
 * password reaching the DOM, a screenshot, or the text of an error.
 *
 * **Every complaint ends in a button.** A list of problems with no way to act on
 * them is a nag; the Fix button opens the same edit form as the list above, with
 * the dice already sitting in the password field.
 */
export default function VaultReview({
  credentials,
  masterWords,
  onEdit,
}: {
  credentials: Credential[]
  masterWords: string[]
  onEdit: (cred: Credential) => void
}) {
  const audit = useMemo(() => auditVault(credentials, masterWords), [credentials, masterWords])

  // With nothing stored there is nothing to review, and an empty panel below an
  // empty list is just furniture.
  if (credentials.length === 0) return null

  const { counts, flagged } = audit

  return (
    <Panel className="w-full space-y-3">
      <h2 className="font-display text-lg text-dusk">Password review</h2>

      <p className="text-sm text-dusk/80">
        {counts.flagged === 0
          ? `Nothing to flag across ${counts.total} ${counts.total === 1 ? 'password' : 'passwords'}.`
          : `${counts.flagged} of ${counts.total} ${counts.total === 1 ? 'password' : 'passwords'} ${counts.flagged === 1 ? 'has' : 'have'} something worth fixing.`}
      </p>

      {flagged.length > 0 && (
        <ul className="space-y-2">
          {flagged.map((entry) => {
            // By position, never by id. Two entries can carry the same id — an
            // import is all it takes — and the audit is careful to treat them as
            // two entries; a lookup by id here would hand both Fix buttons the
            // same credential, and `editCredential` patches every entry with a
            // matching id, so one press would rewrite both passwords.
            const cred = credentials[entry.index]
            return (
              <li
                key={entry.index}
                className="rounded-lg border-2 border-dusk/20 bg-parchment/60 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-dusk">{entry.label}</p>
                    <VerdictTag verdict={entry.verdict} />
                  </div>
                  {cred && (
                    <Button
                      variant="secondary"
                      className="!shrink-0 !px-3 !py-1 !text-sm"
                      // Every row's button says "Fix", so by itself the name is
                      // useless to anyone reading the page through a screen
                      // reader or driving it by voice — N identical targets,
                      // and picking the wrong one opens the wrong password.
                      aria-label={`Fix ${entry.label}`}
                      onClick={() => onEdit(cred)}
                    >
                      Fix
                    </Button>
                  )}
                </div>
                <ul className="mt-2 space-y-1">
                  {entry.findings.map((finding) => (
                    <li key={finding.kind} className="text-sm text-dusk/80">
                      {explain(finding, entry)}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}

      {/* The limits go on the screen rather than in a doc nobody opens. An
          entry with no row above it has passed the checks this page can run,
          and the gap between that and "strong" is exactly what a review panel
          is tempted to paper over. */}
      {/* At `/60` this computed to 2.9:1 over the panel — the least legible text
          on a panel whose whole argument it carries (`decisions/0030`). `/80` is
          what the body copy above already uses, and it passes AA. */}
      <p className="text-xs text-dusk/80">
        This looks at length, at the mix of characters, at a few shapes that are
        guessed first, and at whether a password is used twice. It cannot tell you
        whether one has appeared in a breach or is simply a common choice — that
        needs either a network request or a bundled dictionary, and this extension
        makes no network requests at all. A password with nothing listed here has
        passed these checks, which is not the same as being strong.
      </p>
    </Panel>
  )
}

function VerdictTag({ verdict }: { verdict: Verdict }) {
  if (verdict === 'ok') return null
  // The tint and the border stay; only the words darken. Both of these were
  // under 4.5:1 on their own background (`decisions/0030`) — a severity label
  // nobody can read is the one piece of text on the row that has to carry.
  const style =
    verdict === 'critical'
      ? 'border-brick/60 bg-brick/10 text-brick-deep'
      : verdict === 'serious'
        ? 'border-amber-glow/60 bg-amber-glow/10 text-dusk'
        : 'border-dusk/30 bg-dusk/5 text-dusk'
  const word = verdict === 'critical' ? 'Fix this first' : verdict === 'serious' ? 'Worth changing' : 'Minor'
  return (
    <span className={`mt-0.5 inline-block rounded border px-1.5 py-0.5 text-xs font-semibold ${style}`}>
      {word}
    </span>
  )
}

/**
 * One sentence per finding, written to say what goes wrong rather than to
 * score the password. "Reused" without "one breach opens both" is a label; with
 * it, it is a reason.
 */
function explain(finding: Finding, entry: CredentialAudit): string {
  switch (finding.kind) {
    case 'master-phrase':
      return 'This is your master passphrase. If this site is ever breached, whoever reads the leak can open the vault itself — the house, the words, and every other password in here. Change it on the site, not here.'
    case 'reused': {
      const named = finding.sharedWith ?? []
      const total = finding.sharedTotal ?? named.length
      // Past the handful `audit.ts` keeps names for, the count is both shorter
      // to read and the more alarming fact.
      const unnamed = total - named.length
      const parts = unnamed > 0 ? [...named, `${unnamed} other${unnamed === 1 ? '' : 's'}`] : named
      const list =
        parts.length === 1
          ? parts[0]
          : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
      return `The same password is on ${list}. Whichever site loses it first loses the others with it.`
    }
    case 'short':
      return entry.length === 0
        ? 'There is no password saved on this entry at all.'
        : `${entry.length} characters. Below about twelve, the mix of characters stops making much difference to how long a guess takes.`
    case 'single-class':
      return 'Only one kind of character. At this length, adding another kind still buys something.'
    case 'predictable-shape':
      return `A word with a capital in front and a digit or two behind is the first pattern anything guessing tries. Counting its character classes gives ${entry.ceilingBits} bits, and it does not get anywhere near that.`
    case 'sequence':
      return 'This password is a run of consecutive characters, give or take a digit or symbol on the end.'
    case 'repeat':
      return 'This password is one short run of characters repeated, give or take a digit or symbol on the end. Repeating it makes it longer without making it harder to guess.'
  }
}
