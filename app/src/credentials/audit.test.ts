import { describe, expect, it } from 'vitest'
import { auditVault, ceilingBits, characterClasses } from './audit.ts'
import { generateSitePassword } from './generate-password.ts'
import type { Credential } from './types.ts'

/**
 * The weak-and-reused pass (`decisions/0026`).
 *
 * Most of these assert the *absence* of a finding as hard as the presence of
 * one. A review screen that cries wolf gets dismissed wholesale, taking the
 * reused-password row with it — so "a long lowercase passphrase is left alone"
 * matters as much as "123456 is caught".
 */

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

/**
 * Deliberately not `correct horse battery staple`. The leak assertions below
 * check that no master word reaches the output, and words that ordinary English
 * prose uses would fail the moment someone wrote "correct" into the panel's copy
 * — failing loudly for a reason that is not a leak, which is how a test that
 * guards something important gets deleted.
 */
const MASTER = ['zeppelin', 'marzipan', 'glowworm', 'trombone', 'saffron', 'quixotic']

/** Findings for one entry, by kind, from a one-entry vault. */
const kindsOf = (password: string, master: string[] = MASTER) =>
  auditVault([cred({ label: 'Site', password })], master).all[0].findings.map((f) => f.kind)

const verdictOf = (password: string, master: string[] = MASTER) =>
  auditVault([cred({ label: 'Site', password })], master).all[0].verdict

describe('characterClasses', () => {
  it('sorts every character into exactly one class', () => {
    expect(characterClasses('aA1!')).toEqual({
      lower: true,
      upper: true,
      digit: true,
      symbol: true,
      other: false,
    })
    expect(characterClasses('café')).toMatchObject({ lower: true, other: true, symbol: false })
    expect(characterClasses(' ')).toMatchObject({ symbol: true })
  })

  it('finds no classes in an empty password', () => {
    expect(Object.values(characterClasses('')).some(Boolean)).toBe(false)
  })
})

describe('ceilingBits', () => {
  it('is zero for an empty password rather than negative infinity', () => {
    expect(ceilingBits('')).toBe(0)
  })

  it('rises with both length and alphabet', () => {
    expect(ceilingBits('aaaaaaaa')).toBeLessThan(ceilingBits('aaaaaaaaaaaaaaaa'))
    expect(ceilingBits('abcdefgh')).toBeLessThan(ceilingBits('abcdEF12'))
  })

  it('counts a code point outside the basic plane once, not twice', () => {
    // '🔑'.length is 2 in JavaScript. Charging two characters for one keypress
    // would inflate the ceiling on exactly the passwords it understands least.
    expect(ceilingBits('🔑')).toBe(ceilingBits('é'))
  })

  it('rates the generator’s own output far above anything hand-made here', () => {
    // Not an assertion about the number, which is arithmetic — an assertion that
    // the tool the app offers clears the bar the app sets.
    expect(ceilingBits(generateSitePassword(20))).toBeGreaterThan(100)
  })
})

describe('the master passphrase used as a site password', () => {
  it('is the worst thing the pass can find', () => {
    expect(kindsOf(MASTER.join(' '))).toContain('master-phrase')
    expect(verdictOf(MASTER.join(' '))).toBe('critical')
  })

  it('is caught however the user spelled it', () => {
    for (const spelling of [
      MASTER.join(' '),
      MASTER.join('-'),
      MASTER.join(''),
      MASTER.join(' ').toUpperCase(),
      `${MASTER.join('.')}!`,
    ]) {
      expect(kindsOf(spelling)).toContain('master-phrase')
    }
  })

  it('is still caught when a site demanded a digit and the user appended one', () => {
    // The single most likely way the phrase reaches a password box in a form
    // the vault would not recognise character for character. `fold` drops digits
    // for exactly this, which is safe because no wordlist entry contains one.
    expect(kindsOf(`${MASTER.join(' ')}1`)).toContain('master-phrase')
    expect(kindsOf(`${MASTER.join('')}2024`)).toContain('master-phrase')
    expect(kindsOf(`1${MASTER.join('-')}`)).toContain('master-phrase')
  })

  it('does not fire on a phrase that merely shares words', () => {
    // Built from MASTER rather than written out, so that changing the fixture
    // cannot quietly turn these into two unrelated strings that pass for free.
    expect(kindsOf(MASTER.slice(0, 5).join(' '))).not.toContain('master-phrase')
    expect(kindsOf([...MASTER, 'bolt'].join(' '))).not.toContain('master-phrase')
  })

  it('survives a phrase with no ASCII letters in it', () => {
    // `fold` keeps any Unicode letter rather than just `a-z`. Stripping to `a-z`
    // would fold such a phrase to '', which the guard reads as "this vault has
    // no phrase" — silently disabling the most important check in the module.
    const cyrillic = ['пароль', 'словарь', 'крепость']
    expect(kindsOf(cyrillic.join(' '), cyrillic)).toContain('master-phrase')
    expect(kindsOf('something else entirely', cyrillic)).not.toContain('master-phrase')
  })

  it('does not fire when the vault has no words to compare against', () => {
    // A folded empty master would otherwise equal a folded empty password, and
    // every entry in a wordless vault would be reported as the master phrase.
    expect(kindsOf('', [])).not.toContain('master-phrase')
    expect(kindsOf('!!!!', [])).not.toContain('master-phrase')
    expect(kindsOf('', MASTER)).not.toContain('master-phrase')
  })
})

