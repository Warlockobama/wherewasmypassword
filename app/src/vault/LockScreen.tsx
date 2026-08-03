import { useEffect, useRef, useState } from 'react'
import { deriveKey } from '../crypto/kdf.ts'
import { decryptVault, fromBase64, WrongPassphraseError, type VaultData } from '../crypto/vault.ts'
import { parseBackup } from '../storage/backup.ts'
import {
  loadArchivedVault,
  loadVaultSettings,
  VaultSupersededError,
  type StoredVault,
} from '../storage/db.ts'
import type { RestoreGate } from '../storage/settings.ts'
import { isExtensionContext } from '../platform.ts'
import { clearPopupSession } from '../popup/session.ts'
import { upgradeNeeded, upgradeOnUnlock } from './seal.ts'
import {
  awaitingProof,
  NO_PROOFS,
  proveNextForRestore,
  requiredProofs,
  RestoreGateError,
  restoreVaultWithProof,
  type RestoreProofs,
} from './restore.ts'
import { undoRestoreWithPassphrase } from './undo.ts'
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
  // What this device asks for before a backup may replace the vault
  // (`decisions/0019`). Held only to decide what the confirmation panel shows —
  // the gate that is *enforced* is read again at the commit, inside
  // `restoreVaultWithProof`, so raising it in another tab applies immediately.
  // Null until read; the strictest answer stands in until then.
  const [gate, setGate] = useState<RestoreGate | null>(null)
  // The passphrase field on the restore panel, and what it has proven so far.
  const [restorePhrase, setRestorePhrase] = useState('')
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [proofs, setProofs] = useState<RestoreProofs>(NO_PROOFS)
  // The vault a restore replaced, if one is still set aside. Its presence is
  // the whole condition for offering the undo (`decisions/0016`).
  const [archived, setArchived] = useState<StoredVault | null>(null)
  const [confirmingUndo, setConfirmingUndo] = useState(false)
  // The undo is gated on the archived vault's own passphrase (`decisions/0018`),
  // so it carries its own field, its own wait and its own error — all three
  // belong beside the button being pressed rather than up at the unlock form.
  const [undoPhrase, setUndoPhrase] = useState('')
  const [undoBusy, setUndoBusy] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Shown while the vault is being brought forward, because on an old vault
  // that is a second Argon2id run and the wait roughly doubles. Silence there
  // reads as a hang.
  const [upgrading, setUpgrading] = useState(false)

  useEffect(() => {
    void loadArchivedVault()
      .then((v) => setArchived(v ?? null))
      .catch(() => setArchived(null))
    // Falls to the strictest gate if it cannot be read, which is what
    // `loadVaultSettings` already promises — the `catch` is belt and braces.
    void loadVaultSettings()
      .then((s) => setGate(s.restoreGate))
      .catch(() => setGate('both'))
  }, [])

  /**
   * True while this screen is on the page.
   *
   * The undo costs an Argon2id derive, so it is a second wide, and since
   * `decisions/0019` a restore costs one or two of them. An unlock started
   * alongside either can finish first and take this screen away. The write it
   * was running still lands on disk, and calling `onRestored` from there would
   * tell an app that is already *unlocked* that the live record is now a
   * different vault — leaving it holding one vault's key beside another
   * vault's header, which the next credential save would write out as a record
   * no passphrase can open. So the callback is not made after teardown: the
   * app keeps the record it unlocked, and its next save is refused by
   * `saveVault`'s salt check with "lock and unlock to continue", which is the
   * outcome that loses nothing.
   */
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const unlock = async () => {
    // Not while the undo or a restore is deriving: all three change the same
    // vault from the same screen, and whichever lost the race would be acting
    // on a record another has already replaced.
    if (!phrase.trim() || busy || undoBusy || restoreBusy) return
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
      if (!live.current) {
        // An undo swapped the vault out from under this unlock and took the
        // screen with it. The key opens a record that is no longer live.
        brought.rawKey.fill(0)
        return
      }
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
      const parsed = parseBackup(await file.text())
      // A new file is a new question: nothing proven about the last one carries
      // over, least of all a proof made against a different record.
      setProofs(NO_PROOFS)
      setRestorePhrase('')
      setRestoreError(null)
      setPendingRestore(parsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Put the staged file down, taking any typed phrase and proof with it. */
  const cancelRestore = () => {
    setPendingRestore(null)
    setProofs(NO_PROOFS)
    setRestorePhrase('')
    setRestoreError(null)
  }

  // What the gate wants, and what is still outstanding. There is always a live
  // vault on this screen — it is what `stored` is — so a replacement is always
  // what is being asked about. Until the preference has been read, the strictest
  // answer applies, so the panel never offers a button the commit would refuse.
  const required = requiredProofs(gate ?? 'both', true)
  const awaiting = awaitingProof(required, proofs)

  /**
   * Write the restore, with whatever the gate asked for in hand.
   *
   * `restoreVaultWithProof` reads the preference again and checks it against
   * the record it is actually displacing, inside the transaction — this side
   * decides nothing, it only reports what came back.
   */
  const commitRestore = async (proven: RestoreProofs) => {
    if (!pendingRestore) return
    try {
      // Setting aside and replacing in one transaction, so an undo in another
      // tab cannot land between them and have its result overwritten — see
      // `restoreVault`.
      await restoreVaultWithProof(pendingRestore, proven)
      // Whatever a popup is holding belongs to the vault that was just replaced.
      // Its salt no longer matches, so it would be refused anyway; not leaving
      // it parked for five minutes is cheaper than reasoning about that.
      await clearPopupSession().catch(() => {})
      // Read back rather than assuming `stored` is what was set aside: another
      // context may have saved or re-keyed the live vault since this screen
      // mounted, and the record the undo offers has to be the one on disk — it
      // is what the passphrase gate will be asked to match.
      // A read that fails hides the undo offer until this screen is next
      // mounted; the archive is on disk either way. Hiding an offer is the safe
      // direction to fail in — the alternative is offering to swap in a record
      // nothing just read.
      const nowAside = await loadArchivedVault().catch(() => undefined)
      const restored = pendingRestore
      setPendingRestore(null)
      setProofs(NO_PROOFS)
      setRestorePhrase('')
      setArchived(nowAside ?? null)
      // Not after teardown: see `live`. A restore now takes as long as two
      // derives, and an unlock that finished first has taken this screen away.
      if (live.current) onRestored(restored)
    } catch (err) {
      // Both records are exactly where they were, whichever of these it was.
      setProofs(NO_PROOFS)
      setRestorePhrase('')
      if (err instanceof RestoreGateError) {
        // The gate was raised somewhere else after this panel was drawn — the
        // commit reads the preference for itself, which is the whole point, and
        // this screen is the one holding a stale copy. Pick the new one up so
        // the panel asks for what is now wanted rather than repeating a button
        // that will be refused again.
        setGate((await loadVaultSettings().catch(() => ({ restoreGate: 'both' as const }))).restoreGate)
        setRestoreError('This device now asks for more before a backup may replace the vault.')
        return
      }
      setRestoreError(
        err instanceof VaultSupersededError
          ? 'The vault on this device was re-encrypted while you were typing, so nothing was replaced. Start again and it will ask for the new passphrase.'
          : `Could not restore: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * Answer whichever of the gate's questions is outstanding (`decisions/0019`).
   *
   * Which record that means, and the opportunistic try of one phrase against
   * both, live in `proveNextForRestore` rather than here — it is the part worth
   * testing against real Argon2id, and a handler is where tests do not reach.
   */
  const submitRestoreProof = async () => {
    if (!pendingRestore || !awaiting || !restorePhrase.trim()) return
    // Not alongside an unlock or an undo, for the reason none of the three run
    // alongside each other: they act on the same two records.
    if (restoreBusy || busy || undoBusy) return
    setRestoreBusy(true)
    setRestoreError(null)
    try {
      const next = await proveNextForRestore(
        restorePhrase,
        pendingRestore,
        stored,
        required,
        proofs,
      )
      setProofs(next)
      setRestorePhrase('')
      if (!awaitingProof(required, next)) await commitRestore(next)
    } catch (err) {
      setRestoreError(
        err instanceof WrongPassphraseError
          ? awaiting === 'incoming'
            ? 'That doesn’t open the backup file. Nothing has been changed.'
            : 'That doesn’t open the vault on this device. Nothing has been changed.'
          : `Could not check that: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setRestoreBusy(false)
    }
  }

  /**
   * Put back the vault this device had before the restore, for whoever can
   * prove they know its passphrase.
   *
   * The operation underneath is a swap, not a replacement: whatever is live now
   * goes into the slot the archive just left, so a press costs a second press
   * rather than a vault. What the phrase buys is not safety from loss — that is
   * `undoRestore`'s job — but the answer to *who*: without the gate a moment at
   * someone's keyboard is enough to change which vault their machine opens
   * (`decisions/0018`).
   *
   * It is the control on this screen that costs nothing but a press, and it was
   * for one release the only one that asked for anything. Restoring is the
   * other, and since `decisions/0019` it asks too — for the backup's phrase and
   * for this device's, unless the owner has said otherwise from inside an
   * unlocked vault.
   */
  const confirmUndo = async () => {
    // Not while an unlock or a restore is deriving, for the reason `unlock`
    // will not start while this one is: they are slow operations on the same
    // two records, and the loser acts on a record the winner has replaced.
    if (!archived || !undoPhrase.trim() || undoBusy || busy || restoreBusy) return
    setUndoBusy(true)
    setUndoError(null)
    try {
      const back = await undoRestoreWithPassphrase(undoPhrase, archived)
      if (!back) {
        // The archive slot no longer holds the record this screen proved: a
        // restore or an undo in another context changed it while the derive
        // was running. Nothing has been swapped, and saying so matters — a
        // panel that simply vanished after a second of waiting would leave the
        // user unable to tell whether it had done something.
        const stillAside = await loadArchivedVault().catch(() => undefined)
        setUndoPhrase('')
        setArchived(stillAside ?? null)
        const changed = 'The vault set aside changed while you were typing, so nothing was swapped.'
        if (stillAside) {
          setUndoError(`${changed} Check the date above before trying again.`)
        } else {
          // The offer is about to disappear with the panel, so the message has
          // to move somewhere that will still be on screen.
          setConfirmingUndo(false)
          setError(`${changed} There is nothing set aside now.`)
        }
        return
      }
      // The swap has happened on disk, and from here nothing may throw. An
      // error now would close the panel over a screen still showing the vault
      // that was replaced — the user would type the right phrase for what is
      // in front of them and be told it is wrong, which is the exact minute
      // `decisions/0018` exists to prevent. So both fallible calls are
      // best-effort, and `onRestored` always runs.
      await clearPopupSession().catch(() => {})
      // What is set aside now is the vault that was live a moment ago. Read it
      // back rather than assuming it is `stored`, which can be out of date.
      const nowAside = await loadArchivedVault().catch(() => undefined)
      setUndoPhrase('')
      setConfirmingUndo(false)
      setArchived(nowAside ?? null)
      // Not after teardown: see `live`. An unlock that finished first has taken
      // this screen away, and telling an unlocked app that the live record is
      // now a different vault is how it ends up holding one vault's key beside
      // another's header.
      if (live.current) onRestored(back)
    } catch (err) {
      setUndoError(
        err instanceof WrongPassphraseError
          ? 'That doesn’t open the vault set aside. Nothing has been changed.'
          : `Could not put it back: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setUndoBusy(false)
    }
  }

  /** Leave the undo alone, taking the typed phrase with it. */
  const cancelUndo = () => {
    setConfirmingUndo(false)
    setUndoPhrase('')
    setUndoError(null)
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
          <Button
            onClick={() => void unlock()}
            disabled={!phrase.trim() || busy || undoBusy || restoreBusy}
          >
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
          {/* One slot, and a restore takes it. Said here rather than only in the
              README, because this is the press that spends it: whatever is set
              aside now stops being recoverable the moment this goes through
              (`decisions/0016` chose the single slot; `0019` left it chosen). */}
          {archived && (
            <p>
              Something is already set aside — the vault replaced on{' '}
              <strong>{new Date(archived.updatedAt).toLocaleDateString()}</strong>. This device
              keeps one, so that copy goes and the vault open now takes its place.
            </p>
          )}
          {awaiting === 'incoming' && (
            <p>
              {required.live ? 'First, the' : 'The'} passphrase of <em>that backup file</em>.
              Opening it is what tells this screen you are its owner, rather than someone who
              found this machine locked with a file to hand.
            </p>
          )}
          {awaiting === 'live' && (
            <p>
              That opens the backup. Now the passphrase of <em>the vault on this device</em> — the
              one about to be pushed aside. This half is what says the vault being replaced is
              yours to replace. If you no longer have it, this browser will not restore over that
              vault: unlock it and change the <strong>Restoring a backup</strong> setting there,
              or clear {isExtensionContext() ? 'this extension’s data' : 'this site’s data'} to
              erase a vault you could not open anyway.
            </p>
          )}
          {/* The one state where the absence of a passphrase field is itself
              worth saying. Turning the gate off is a deliberate choice made
              from inside an unlocked vault, and it outlives the vault it was
              made for — so the screen it affects says so rather than letting a
              missing field pass for "nothing to ask". */}
          {!awaiting && gate === 'off' && (
            <p>
              This device is set to replace the vault without asking for anything first — anyone
              here with a backup file can do this. The setting is <strong>Restoring a backup</strong>{' '}
              in the unlocked app.
            </p>
          )}
          {awaiting ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                void submitRestoreProof()
              }}
            >
              <input
                autoFocus
                type="password"
                value={restorePhrase}
                onChange={(e) => setRestorePhrase(e.target.value)}
                placeholder={
                  awaiting === 'incoming'
                    ? 'the backup file’s passphrase…'
                    : 'this device’s passphrase…'
                }
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="w-full rounded-lg border-2 border-dusk/40 bg-parchment px-3 py-2 text-center font-display text-lg tracking-wide focus:border-amber-glow focus:outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  className="!border-brick !bg-brick"
                  onClick={() => void submitRestoreProof()}
                  disabled={!restorePhrase.trim() || restoreBusy || busy || undoBusy}
                >
                  {restoreBusy ? 'Deriving key…' : 'Replace my vault'}
                </Button>
                <Button variant="secondary" onClick={cancelRestore} disabled={restoreBusy}>
                  Keep the current vault
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                className="!border-brick !bg-brick"
                // No derive on this path, so nothing else sets the flag — and
                // without it a second click starts a second restore, which
                // would push the vault this one just installed into the slot.
                onClick={() => {
                  setRestoreBusy(true)
                  void commitRestore(proofs).finally(() => setRestoreBusy(false))
                }}
                disabled={restoreBusy || busy || undoBusy}
              >
                Replace my vault
              </Button>
              <Button variant="secondary" onClick={cancelRestore} disabled={restoreBusy}>
                Keep the current vault
              </Button>
            </div>
          )}
          {restoreBusy && (
            <div className="flex items-center justify-center gap-2">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-dusk/20 border-t-amber-glow" />
              <span className="text-dusk/70">Stretching passphrase (Argon2id)…</span>
            </div>
          )}
          {restoreError && <p className="font-semibold text-brick">{restoreError}</p>}
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
            This device keeps one vault aside, and this swaps it with the one in use. The vault
            set aside — last changed{' '}
            <strong>{new Date(archived.updatedAt).toLocaleString()}</strong> — becomes the vault
            this device opens. The one open now, last changed{' '}
            <strong>{new Date(stored.updatedAt).toLocaleString()}</strong>, takes its place aside.
            Nothing is thrown away: if this is the wrong way round, swap back.
          </p>
          <p>
            Type the passphrase <em>that</em> vault used. It is the only way this screen can tell
            you from someone who happened to find your machine locked, and it is the phrase you
            will need to open it in a moment anyway.
          </p>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void confirmUndo()
            }}
          >
            <input
              autoFocus
              type="password"
              value={undoPhrase}
              onChange={(e) => setUndoPhrase(e.target.value)}
              placeholder="the passphrase of the vault set aside…"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-lg border-2 border-dusk/40 bg-parchment px-3 py-2 text-center font-display text-lg tracking-wide focus:border-amber-glow focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                className="!border-brick !bg-brick"
                onClick={() => void confirmUndo()}
                disabled={!undoPhrase.trim() || undoBusy || busy || restoreBusy}
              >
                {undoBusy ? 'Deriving key…' : 'Put the previous vault back'}
              </Button>
              <Button variant="secondary" onClick={cancelUndo} disabled={undoBusy}>
                Keep the restored one
              </Button>
            </div>
          </form>
          {undoBusy && (
            <div className="flex items-center justify-center gap-2">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-dusk/20 border-t-amber-glow" />
              <span className="text-dusk/70">Stretching passphrase (Argon2id)…</span>
            </div>
          )}
          {undoError && <p className="font-semibold text-brick">{undoError}</p>}
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
