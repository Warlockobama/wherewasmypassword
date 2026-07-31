import { DEFAULT_KDF_PARAMS, deriveKey, kdfParamsAreOutdated } from '../crypto/kdf.ts'
import { randomBytes } from '../crypto/random.ts'
import {
  VAULT_FORMAT_VERSION,
  encryptVault,
  toBase64,
  type VaultData,
} from '../crypto/vault.ts'
import { saveVault, type StoredVault } from '../storage/db.ts'

/**
 * The one place a vault record is written.
 *
 * Every write goes through here so that no path can leave a vault on an old
 * format: `version` is always stamped to the current one, and the header the
 * ciphertext is bound to is always the header that gets stored beside it. The
 * two travelling together is what makes the binding in `decisions/0014` hold.
 */
export async function sealVault(
  rawKey: Uint8Array,
  data: VaultData,
  header: { salt: string; kdfParams: StoredVault['kdfParams']; createdAt: number },
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
    updatedAt: Date.now(),
  }
  await saveVault(next)
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
 */
export async function rekeyVault(
  passphrase: string,
  data: VaultData,
  createdAt: number,
): Promise<{ rawKey: Uint8Array; stored: StoredVault }> {
  const salt = randomBytes(16)
  const rawKey = await deriveKey(passphrase, salt, DEFAULT_KDF_PARAMS)
  const stored = await sealVault(rawKey, data, {
    salt: toBase64(salt),
    kdfParams: DEFAULT_KDF_PARAMS,
    createdAt,
  })
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
      const rekeyed = await rekeyVault(passphrase, data, stored.createdAt)
      // The old key is dead the moment the new record lands; do not leave its
      // bytes lying in this heap waiting for a collector.
      rawKey.fill(0)
      return { ...rekeyed, upgraded: 'rekey' }
    }
    return {
      rawKey,
      stored: await sealVault(rawKey, data, {
        salt: stored.salt,
        kdfParams: stored.kdfParams,
        createdAt: stored.createdAt,
      }),
      upgraded: 'format',
    }
  } catch {
    return { rawKey, stored, upgraded: 'none' }
  }
}