describe('reuse', () => {
  it('names the other entries holding the same password', () => {
    const audit = auditVault(
      [
        cred({ label: 'Bank', password: 'Shared-Password-9127' }),
        cred({ label: 'Router', password: 'Shared-Password-9127' }),
        cred({ label: 'Alone', password: 'Different-Password-4471' }),
      ],
      MASTER,
    )
    const bank = audit.all[0].findings.find((f) => f.kind === 'reused')
    expect(bank?.sharedWith).toEqual(['Router'])
    expect(audit.all[1].findings.find((f) => f.kind === 'reused')?.sharedWith).toEqual(['Bank'])
    expect(audit.all[2].findings).toHaveLength(0)
  })

  it('is exact — a one-character difference is a different password', () => {
    const audit = auditVault(
      [
        cred({ label: 'A', password: 'Shared-Password-9127' }),
        cred({ label: 'B', password: 'Shared-Password-9128' }),
        cred({ label: 'C', password: 'shared-password-9127' }),
      ],
      MASTER,
    )
    expect(audit.flagged).toHaveLength(0)
  })

  it('does not tie together entries that have no password at all', () => {
    const audit = auditVault(
      [cred({ label: 'A', password: '' }), cred({ label: 'B', password: '' })],
      MASTER,
    )
    expect(audit.all.every((a) => a.findings.every((f) => f.kind !== 'reused'))).toBe(true)
  })

  it('reports every member of a group of three', () => {
    const audit = auditVault(
      ['A', 'B', 'C'].map((label) => cred({ label, password: 'Shared-Password-9127' })),
      MASTER,
    )
    expect(audit.all.map((a) => a.findings[0].sharedWith)).toEqual([
      ['B', 'C'],
      ['A', 'C'],
      ['A', 'B'],
    ])
  })
})

describe('shape', () => {
  it('catches a word with a capital and digits bolted on', () => {
    // The case the ceiling arithmetic gets most wrong: four character classes,
    // 78 bits by that sum, and among the first things anyone would guess.
    expect(kindsOf('Password123!')).toContain('predictable-shape')
    expect(kindsOf('Summer2024')).toContain('predictable-shape')
    expect(kindsOf('monkey1')).toContain('predictable-shape')
  })

  it('catches a run and a repeat as their own thing', () => {
    expect(kindsOf('123456')).toContain('sequence')
    expect(kindsOf('abcdefgh')).toContain('sequence')
    expect(kindsOf('654321')).toContain('sequence')
    expect(kindsOf('aaaaaaaaaaaaaaaaaaaaaa')).toContain('repeat')
    // A repeat is not also reported as a single character class: one complaint
    // per password shape, and the run is the more useful one.
    expect(kindsOf('aaaaaaaaaaaaaaaaaaaaaa')).not.toContain('single-class')
  })

  it('leaves a long lowercase passphrase alone', () => {
    // Four random words is stronger than anything with a symbol in it at this
    // length, and flagging it would teach the user to distrust the panel.
    const audit = auditVault([cred({ label: 'Forum', password: 'walnut trellis harbour kiln' })], MASTER)
    expect(audit.flagged).toHaveLength(0)
  })

  it('leaves the generator’s output alone, every time', () => {
    // 200 draws, because a shape rule that fires on one password in fifty would
    // otherwise show up as a flake months from now rather than here.
    const drawn = Array.from({ length: 200 }, (_, i) =>
      cred({ label: `Site ${i}`, password: generateSitePassword(20) }),
    )
    expect(auditVault(drawn, MASTER).flagged).toHaveLength(0)
  })

  it('complains about one character class only while length still makes it matter', () => {
    expect(kindsOf('lowercaseonly')).toContain('single-class')
    // Twenty lowercase letters, and not a run — past the length where "add a
    // symbol" is advice worth giving.
    expect(kindsOf('walnuttrellisharbour')).not.toContain('single-class')
  })
})

