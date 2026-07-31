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
import {
  DEFAULT_KDF_PARAMS,
  deriveKey,
  kdfParamsAreOutdated,
  kdfParamsAreSupported,
  type KdfParams,
} from './kdf.ts'
import {
  PAD_BLOCK_BYTES,
  decryptVault,
  encryptVault,
  fromBase64,
  toBase64,
  WrongPassphraseError,
  type VaultData,
  type VaultHeader,
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

  it('defaults to 256 MiB of Argon2id memory (decisions/0013)', () => {
    // Pinned rather than left to drift: this number is the cost an offline
    // attacker pays per guess, and lowering it is the kind of change that
    // should have to argue with a test first.
    expect(DEFAULT_KDF_PARAMS.memoryKiB).toBe(256 * 1024)
    expect(DEFAULT_KDF_PARAMS.iterations).toBeGreaterThanOrEqual(3)
    expect(DEFAULT_KDF_PARAMS.algorithm).toBe('argon2id')
  })

  it('knows which stored parameters are behind the current defaults', () => {
    expect(kdfParamsAreOutdated(DEFAULT_KDF_PARAMS)).toBe(false)
    // Every vault created before this change.
    expect(kdfParamsAreOutdated({ ...DEFAULT_KDF_PARAMS, memoryKiB: 64 * 1024 })).toBe(true)
    expect(kdfParamsAreOutdated({ ...DEFAULT_KDF_PARAMS, iterations: 2 })).toBe(true)
    // Stronger than today's defaults is not "outdated": a vault must never be
    // dragged *down* to them.
    expect(kdfParamsAreOutdated({ ...DEFAULT_KDF_PARAMS, memoryKiB: 512 * 1024 })).toBe(false)
    expect(kdfParamsAreOutdated({ ...DEFAULT_KDF_PARAMS, iterations: 5 })).toBe(false)
    // Parallelism is a shape choice, not a strength one — not worth a re-key.
    expect(kdfParamsAreOutdated({ ...DEFAULT_KDF_PARAMS, parallelism: 2 })).toBe(false)
  })
})

describe('vault encryption', () => {
  const key = new Uint8Array(32).fill(1)
  const wrongKey = new Uint8Array(32).fill(2)

  /** The header a vault written today is bound to. */
  const writeHeader = { salt: 'c2FsdGVkc2FsdGVk', kdfParams: TEST_KDF }
  const readHeader: VaultHeader = { version: 2, ...writeHeader }
  /** The same vault as it was stored before `decisions/0014`. */
  const legacyHeader: VaultHeader = { version: 1, ...writeHeader }

  /**
   * Write plaintext the way format 1 did — no padding, no bound header — so the
   * migration path is tested against the real old bytes rather than a
   * reimplementation of it.
   */
  const encryptLegacy = async (rawKey: Uint8Array, json: string) => {
    const iv = new Uint8Array(12).fill(3)
    const subtle = await crypto.subtle.importKey(
      'raw',
      rawKey as BufferSource,
      'AES-GCM',
      false,
      ['encrypt'],
    )
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      subtle,
      new TextEncoder().encode(json),
    )
    return { iv, ciphertext: new Uint8Array(ciphertext) }
  }

  it('round-trips vault data', async () => {
    const blob = await encryptVault(key, sampleVault, writeHeader)
    const decrypted = await decryptVault(key, blob, readHeader)
    expect(decrypted).toEqual(sampleVault)
  })

  it('backfills entries when decrypting a vault that lacks the field', async () => {
    const { entries: _omitted, ...legacyVault } = sampleVault
    const blob = await encryptVault(key, legacyVault as VaultData, writeHeader)
    const decrypted = await decryptVault(key, blob, readHeader)
    expect(decrypted.entries).toEqual([])
    expect(decrypted.words).toEqual(sampleVault.words)
  })

  it('rejects the wrong key with WrongPassphraseError', async () => {
    const blob = await encryptVault(key, sampleVault, writeHeader)
    await expect(decryptVault(wrongKey, blob, readHeader)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    )
  })

  it('rejects tampered ciphertext', async () => {
    const blob = await encryptVault(key, sampleVault, writeHeader)
    blob.ciphertext[5] ^= 0xff
    await expect(decryptVault(key, blob, readHeader)).rejects.toBeInstanceOf(WrongPassphraseError)
  })

  it('never reuses an IV across saves', async () => {
    const ivs = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const blob = await encryptVault(key, sampleVault, writeHeader)
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
    const a = await encryptVault(key, sampleVault, writeHeader)
    const b = await encryptVault(key, sampleVault, writeHeader)
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
    await expect(
      decryptVault(key, await encryptLegacy(key, '{ this is not json'), legacyHeader),
    ).rejects.toThrow(/damaged/i)

    // Authentic plaintext that parses but is not a vault: the shape check,
    // not the JSON parser, is what has to catch this one.
    const notAVault = JSON.parse('{"version":1,"words":"not an array"}') as VaultData
    await expect(
      decryptVault(key, await encryptVault(key, notAVault, writeHeader), readHeader),
    ).rejects.toThrow(/damaged/i)
  })

  it('backfills associations as well as entries when they are missing', async () => {
    const sparse = JSON.parse('{"version":1,"words":["a","b"],"createdAt":1}') as VaultData
    const data = await decryptVault(
      key,
      await encryptVault(key, sparse, writeHeader),
      readHeader,
    )
    expect(data.associations).toEqual([])
    expect(data.entries).toEqual([])
  })
})

