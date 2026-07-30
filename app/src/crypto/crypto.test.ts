import { describe, expect, it } from 'vitest'
import { EFF_WORDLIST } from './eff-wordlist.ts'
import { IMAGEABLE_WORDLIST } from './imageable-wordlist.ts'
import { randomInt } from './random.ts'
import {
  BITS_PER_WORD,
  MAX_REROLL_BITS,
  generatePassphrase,
  normalizePassphrase,
  phraseEntropyBits,
  rerollCostBits,
  rerollWord,
} from './wordlist.ts'
import { DEFAULT_KDF_PARAMS, deriveKey, kdfParamsAreSupported, type KdfParams } from './kdf.ts'
import {
  decryptVault,
  encryptVault,
  fromBase64,
  toBase64,
  WrongPassphraseError,
  type VaultData,
} from './vault.ts'
import { parseBackup, serializeBackup } from '../storage/backup.ts'
import { migratePracticeMeta, type StoredVault } from '../storage/db.ts'
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
  it('has 7776 unique words in the EFF source list', () => {
    expect(EFF_WORDLIST.length).toBe(7776)
    expect(new Set(EFF_WORDLIST).size).toBe(7776)
  })

  it('imageable list is a healthy, unique, lowercase subset of the EFF list', () => {
    // Floor set just under the current 2255: a future curation pass must not be
    // able to quietly cut per-word entropy without this failing.
    expect(IMAGEABLE_WORDLIST.length).toBeGreaterThanOrEqual(2200) // >= 11.1 bits/word
    expect(new Set(IMAGEABLE_WORDLIST).size).toBe(IMAGEABLE_WORDLIST.length)
    const eff = new Set(EFF_WORDLIST)
    for (const w of IMAGEABLE_WORDLIST) {
      expect(eff.has(w)).toBe(true)
      expect(w).toMatch(/^[a-z]+$/)
    }
  })

  it('generates the requested number of words, all from the imageable list', () => {
    const words = generatePassphrase(6)
    expect(words).toHaveLength(6)
    const set = new Set(IMAGEABLE_WORDLIST)
    for (const w of words) expect(set.has(w)).toBe(true)
  })

  it('rejects out-of-range word counts', () => {
    expect(() => generatePassphrase(3)).toThrow(RangeError)
    expect(() => generatePassphrase(9)).toThrow(RangeError)
    // 5 words is 55.7 bits — below the offline-attack floor, so it is rejected.
    expect(() => generatePassphrase(5)).toThrow(RangeError)
  })

  it('reroll replaces only the requested index', () => {
    const words = generatePassphrase(6)
    const rerolled = rerollWord(words, 2)
    for (let i = 0; i < 6; i++) {
      if (i !== 2) expect(rerolled[i]).toBe(words[i])
    }
    expect(rerolled).not.toBe(words) // no mutation
  })

  it('reports entropy from the real size of the generation list', () => {
    expect(phraseEntropyBits(6)).toBeCloseTo(6 * Math.log2(IMAGEABLE_WORDLIST.length), 1)
  })

  it('charges re-rolls against the entropy it reports', () => {
    // Keeping one of two offered words is one bit, one of four is two. The
    // meter used to ignore this entirely and claim 66.8 bits however long the
    // user hunted for words they liked.
    expect(rerollCostBits([0, 0, 0, 0, 0, 0], 0)).toBe(0)
    expect(rerollCostBits([1, 0, 0, 0, 0, 0], 0)).toBeCloseTo(1, 6)
    expect(rerollCostBits([3, 0, 0, 0, 0, 0], 0)).toBeCloseTo(2, 6)
    expect(rerollCostBits([1, 1, 0, 0, 0, 0], 0)).toBeCloseTo(2, 6)
    // Regenerating the whole phrase is charged too, so flipping the word count
    // back and forth is not a free re-roll.
    expect(rerollCostBits([0, 0, 0, 0, 0, 0], 1)).toBeCloseTo(1, 6)
    expect(phraseEntropyBits(6, rerollCostBits([1, 1, 0, 0, 0, 0], 0))).toBeCloseTo(
      6 * BITS_PER_WORD - 2,
      1,
    )
  })

  it('spending can only ever go up, so a shorter phrase cannot refund re-rolls', () => {
    // The generator holds one MAX_WORDS-long history rather than trimming it
    // to the current word count. Trimming would mean going 8 words -> re-roll
    // the last two -> back to 6 words dropped the charge, and cycling the
    // count laundered an exhausted budget.
    const eightWordHistory = [0, 0, 0, 0, 0, 0, 1, 1]
    const spentAtEight = rerollCostBits(eightWordHistory, 1)
    // Coming back to six words keeps the same history; only `count` changes.
    const spentBackAtSix = rerollCostBits(eightWordHistory, 2)
    expect(spentBackAtSix).toBeGreaterThan(spentAtEight)
    // Whereas trimming the tail — the bug — would have refunded two bits.
    expect(rerollCostBits(eightWordHistory.slice(0, 6), 2)).toBeLessThan(spentAtEight)
  })

  it('cannot be re-rolled below the strength of the withdrawn five-word option', () => {
    // Five words was 55.7 bits and was withdrawn. Spend the budget the way a
    // user actually would — one re-roll per word until the next one is refused
    // — and check where that lands, rather than comparing two constants.
    const rerolls = Array<number>(6).fill(0)
    let regenerations = 0
    const affordable = (next: () => number) => next() <= MAX_REROLL_BITS
    for (let round = 0; round < 200; round++) {
      let spentSomething = false
      for (let i = 0; i < rerolls.length; i++) {
        const trial = [...rerolls]
        trial[i] += 1
        if (affordable(() => rerollCostBits(trial, regenerations))) {
          rerolls[i] += 1
          spentSomething = true
        }
      }
      if (affordable(() => rerollCostBits(rerolls, regenerations + 1))) {
        regenerations += 1
        spentSomething = true
      }
      if (!spentSomething) break
    }
    const floor = phraseEntropyBits(6, rerollCostBits(rerolls, regenerations))
    expect(floor).toBeGreaterThan(5 * BITS_PER_WORD) // stronger than the setting we withdrew
    expect(floor).toBeGreaterThan(60)
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

  it('refuses absurd parameters wherever they came from, not just from backups', async () => {
    // The stored vault record is a file on disk. Anyone who can rewrite it
    // could ask for two terabytes of Argon2id memory on every unlock and wedge
    // the vault for good — and, the header being unauthenticated, the user
    // would be told their passphrase was wrong. The backup path checked this;
    // the unlock path did not, so the check now lives in `deriveKey` itself.
    await expect(deriveKey('phrase', salt, { ...TEST_KDF, memoryKiB: 2 ** 31 })).rejects.toThrow(
      /key-derivation/,
    )
    await expect(deriveKey('phrase', salt, { ...TEST_KDF, iterations: 0 })).rejects.toThrow()
    await expect(
      deriveKey('phrase', salt, { ...TEST_KDF, algorithm: 'md5' } as unknown as KdfParams),
    ).rejects.toThrow()
  })

  it('accepts the shipped defaults and the whole documented range', () => {
    expect(kdfParamsAreSupported(DEFAULT_KDF_PARAMS)).toBe(true)
    // Room to raise the defaults later without a code change.
    expect(kdfParamsAreSupported({ ...DEFAULT_KDF_PARAMS, memoryKiB: 1024 * 1024 })).toBe(true)
    expect(kdfParamsAreSupported({ ...DEFAULT_KDF_PARAMS, memoryKiB: 4 * 1024 })).toBe(false)
    expect(kdfParamsAreSupported(undefined)).toBe(false)
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

  it('backfills entries when decrypting a pre-v2 vault that lacks the field', async () => {
    const { entries: _omitted, ...legacyVault } = sampleVault
    const blob = await encryptVault(key, legacyVault as VaultData)
    const decrypted = await decryptVault(key, blob)
    expect(decrypted.entries).toEqual([])
    expect(decrypted.words).toEqual(sampleVault.words)
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

  it('encrypting the same vault twice gives unrelated bytes', async () => {
    // Substring-searching the ciphertext for the plaintext words would pass for
    // ROT13 or for XOR with a constant, so it proves nothing. What actually
    // distinguishes real encryption here is that two encryptions of identical
    // input share no structure, and that the output is not the plaintext length
    // plus a fixed constant in some recognisable encoding.
    const a = await encryptVault(key, sampleVault)
    const b = await encryptVault(key, sampleVault)
    expect(toBase64(a.ciphertext)).not.toBe(toBase64(b.ciphertext))
    let agreeing = 0
    for (let i = 0; i < a.ciphertext.length; i++) {
      if (a.ciphertext[i] === b.ciphertext[i]) agreeing++
    }
    // Two independent random streams agree on about 1 byte in 256.
    expect(agreeing).toBeLessThan(a.ciphertext.length / 32)
  })

  it('reports a damaged vault as damaged rather than as a wrong passphrase', async () => {
    // Authentic plaintext that is not a vault means corruption, and the user
    // should not be told to go and re-walk their memory house over it.
    const key2 = new Uint8Array(32).fill(9)
    const iv = new Uint8Array(12).fill(3)
    const subtle = await crypto.subtle.importKey('raw', key2, 'AES-GCM', false, ['encrypt'])
    const junk = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      subtle,
      new TextEncoder().encode('{ this is not json'),
    )
    await expect(
      decryptVault(key2, { iv, ciphertext: new Uint8Array(junk) }),
    ).rejects.toThrow(/damaged/i)

    // Authentic plaintext that parses but is not a vault: the shape check,
    // not the JSON parser, is what has to catch this one.
    const notAVault = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      subtle,
      new TextEncoder().encode('{"version":1,"words":"not an array"}'),
    )
    await expect(
      decryptVault(key2, { iv, ciphertext: new Uint8Array(notAVault) }),
    ).rejects.toThrow(/damaged/i)
  })

  it('backfills associations as well as entries when they are missing', async () => {
    const iv = new Uint8Array(12).fill(5)
    const key3 = new Uint8Array(32).fill(6)
    const subtle = await crypto.subtle.importKey('raw', key3, 'AES-GCM', false, ['encrypt'])
    const sparse = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      subtle,
      new TextEncoder().encode('{"version":1,"words":["a","b"],"createdAt":1}'),
    )
    const data = await decryptVault(key3, { iv, ciphertext: new Uint8Array(sparse) })
    expect(data.associations).toEqual([])
    expect(data.entries).toEqual([])
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
  const never = { practiceCount: 0, lastPracticedAt: null }

  it('walks the expanding ladder 1, 2, 4 days…', () => {
    expect(nextPracticeAt(t0, never)).toBe(t0 + 1 * DAY)
    expect(nextPracticeAt(t0, { practiceCount: 1, lastPracticedAt: t0 + DAY })).toBe(t0 + DAY + 2 * DAY)
    expect(nextPracticeAt(t0, { practiceCount: 2, lastPracticedAt: t0 + 3 * DAY })).toBe(
      t0 + 3 * DAY + 4 * DAY,
    )
  })

  it('settles at 30 days after the ladder', () => {
    expect(nextPracticeAt(t0, { practiceCount: 7, lastPracticedAt: t0 + 7 * DAY })).toBe(
      t0 + 7 * DAY + 30 * DAY,
    )
  })

  it('reports due status', () => {
    expect(isPracticeDue(t0, never, t0 + 2 * DAY)).toBe(true)
    expect(isPracticeDue(t0, never, t0 + DAY / 2)).toBe(false)
  })

  it('migrates a legacy unlock timeline to a count and a last date', () => {
    // The timeline was a plaintext activity log of the user's whole life with
    // the app; the schedule only ever read its length and its maximum.
    const legacy = { createdAt: t0, practicedAt: [t0 + DAY, t0 + 3 * DAY, t0 + 2 * DAY] }
    const migrated = migratePracticeMeta(legacy)
    expect(migrated).toEqual({ createdAt: t0, practiceCount: 3, lastPracticedAt: t0 + 3 * DAY })
    expect('practicedAt' in migrated).toBe(false)
    // Same schedule before and after, which is what makes it safe to drop.
    expect(nextPracticeAt(t0, migrated)).toBe(t0 + 3 * DAY + 7 * DAY)
  })

  it('leaves an already-migrated record alone, and copes with no history', () => {
    const current = { createdAt: t0, practiceCount: 2, lastPracticedAt: t0 + DAY }
    expect(migratePracticeMeta(current)).toBe(current)
    expect(migratePracticeMeta({ createdAt: t0 })).toEqual({
      createdAt: t0,
      practiceCount: 0,
      lastPracticedAt: null,
    })
  })
})

describe('backup files from untrusted sources', () => {
  const goodVault = {
    version: 1 as const,
    salt: 'c2FsdA==',
    kdfParams: TEST_KDF,
    iv: 'aXY=',
    ciphertext: 'Y3Q=',
    createdAt: 1,
    updatedAt: 2,
  }
  const wrap = (vault: unknown) =>
    JSON.stringify({ kind: 'wherewasmypassword-backup', exportedAt: 1, vault })

  it('accepts a well-formed backup', () => {
    expect(parseBackup(wrap(goodVault)).salt).toBe(goodVault.salt)
  })

  it('rejects absurd KDF parameters from an untrusted file', () => {
    // 2 TiB of Argon2id memory would wedge the unlock screen permanently.
    const hostile = { ...goodVault, kdfParams: { ...TEST_KDF, memoryKiB: 2 ** 31 } }
    expect(() => parseBackup(wrap(hostile))).toThrow(/key-derivation/)

    expect(() => parseBackup(wrap({ ...goodVault, kdfParams: { ...TEST_KDF, iterations: 0 } }))).toThrow()
    expect(() =>
      parseBackup(wrap({ ...goodVault, kdfParams: { ...TEST_KDF, algorithm: 'md5' } })),
    ).toThrow()
  })

  it('rejects fields of the wrong type, not just missing ones', () => {
    // `salt: {}` and `iv: 7` are truthy, so a presence check waved them
    // through and they only failed much later, inside the unlock path.
    expect(() => parseBackup(wrap({ ...goodVault, salt: {} }))).toThrow(/incomplete/i)
    expect(() => parseBackup(wrap({ ...goodVault, iv: 7 }))).toThrow(/incomplete/i)
    expect(() => parseBackup(wrap({ ...goodVault, ciphertext: null }))).toThrow(/incomplete/i)
    // Nor a ciphertext large enough to fill the origin's storage quota.
    expect(() => parseBackup(wrap({ ...goodVault, ciphertext: 'A'.repeat(9 * 1024 * 1024) }))).toThrow(
      /incomplete/i,
    )
  })

  it('keeps only the fields it understands', () => {
    const restored = parseBackup(wrap({ ...goodVault, smuggled: 'anything' }))
    expect('smuggled' in restored).toBe(false)
    expect(Object.keys(restored).sort()).toEqual(
      ['ciphertext', 'createdAt', 'iv', 'kdfParams', 'salt', 'updatedAt', 'version'].sort(),
    )
  })

  it('a __proto__ key in the raw JSON does not reach the persisted record', () => {
    // Written as raw text on purpose: in an object literal `__proto__:` sets
    // the prototype and never survives JSON.stringify, so the same test
    // written with a literal would assert nothing at all.
    const raw = `{"kind":"wherewasmypassword-backup","exportedAt":1,"vault":${JSON.stringify(
      goodVault,
    ).replace(/^\{/, '{"__proto__":{"polluted":true},')}}`
    const restored = parseBackup(raw)
    expect(Object.prototype.hasOwnProperty.call(restored, '__proto__')).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('substitutes a sane timestamp rather than trusting one from the file', () => {
    const restored = parseBackup(wrap({ ...goodVault, createdAt: 'yesterday', updatedAt: NaN }))
    expect(Number.isFinite(restored.createdAt)).toBe(true)
    expect(Number.isFinite(restored.updatedAt)).toBe(true)
  })

  it('rejects a timestamp far in the future, which would retire the practice schedule', () => {
    // Finite, so a finiteness check passes it — and `nextPracticeAt` would
    // then land in the year 33658 and never come due again.
    const restored = parseBackup(wrap({ ...goodVault, createdAt: 1e15 }))
    expect(restored.createdAt).toBeLessThanOrEqual(Date.now())
  })

  it('rejects fields that are strings but not base64', () => {
    // These used to fail only when `atob` reached them at unlock — after the
    // restore had already replaced the live vault.
    expect(() => parseBackup(wrap({ ...goodVault, salt: 'not base64!!' }))).toThrow(/incomplete/i)
    expect(() => parseBackup(wrap({ ...goodVault, iv: '<script>' }))).toThrow(/incomplete/i)
    // A salt is 24 base64 characters; there is no reason to accept a huge one.
    expect(() => parseBackup(wrap({ ...goodVault, salt: 'A'.repeat(500) }))).toThrow(/incomplete/i)
  })

  it('rejects JSON that parses to something that is not an object', () => {
    expect(() => parseBackup('null')).toThrow(/not a where was my password/i)
    expect(() => parseBackup('7')).toThrow(/not a where was my password/i)
    expect(() => parseBackup('"a string"')).toThrow(/not a where was my password/i)
  })
})