describe('length', () => {
  it('is serious under twelve and critical under eight', () => {
    expect(auditVault([cred({ label: 'A', password: 'Kq7!vRt2' })], MASTER).all[0].verdict).toBe(
      'serious',
    )
    expect(auditVault([cred({ label: 'A', password: 'Kq7!vR' })], MASTER).all[0].verdict).toBe(
      'critical',
    )
  })

  it('refuses to call an empty password fine', () => {
    // Unreachable through the add/edit form, which requires a password — but a
    // vault restored from something that did not enforce that would otherwise
    // get a clean bill of health for an entry with nothing in it.
    expect(kindsOf('')).toContain('short')
    expect(verdictOf('')).toBe('critical')
  })

  it('leaves a twelve-character mixed password alone', () => {
    expect(auditVault([cred({ label: 'A', password: 'Kq7!vRt2Ls9#' })], MASTER).flagged).toHaveLength(0)
  })
})

describe('the vault-level summary', () => {
  const VAULT = [
    cred({ label: 'Zoo', password: 'Shared-Password-9127' }),
    cred({ label: 'Bank', password: 'Shared-Password-9127' }),
    cred({ label: 'Fine', password: 'Kq7!vRt2Ls9#xB' }),
    cred({ label: 'Awful', password: MASTER.join(' ') }),
  ]

  it('puts the worst first and orders ties by label', () => {
    const { flagged } = auditVault(VAULT, MASTER)
    expect(flagged.map((f) => f.label)).toEqual(['Awful', 'Bank', 'Zoo'])
  })

  it('breaks a tie within a severity band on the finding, not the label', () => {
    // Both critical. Alphabetically 'Forum' wins; by consequence it does not —
    // a guessed forum password costs one account, and the master passphrase on
    // a website costs every account and the house behind them.
    const { flagged } = auditVault(
      [
        cred({ label: 'Forum', password: '123456' }),
        cred({ label: 'Webmail', password: MASTER.join(' ') }),
      ],
      MASTER,
    )
    expect(flagged.every((f) => f.verdict === 'critical')).toBe(true)
    expect(flagged.map((f) => f.label)).toEqual(['Webmail', 'Forum'])
  })

  it('counts what the summary line needs and nothing more', () => {
    expect(auditVault(VAULT, MASTER).counts).toEqual({ total: 4, flagged: 3, critical: 1 })
  })

  it('keeps `all` in the order it was given, so callers can zip it against the list', () => {
    expect(auditVault(VAULT, MASTER).all.map((a) => a.label)).toEqual([
      'Zoo',
      'Bank',
      'Fine',
      'Awful',
    ])
  })

  it('is empty and calm for an empty vault', () => {
    expect(auditVault([], MASTER)).toEqual({
      all: [],
      flagged: [],
      counts: { total: 0, flagged: 0, critical: 0 },
    })
  })

  it('never carries a password out of the module', () => {
    // The screen cannot render what it was never handed. This is the assertion
    // that keeps that true as the shape of the result grows.
    const serialised = JSON.stringify(auditVault(VAULT, MASTER))
    expect(serialised).not.toContain('Shared-Password-9127')
    expect(serialised).not.toContain('Kq7!vRt2Ls9#xB')
    for (const word of MASTER) expect(serialised).not.toContain(word)
  })
})

/**
 * Every case below returned the wrong answer at some point during this pass and
 * was found by reading the rules against real strings rather than by a failing
 * test. They are here so that the next edit to a regex or a threshold has to
 * put them back deliberately.
 */
