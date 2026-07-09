import { describe, expect, it } from 'vitest'
import { EFF_WORDLIST } from './eff-wordlist.ts'
import { randomInt } from './random.ts'
import {
  generatePassphrase,
  normalizePassphrase,
  phraseEntropyBits,
  rerollWord,
} from './wordlist.ts'
import { deriveKey, type KdfParams } from './kdf.ts'
import {
  decryptVault,
  encryptVault,
  fromBase64,
  toBase64,
  WrongPassphraseError,
  type VaultData,
} from './vault.ts'
import { parseBackup, serializeBackup } from '../storage/backup.ts'
import type { StoredVault } from '../storage/db.ts'
import { isPracticeDue, nextPracticeAt } from '../srs/schedule.ts'

// Small params keep the suite fast; one test exercises real derivation determinism.
const TEST_KDF: KdfParams = {
  algorithm: 'argon2id',
  memoryKiB: 8 * 1024,
  iterations: 2,
  parallelism: 1,
}

const sampleVault: VaultData = {
  version: 1,
  words: ['abacus', 'zebra', 'lantern'],
  associations: [{ locusId: 'mailbox', word: 'abacus', imagery: 'a giant abacus jammed in the mailbox' }],
  createdAt: 1700000000000,
  entries: [],
}

describe('wordlist', () => {
  it('has 7776 unique words', () => {
    expect(EFF_WORDLIST.length).toBe(7776)
    expect(new Set(EFF_WORDLIST).size).toBe(7776)
  })

  it('generates the requested number of words, all from the list', () => {
    const words = generatePassphrase(6)
    expect(words).toHaveLength(6)
    const set = new Set(EFF_WORDLIST)
    for (const w of words) expect(set.has(w)).toBe(true)
  })

  it('rejects out-of-range word counts', () => {
    expect(() => generatePassphrase(3)).toThrow(RangeError)
    expect(() => generatePassphrase(9)).toThrow(RangeError)
  })

  it('reroll replaces only the requested index', () => {
    const words = generatePassphrase(6)
    const rerolled = rerollWord(words, 2)
    for (let i = 0; i < 6; i++) {
      if (i !== 2) expect(rerolled[i]).toBe(words[i])
    }
    expect(rerolled).not.toBe(words) // no mutation
  })

  it('reports ~12.9 bits per word', () => {
    expect(phraseEntropyBits(6)).toBeCloseTo(77.5, 0)
  })

  it('normalizes case and whitespace', () => {
    expect(normalizePassphrase('  Alpha   BETA\tgamma ')).toBe('alpha beta gamma')
  })
})

describe('randomInt', () => {
  it('stays in bounds and hits both ends eventually', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const n = randomInt(8)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(8)
      seen.add(n)
    }
    expect(seen.size).toBe(8)
  })
})

describe('kdf', () => {
  const salt = new Uint8Array(16).fill(7)

  it('derives a 32-byte key, deterministically per (phrase, salt)', async () => {
    const a = await deriveKey('correct horse battery staple', salt, TEST_KDF)
    const b = await deriveKey('correct horse battery staple', salt, TEST_KDF)
    expect(a.length).toBe(32)
    expect(toBase64(a)).toBe(toBase64(b))
  })

  it('normalization makes case/spacing irrelevant', async () => {
    const a = await deriveKey('Correct  HORSE battery staple', salt, TEST_KDF)
    const b = await deriveKey('correct horse battery staple', salt, TEST_KDF)
    expect(toBase64(a)).toBe(toBase64(b))
  })

  it('different salts give different keys', async () => {
    const otherSalt = new Uint8Array(16).fill(8)
    const a = await deriveKey('correct horse battery staple', salt, TEST_KDF)
    const b = await deriveKey('correct horse battery staple', otherSalt, TEST_KDF)
    expect(toBase64(a)).not.toBe(toBase64(b))
  })
})

describe('vault encryption', () => {
  const key = new Uint8Array(32).fill(1)
  const wrongKey = new Uint8Array(32).fill(2)

  it('round-trips vault data', async () => {
    const blob = await encryptVault(key, sampleVault)
    const decrypted = await decryptVault(key, blob)
    expect(decrypted).toEqual(sampleVault)
  })

  it('rejects the wrong key with WrongPassphraseError', async () => {
    const blob = await encryptVault(key, sampleVault)
    await expect(decryptVault(wrongKey, blob)).rejects.toBeInstanceOf(WrongPassphraseError)
  })

  it('rejects tampered ciphertext', async () => {
    const blob = await encryptVault(key, sampleVault)
    blob.ciphertext[5] ^= 0xff
    await expect(decryptVault(key, blob)).rejects.toBeInstanceOf(WrongPassphraseError)
  })

  it('never reuses an IV across saves', async () => {
    const ivs = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const blob = await encryptVault(key, sampleVault)
      ivs.add(toBase64(blob.iv))
    }
    expect(ivs.size).toBe(20)
  })

  it('base64 helpers round-trip arbitrary bytes', () => {
    const bytes = new Uint8Array(256).map((_, i) => i)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })

  it('plaintext words never appear in the encrypted blob', async () => {
    const blob = await encryptVault(key, sampleVault)
    const raw = new TextDecoder('latin1').decode(blob.ciphertext)
    for (const word of sampleVault.words) {
      expect(raw).not.toContain(word)
    }
  })
})

describe('backup files', () => {
  const record: StoredVault = {
    version: 1,
    salt: 'c2FsdA==',
    kdfParams: TEST_KDF,
    iv: 'aXZpdml2aXZpdg==',
    ciphertext: 'Y2lwaGVy',
    createdAt: 1,
    updatedAt: 2,
  }

  it('round-trips a stored vault', () => {
    expect(parseBackup(serializeBackup(record))).toEqual(record)
  })

  it('rejects junk and foreign files', () => {
    expect(() => parseBackup('not json')).toThrow(/unreadable/i)
    expect(() => parseBackup('{"kind":"other"}')).toThrow(/not a where was my password/i)
    expect(() => parseBackup(JSON.stringify({ kind: 'wherewasmypassword-backup', vault: { version: 1 } }))).toThrow(
      /incomplete/i,
    )
  })
})

describe('practice schedule', () => {
  const DAY = 24 * 60 * 60 * 1000
  const t0 = 1700000000000

  it('walks the expanding ladder 1, 2, 4 days…', () => {
    expect(nextPracticeAt(t0, [])).toBe(t0 + 1 * DAY)
    expect(nextPracticeAt(t0, [t0 + DAY])).toBe(t0 + DAY + 2 * DAY)
    expect(nextPracticeAt(t0, [t0 + DAY, t0 + 3 * DAY])).toBe(t0 + 3 * DAY + 4 * DAY)
  })

  it('settles at 30 days after the ladder', () => {
    const log = [1, 2, 3, 4, 5, 6, 7].map((i) => t0 + i * DAY)
    expect(nextPracticeAt(t0, log)).toBe(t0 + 7 * DAY + 30 * DAY)
  })

  it('reports due status', () => {
    expect(isPracticeDue(t0, [], t0 + 2 * DAY)).toBe(true)
    expect(isPracticeDue(t0, [], t0 + DAY / 2)).toBe(false)
  })
})