describe('vault padding and header binding (decisions/0014)', () => {
  const key = new Uint8Array(32).fill(1)
  const writeHeader = { salt: 'c2FsdGVkc2FsdGVk', kdfParams: TEST_KDF }
  const readHeader: VaultHeader = { version: 2, ...writeHeader }
  const GCM_TAG_BYTES = 16

  const withEntries = (n: number): VaultData => ({
    ...sampleVault,
    entries: Array.from({ length: n }, (_, i) => ({
      id: `id-${i}`,
      label: `Site ${i}`,
      url: `https://site${i}.example`,
      username: `user${i}`,
      password: `password-${i}`,
      notes: '',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    })),
  })

  it('pads every vault to a whole number of 4 KiB blocks', async () => {
    for (const count of [0, 1, 5]) {
      const blob = await encryptVault(key, withEntries(count), writeHeader)
      expect((blob.ciphertext.length - GCM_TAG_BYTES) % PAD_BLOCK_BYTES).toBe(0)
    }
  })

  it('hides the length of a newly added password, which is the actual leak', async () => {
    // The attack in `decisions/0014` is two snapshots of the stored record: an
    // unpadded vault grows by exactly the length of whatever was added, which
    // shrinks the search space against that one site. Same block count before
    // and after is what closes it.
    const before = await encryptVault(key, withEntries(1), writeHeader)
    const after = await encryptVault(
      key,
      {
        ...withEntries(1),
        entries: [
          ...withEntries(1).entries,
          {
            id: 'new',
            label: 'Bank',
            url: 'https://bank.example',
            username: 'me',
            password: 'a-notably-long-generated-password-0123456789',
            notes: '',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      writeHeader,
    )
    expect(after.ciphertext.length).toBe(before.ciphertext.length)
  })

  it('round-trips a vault big enough to need several blocks', async () => {
    const big = withEntries(80)
    const blob = await encryptVault(key, big, writeHeader)
    expect(blob.ciphertext.length).toBeGreaterThan(PAD_BLOCK_BYTES + GCM_TAG_BYTES)
    expect(await decryptVault(key, blob, readHeader)).toEqual(big)
  })

  it('will not open with a header that is not the one it was sealed under', async () => {
    const blob = await encryptVault(key, sampleVault, writeHeader)
    // A rewritten salt, which is the field an attacker with the profile
    // directory would reach for.
    await expect(
      decryptVault(key, blob, { ...readHeader, salt: 'b3RoZXJzYWx0eHg=' }),
    ).rejects.toBeInstanceOf(WrongPassphraseError)
    // Altered KDF parameters — the header field that decides how much work an
    // attacker has to do, and so the one worth binding most.
    await expect(
      decryptVault(key, blob, { ...readHeader, kdfParams: { ...TEST_KDF, memoryKiB: 32 * 1024 } }),
    ).rejects.toBeInstanceOf(WrongPassphraseError)
    await expect(
      decryptVault(key, blob, { ...readHeader, kdfParams: { ...TEST_KDF, iterations: 1 } }),
    ).rejects.toBeInstanceOf(WrongPassphraseError)
  })

  it('will not open a current vault claiming to be an old one, or the reverse', async () => {
    // Flipping the stored version is the cheapest tamper there is, and both
    // directions have to fail closed rather than half-parse.
    const current = await encryptVault(key, sampleVault, writeHeader)
    await expect(decryptVault(key, current, { ...readHeader, version: 1 })).rejects.toBeInstanceOf(
      WrongPassphraseError,
    )
  })
})

describe('opening a pre-0014 vault', () => {
  const key = new Uint8Array(32).fill(1)
  const header: VaultHeader = { version: 1, salt: 'c2FsdGVkc2FsdGVk', kdfParams: TEST_KDF }

  it('still opens a format-1 vault: unpadded, with nothing bound', async () => {
    // Written the way the shipped app wrote it before this change — plain JSON,
    // no additional data — so this is the real migration case, not a mock of it.
    const iv = new Uint8Array(12).fill(7)
    const subtle = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt'])
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        subtle,
        new TextEncoder().encode(JSON.stringify(sampleVault)),
      ),
    )
    // The premise of the whole exercise: the old format's length is its
    // plaintext's length.
    expect(ciphertext.length).toBe(JSON.stringify(sampleVault).length + 16)
    expect(await decryptVault(key, { iv, ciphertext }, header)).toEqual(sampleVault)
  })

  it('refuses an old vault whose header claims the current format', async () => {
    const iv = new Uint8Array(12).fill(7)
    const subtle = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt'])
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        subtle,
        new TextEncoder().encode(JSON.stringify(sampleVault)),
      ),
    )
    await expect(
      decryptVault(key, { iv, ciphertext }, { ...header, version: 2 }),
    ).rejects.toBeInstanceOf(WrongPassphraseError)
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

  it('rejects base64 of a length atob will not accept, not just a bad alphabet', () => {
    // `AAAAA` is five legal base64 characters and one over a multiple of four.
    // The alphabet check passed it and `atob` threw a raw DOMException at
    // unlock — one screen after the restore had replaced the live vault, which
    // is precisely the ordering this validation exists to prevent.
    expect(() => atob('AAAAA')).toThrow()
    expect(() => parseBackup(wrap({ ...goodVault, salt: 'AAAAA' }))).toThrow(/incomplete/i)
    expect(() => parseBackup(wrap({ ...goodVault, ciphertext: 'AAAAAAAAA' }))).toThrow(/incomplete/i)
    // Unpadded lengths that `atob` does accept stay accepted.
    expect(parseBackup(wrap({ ...goodVault, salt: 'AAA' })).salt).toBe('AAA')
  })

  it('rejects JSON that parses to something that is not an object', () => {
    expect(() => parseBackup('null')).toThrow(/not a where was my password/i)
    expect(() => parseBackup('7')).toThrow(/not a where was my password/i)
    expect(() => parseBackup('"a string"')).toThrow(/not a where was my password/i)
  })
})
