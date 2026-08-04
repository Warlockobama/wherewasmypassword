import { DEFAULT_KDF_PARAMS, deriveKey, kdfParamsAreOutdated } from '../crypto/kdf.ts'
import { randomBytes } from '../crypto/random.ts'
import {
  VAULT_FORMAT_VERSION,
  encryptVault,
  toBase64,
  type VaultData,
} from '../crypto/vault.ts'
import { saveVault, type StoredVault, type VaultPrecondition } from '../storage/db.ts'

/**
 * The one place a vault record is written.
 *
 * Every write goes through here so that no path can leave a vault on an old
 * format: `version` is always stamped to the current one, and the header the
 * ciphertext is bound to is always the header that gets stored beside it. The
 * two travelling together is what makes the binding in `decisions/0014` hold.
 *
 * `expecting` is optional here and required on `rekeyVault`, which is a real
 * gap rather than an oversight worth writing down: `sealVault(key, data,
 * header)` and `saveVault(record)` both still compile into an unconditional
 * write. What `rekeyVault` closes is the re-key door, where every caller
 * derives a fresh salt and so cannot be caught by the check below. A caller
 * that keeps its key has the record in hand and no reason not to pass it; that
 * is convention, not a compiler's promise.
 */
export async function sealVault(
  rawKey: Uint8Array,
  data: VaultData,
  header: {
    salt: string
    kdfParams: StoredVault['kdfParams']
    createdAt: number
    /**
     * When the vault's *contents* last changed, if this write is not itself a
     * change to them. Housekeeping — the KDF upgrade an unlock performs — passes
     * the existing value so the stamp keeps meaning what the unlocked screen
     * says it means (`decisions/0016`). Defaults to now, which is right for
     * every write the user actually made.
     */
    updatedAt?: number
  },
  /**
   * The record this update was built from. Supplied by writes that mean to keep
   * the existing key, so that a stale context cannot overwrite a vault whose
   * key has changed under it; omitted by the writes that are themselves
   * changing the key. `'no-vault'` is onboarding's — see `saveVault`.
   */
  expecting?: VaultPrecondition,
): Promise<StoredVault> {
  const blob = await encryptVault(rawKey, data, {
    salt: header.salt,
    kdfParams: header.kdfParams,
  })
  const next: StoredVault = {
    version: VAULT_FORMAT_VERSION,
    salt: header.salt,
    kdfParams: header.kdfParams,
    iv: toBase64(blob.iv),
    ciphertext: toBase64(blob.ciphertext),
    createdAt: header.createdAt,
    updatedAt: header.updatedAt ?? Date.now(),
  }
  await saveVault(next, expecting)
  return next
}

/**
 * Derive a fresh key — new salt, current KDF parameters — and seal the vault
 * under it.
 *
 * This is deliberately the single code path behind three things that look
 * different in the UI and are identical underneath: creating a vault, changing
 * the master passphrase (`decisions/0012`), and raising an old vault's key-
 * derivation settings (`decisions/0013`). The salt is always new, so even
 * re-keying to the *same* passphrase produces an unrelated key.
 *
 * Which is also why `purpose` is not optional. Those three share everything
 * except what they are allowed to land on, and until `decisions/0020` none of
 * them said: every re-key was an unconditional write over whatever was in the
 * slot.
 */