describe('the ways the rules were wrong', () => {
  // The two ways `fold` was wrong — a digit bolted on, and a phrase with no
  // ASCII letters in it — are covered where the master-phrase check is tested.

  it('treats a repeated word the way it treats a repeated letter', () => {
    // Doubling something adds length without adding anything to guess through,
    // and the ceiling arithmetic credits every character of it. Each of these
    // was clean when `repeat` meant one character.
    expect(kindsOf('passwordpassword')).toContain('repeat')
    expect(kindsOf('abc123abc123')).toContain('repeat')
    expect(kindsOf('monkeymonkeymonkey')).toContain('repeat')
    // Not everything that merely contains a repetition: this is four random
    // words, not one word four times.
    expect(kindsOf('walnut trellis harbour kiln')).not.toContain('repeat')
  })

  it('flags one character class by how little it buys, not only by length', () => {
    // Sixteen characters used to be the point where "you only used one kind of
    // character" went quiet. Sixteen lowercase letters is a fair place to stop
    // saying it; sixteen digits is 53 bits and just as likely to be a card
    // number as a password.
    expect(kindsOf('1234567890123456')).toContain('single-class')
    expect(kindsOf('4111111111111111')).toContain('single-class')
    // The case the ceiling exists to protect, still protected.
    expect(kindsOf('walnuttrellisharbour')).not.toContain('single-class')
  })

  it('does not let one digit past the cap drop the shape finding entirely', () => {
    // The regex has to match the whole string, so a digit run one longer than
    // the cap did not weaken the match — it removed it. `password1234` was
    // caught and `password12345` was clean.
    expect(kindsOf('password1234')).toContain('predictable-shape')
    expect(kindsOf('password12345')).toContain('predictable-shape')
  })

  it('does not let extra punctuation buy silence either', () => {
    // The same cliff, one cap over: the symbol run was capped at two, so
    // `Password123!` was flagged and `Password123!!!` — the same password,
    // typed more emphatically — came back with nothing to say. There is no
    // number of trailing exclamation marks that makes a password less guessable,
    // so there is no cap at which the finding should switch off.
    for (const password of [
      'Password123!',
      'Password123!!!',
      'Password2024$$$',
      'Baseball99!!!!',
      'Password123!?!',
    ]) {
      expect(kindsOf(password)).toContain('predictable-shape')
    }
  })

  it('sees the same shape shouted, and with a separator in the middle', () => {
    // One leading `[A-Z]?` cannot reach an all-caps word, and nothing modelled
    // the separator a person puts between the word and the year. Every one of
    // these was clean, and every one is the shape a site's complexity rule
    // produces.
    for (const password of [
      'PASSWORD1234',
      'PASSWORD2024!',
      'Summer 2024!',
      'summer-2024!!',
      'Sunshine_2024',
    ]) {
      expect(kindsOf(password)).toContain('predictable-shape')
    }
    // And the word run is still capped, which is what keeps a run-together
    // diceware phrase out of this finding however it is decorated.
    expect(kindsOf('walnuttrellisharbourkiln-2024!!')).toHaveLength(0)
  })

  it('does not call a run-together passphrase with a trailing mark a decorated word', () => {
    // The false positive that matters most, because it fires on the advice this
    // app gives. These are four random words and ~145 ceiling bits; being told
    // they are "a word with a capital in front and a digit or two behind" is
    // how a review panel gets dismissed wholesale, reused rows and all.
    for (const phrase of [
      'walnuttrellisharbourkiln!',
      'walnuttrellisharbourkiln2024',
      'thunderstormapproaching!',
    ]) {
      expect(kindsOf(phrase)).toHaveLength(0)
    }
  })

  it('gives one answer for a password however the keyboard composed it', () => {
    // The same eight accented characters: one code point each on one operating
    // system, two on another. Without composing first, one of these is eight
    // characters and critical and the other is sixteen and clean.
    const composed = 'é'.repeat(8)
    const decomposed = 'é'.repeat(8)
    // The two literals above are one composed character and one letter-plus-mark.
    // An editor that normalises this file on save would collapse them into the
    // same string, and the rest of this test would keep passing while proving
    // nothing — so assert they are still different before comparing verdicts.
    expect(decomposed).not.toBe(composed)
    expect(kindsOf(decomposed)).toEqual(kindsOf(composed))
    expect(verdictOf(decomposed)).toBe('critical')
  })

  it('sees reuse between two entries an import gave the same id', () => {
    // Self-exclusion used to be by id, so a vault carrying a duplicate id hid
    // the reuse rather than reporting it — and a sloppy import is precisely
    // where both a duplicate id and a repeated password come from.
    const audit = auditVault(
      [
        { ...cred({ label: 'Bank', password: 'Shared-Password-9127' }), id: 'X' },
        { ...cred({ label: 'Router', password: 'Shared-Password-9127' }), id: 'X' },
      ],
      MASTER,
    )
    expect(audit.all.map((a) => a.verdict)).toEqual(['serious', 'serious'])
    expect(audit.all[0].findings[0].sharedWith).toEqual(['Router'])
  })

  it('counts a large reuse group without naming every member of it', () => {
    // Naming all of them meant every entry in the group holding a list of every
    // other entry — quadratic in both time and retained memory, on the render
    // path, in the one case this finding exists to catch.
    const audit = auditVault(
      Array.from({ length: 40 }, (_, i) => cred({ label: `Site ${i}`, password: 'one-for-all-9127' })),
      MASTER,
    )
    const finding = audit.all[0].findings.find((f) => f.kind === 'reused')
    expect(finding?.sharedTotal).toBe(39)
    expect(finding?.sharedWith).toHaveLength(4)
    // Still exact for the sizes a hand-built vault actually reaches.
    const pair = auditVault(
      [cred({ label: 'A', password: 'p-9127-p' }), cred({ label: 'B', password: 'p-9127-p' })],
      MASTER,
    )
    expect(pair.all[0].findings[0].sharedTotal).toBe(1)
    expect(pair.all[0].findings[0].sharedWith).toEqual(['B'])
  })

  it('carries the position of each entry, not only its id', () => {
    // The panel has to get from a finding back to the credential it is about,
    // and `credentialId` cannot do that job: two entries can share an id, and a
    // lookup by id keeps the last of the pair. Both Fix buttons then opened the
    // same entry — and an edit patches every entry with that id, so one press
    // rewrote both passwords.
    const audit = auditVault(
      [
        { ...cred({ label: 'Bank', password: 'shared-9127-shared' }), id: 'dup' },
        { ...cred({ label: 'Router', password: 'shared-9127-shared' }), id: 'dup' },
      ],
      MASTER,
    )
    expect(audit.all.map((a) => a.index)).toEqual([0, 1])
    expect(audit.flagged.map((a) => a.index).sort()).toEqual([0, 1])
  })

  it('survives an entry that a vault this app did not write could contain', () => {
    // `decryptVault` checks that `entries` is an array and no further, and there
    // is no error boundary anywhere in the app — so a missing password threw
    // here and took the whole unlocked screen down with it: a vault that
    // decrypts perfectly, rendering as a blank page.
    const malformed = [
      { id: 'a', label: 'No password', url: '', username: '', notes: '', createdAt: 0, updatedAt: 0 },
      { id: 'b', password: 'Kq7!vRt2Ls9#xB', url: '', username: '', notes: '', createdAt: 0, updatedAt: 0 },
    ] as unknown as Parameters<typeof auditVault>[0]
    const audit = auditVault(malformed, MASTER)
    expect(audit.counts.total).toBe(2)
    // An entry with no password reads as an empty one, which the rules already
    // have an answer for, and an entry with no label still has to be nameable.
    expect(audit.all[0].findings.map((f) => f.kind)).toContain('short')
    expect(audit.all[1].label).toBe('Untitled entry')
  })

  it('stays linear when one password is on thousands of entries', () => {
    // `group.filter(i => i !== index)` copied the whole group for every member
    // of it before four names were taken off the front — quadratic work inside
    // a `useMemo` on the unlocked screen, which is the screen freezing for half
    // a second on exactly the import this finding exists to catch.
    const many = Array.from({ length: 4000 }, (_, i) =>
      cred({ label: `Site ${i}`, password: 'one-for-all-9127' }),
    )
    const started = Date.now()
    const audit = auditVault(many, MASTER)
    // Deliberately loose: this is here to catch a return to quadratic, which was
    // half a second at this size and four seconds at twice it — not to police
    // milliseconds on whatever machine happens to run the suite.
    expect(Date.now() - started).toBeLessThan(1000)
    expect(audit.all[0].findings.find((f) => f.kind === 'reused')?.sharedTotal).toBe(3999)
  })
})
