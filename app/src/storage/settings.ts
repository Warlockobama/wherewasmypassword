/**
 * Preferences that have to be readable while the vault is still locked.
 *
 * There is exactly one so far — how much the lock screen asks for before a
 * backup file may replace the vault on this device (`decisions/0019`) — and
 * where it lives is most of what is interesting here.
 *
 * Not inside the vault: the screen that enforces it is the *locked* one, so a
 * setting sealed under the passphrase could not be read at the moment it
 * matters.
 *
 * Not in `chrome.storage.local`, where the popup-session opt-in lives. That
 * area does not exist when the same bundle is served as a plain web page (see
 * `platform.ts`), and the popup preference can honestly answer "off" there
 * because there is no popup either. This one governs a screen the hosted build
 * very much has, and a security gate that quietly evaporates in one of the two
 * builds is exactly the kind of overclaim `0019` exists to correct.
 *
 * So: the same IndexedDB database as the vault, in the `meta` store beside the
 * practice schedule. That store is named for the only thing it used to hold. A
 * store of its own would read better and would mean a schema version bump, and
 * an upgrade that another tab still on the old version can block is a hang at
 * load with nothing the new page can do about it — too high a price for a
 * tidier name.
 *
 * It is plaintext, and anyone who can write the browser profile directory can
 * rewrite it. That is not the attacker this defends against: the same person
 * can drop a whole vault record into place, which is `decisions/0016`'s subject
 * and not something a preference could ever answer. What this defends against
 * is a minute at a locked screen.
 */

/**
 * What must be proven before a restore replaces the live vault. Strictest
 * first, and deliberately a ladder rather than a set of independent switches:
 * every step down is strictly weaker than the one above it, which is what makes
 * "anything unreadable means the top of the list" a safe rule rather than a
 * guess.
 *
 * - `both` — the incoming backup's passphrase *and* the passphrase of the vault
 *   being replaced. The first says the file is one you can open; the second says
 *   you own what is about to be pushed aside. This is the default, and it is
 *   James's ruling on `0019`.
 * - `incoming` — the backup's passphrase only. Stops someone who found the
 *   machine locked and had a file with them; does not stop someone restoring
 *   *their own* vault over yours.
 * - `off` — what shipped before `0019`: bring a file, press the button.
 */
export type RestoreGate = 'both' | 'incoming' | 'off'

/** In strictness order, for the radio group and for validating what is read. */
export const RESTORE_GATES = ['both', 'incoming', 'off'] as const satisfies readonly RestoreGate[]

export interface VaultSettings {
  restoreGate: RestoreGate
}

export const DEFAULT_SETTINGS: VaultSettings = { restoreGate: 'both' }

/**
 * Read a settings record back, falling back to the strictest answer field by
 * field.
 *
 * Every way this can fail — nothing stored yet, a record written by a version
 * that did not have this field, a value edited to something meaningless —
 * resolves to the default rather than to "no gate". A validator that failed
 * open would let anyone who can scribble on the record turn the gate off by
 * writing rubbish into it, which is a cheaper attack than the one the gate is
 * for.
 */
export function asVaultSettings(value: unknown): VaultSettings {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS
  const gate = (value as Partial<VaultSettings>).restoreGate
  return {
    restoreGate: RESTORE_GATES.includes(gate as RestoreGate)
      ? (gate as RestoreGate)
      : DEFAULT_SETTINGS.restoreGate,
  }
}