export async function rekeyVault(
  passphrase: string,
  data: VaultData,
  createdAt: number,
  /**
   * What this re-key is allowed to land on.
   *
   * `'create'` seals the first vault on a device and is refused with
   * `VaultAlreadyExistsError` if one is already there (`decisions/0020`).
   * `{ replacing }` is a passphrase change or a KDF upgrade, and names the
   * record it means to write over — refused with `VaultSupersededError` if the
   * vault on disk is no longer that one.
   *
   * Both callers of the second form judge the vault from a copy they read
   * earlier: `ChangePassphrase` from the record open on screen, `upgradeOnUnlock`
   * from the record the lock screen loaded at mount. A second tab can delete
   * that vault and create or restore another inside either window, and an
   * unconditional write then destroys a vault nobody meant to touch, with no
   * archive and nothing to offer back. That is the same harm `0020` is about;
   * the adversarial review found it one screen over.
   *
   * Required, with no default, for the reason `restoreVault`'s `authorize` is:
   * a re-key written as `rekeyVault(phrase, data, now)` would otherwise compile
   * straight into the unconditional overwrite this argument exists to prevent,
   * and the paragraphs above would be a rule nothing enforces.
   */
  purpose: 'create' | { replacing: StoredVault },
  /** See `sealVault`. Passed only by the automatic KDF upgrade. */
  updatedAt?: number,
): Promise<{ rawKey: Uint8Array; stored: StoredVault }> {
  const salt = randomBytes(16)
  const rawKey = await deriveKey(passphrase, salt, DEFAULT_KDF_PARAMS)
  let stored: StoredVault
  try {
    stored = await sealVault(
      rawKey,
      data,
      {
        salt: toBase64(salt),
        kdfParams: DEFAULT_KDF_PARAMS,
        createdAt,
        updatedAt,
      },
      purpose === 'create' ? 'no-vault' : purpose.replacing,
    )
  } catch (err) {
    // A key nobody will ever get back: the record it belongs to was not
    // written, and the caller gets the error instead of this. Refusals are now
    // an ordinary outcome of the create path, so leaving a live vault key in
    // the heap of a screen the user is about to walk away from is not.
    rawKey.fill(0)
    throw err
  }
  return { rawKey, stored }
}

/** What, if anything, an existing vault should be brought forward to. */
export type UpgradeKind = 'none' | 'format' | 'rekey'

/**
 * Whether an unlocked vault is behind, and how far.
 *
 * `rekey` means the stored KDF parameters are weaker than today's defaults, so
 * the key itself has to be derived again — which needs the passphrase, and is
 * therefore only possible at the moment of unlock. `format` means the key is
 * fine and only the record needs rewriting, which costs nothing but a save.
 */
export function upgradeNeeded(stored: StoredVault): UpgradeKind {
  if (kdfParamsAreOutdated(stored.kdfParams)) return 'rekey'
  if (stored.version < VAULT_FORMAT_VERSION) return 'format'
  return 'none'
}

/**
 * Bring a just-unlocked vault forward, returning the key and record to carry on
 * with. Both arguments are the ones the unlock produced.
 *
 * Failure is deliberately not fatal: a vault that could not be upgraded is
 * still a vault the user just opened correctly, and refusing to let them in
 * over a housekeeping step would be the worse outcome. The caller is told
 * whether it happened so it can say so, and the attempt repeats on the next
 * unlock.
 */
export async function upgradeOnUnlock(
  passphrase: string,
  rawKey: Uint8Array,
  data: VaultData,
  stored: StoredVault,
): Promise<{ rawKey: Uint8Array; stored: StoredVault; upgraded: UpgradeKind }> {
  const kind = upgradeNeeded(stored)
  if (kind === 'none') return { rawKey, stored, upgraded: 'none' }
  try {
    if (kind === 'rekey') {
      // `stored.updatedAt` is carried, not refreshed: re-deriving the key
      // rewrites the record without changing a single credential, and the
      // unlocked screen shows this stamp as the vault's last change so a
      // rollback can be spotted. Since an old record is exactly the kind that
      // needs upgrading, stamping it now would print today's date on precisely
      // the planted vault that signal exists to catch (`decisions/0016`).
      const rekeyed = await rekeyVault(
        passphrase,
        data,
        stored.createdAt,
        // The record the lock screen loaded when the page opened. A tab left
        // sitting there while another deletes the vault and makes a new one
        // would otherwise resurrect the old one over the top of it on the next
        // successful unlock, which is a write nobody asked for.
        { replacing: stored },
        stored.updatedAt,
      )
      // The old key is dead the moment the new record lands; do not leave its
      // bytes lying in this heap waiting for a collector.
      rawKey.fill(0)
      return { ...rekeyed, upgraded: 'rekey' }
    }
    return {
      rawKey,
      stored: await sealVault(
        rawKey,
        data,
        {
          salt: stored.salt,
          kdfParams: stored.kdfParams,
          createdAt: stored.createdAt,
          // Same reasoning as the rekey branch: a format rewrite changes the
          // record, not what is in the vault.
          updatedAt: stored.updatedAt,
        },
        // And the same staleness as the rekey branch — this one keeps the key,
        // but it is the same lock screen holding the same record from mount.
        stored,
      ),
      upgraded: 'format',
    }
  } catch {
    return { rawKey, stored, upgraded: 'none' }
  }
}
