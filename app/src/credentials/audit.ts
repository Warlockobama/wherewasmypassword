import type { Credential } from './types.ts'

/**
 * A weak-and-reused pass over the credentials already decrypted in memory
 * (`decisions/0026`).
 *
 * Three things constrain what this is allowed to be, and they decide most of
 * what follows:
 *
 * 1. **No network.** The useful version of "is this password weak" is a breach
 *    corpus, and this extension makes no network requests at all — not as an
 *    oversight but as the thing it promises. So this pass is built only from
 *    what the vault itself can answer.
 * 2. **No dictionary either.** A bundled word list would need no network, but a
 *    few thousand words is enough to feel authoritative and nowhere near enough
 *    to be, and "not in our list" reads as "safe". Every check below is instead
 *    structural: it either holds for a string or it does not, with no corpus to
 *    be out of date.
 * 3. **Nothing leaves this module.** The functions here take plaintext
 *    passwords, because the vault is open and they are already in memory — but
 *    the results deliberately carry only an id, a length and a verdict. A
 *    password cannot be printed by a screen that was never handed one.
 *
 * The honest consequence of 1 and 2 is that a clean result here means "none of
 * the things this can see", not "strong". `ceilingBits` below is named for that
 * reason.
 */

export type FindingKind =
  /** The site password is the vault's own master passphrase. */
  | 'master-phrase'
  /** The same password is on more than one entry. */
  | 'reused'
  /** Too few characters for the alphabet to matter. */
  | 'short'
  /** Drawn from one character class, at a length where that still costs. */
  | 'single-class'
  /** A word with a capital and/or a few digits bolted on — the classic shape. */
  | 'predictable-shape'
  /** The whole password is a run of adjacent characters: 123456, abcdef. */
  | 'sequence'
  /** The whole password is one short unit repeated: aaaa, abcabc, passwordpassword. */
  | 'repeat'

/** How much a finding matters. Ordered worst first by `SEVERITY_RANK`. */
export type Severity = 'critical' | 'serious' | 'minor'

export type Verdict = Severity | 'ok'

const SEVERITY_RANK: Record<Verdict, number> = {
  critical: 0,
  serious: 1,
  minor: 2,
  ok: 3,
}

/**
 * Order within a severity band, worst first.
 *
 * Severity alone is too coarse to sort on: a forum password of `123456` and the
 * master passphrase on a webmail account are both critical, and falling back to
 * alphabetical order from there would put the forum first about half the time.
 * They are not equivalent — one loses an account, the other loses every account
 * plus the house — so the kind of finding breaks the tie before the label does.
 */
const KIND_RANK: Record<FindingKind, number> = {
  'master-phrase': 0,
  reused: 1,
  repeat: 2,
  sequence: 3,
  short: 4,
  'predictable-shape': 5,
  'single-class': 6,
}

export interface Finding {
  kind: FindingKind
  severity: Severity
  /**
   * Labels of the other entries sharing this password — `reused` only.
   *
   * Labels rather than ids because this exists to be read out on screen, and
   * "also on Bank and Router" is the whole of the advice.
   *
   * Capped at `REUSE_NAMES_KEPT`. A vault where one password is on four hundred
   * entries — the shape an import produces, and exactly the shape this finding
   * exists to catch — would otherwise build four hundred label lists of four
   * hundred names each and hold them all for as long as the panel is open.
   * `sharedTotal` carries the number the sentence actually needs.
   */
  sharedWith?: string[]
  /** How many other entries share this password, whether or not all are named. */
  sharedTotal?: number
}

export interface CredentialAudit {
  credentialId: string
  /**
   * Position in the `credentials` array this audit was made from.
   *
   * Carried because `credentialId` is not reliably unique — the reuse grouping
   * below excludes an entry from its own group by position for exactly that
   * reason, since excluding by id let two entries sharing an id hide the reuse
   * between them. A panel that then looked an entry back up by id would undo
   * that: `new Map(credentials.map(c => [c.id, c]))` keeps the last of a
   * duplicate pair, so the Fix button on the first row would open the second
   * row's entry — and the edit that followed would patch both.
   */
  index: number
  label: string
  length: number
  /**
   * What this password would be worth *if every character had been chosen at
   * random* from the alphabet its character classes imply — a ceiling, never a
   * measurement.
   *
   * `Password123!` reaches 78 by this arithmetic and is one of the first
   * passwords anyone would try. That gap is the reason the structural findings
   * exist and the reason this number is never shown on its own.
   */
  ceilingBits: number
  classes: CharacterClasses
  findings: Finding[]
  /** The worst severity present, or `ok` when nothing fired. */
  verdict: Verdict
}

export interface CharacterClasses {
  lower: boolean
  upper: boolean
  digit: boolean
  symbol: boolean
  /** Anything outside printable ASCII — accents, emoji. */
  other: boolean
}

export interface VaultAudit {
  /** Every entry, in the order given. */
  all: CredentialAudit[]
  /**
   * Only those with findings: worst severity first, then by the kind of finding
   * driving that severity (`KIND_RANK`), then alphabetically by label.
   */
  flagged: CredentialAudit[]
  counts: { total: number; flagged: number; critical: number }
}

/**
 * Below this, no alphabet saves you — the ceiling for 11 random characters over
 * every printable ASCII key is around 72 bits, and the floor for 11 characters
 * a person made up is far lower.
 */
const SHORT_LENGTH = 12

/** Below this a password is short enough to be worth saying so loudly. */
const VERY_SHORT_LENGTH = 8

/**
 * Past this length, "you only used lowercase" is cosmetic advice: a 20-character
 * lowercase passphrase is stronger than a 10-character one with a symbol in it,
 * and telling its owner otherwise trains them to trust the wrong signal. The
 * long single-class passwords that genuinely are bad — a run, a repeated
 * character — are caught by their own findings instead.
 */
const CLASS_ADVICE_CEILING = 16

/**
 * …except that length alone is the wrong gate, because it is blind to which
 * single class was used. Sixteen lowercase letters reach a ceiling of 75 bits;
 * sixteen digits reach 53, and a sixteen-digit string is as likely to be a card
 * number as a password. So the advice also fires below this ceiling regardless
 * of length, which catches the digit-only cases without dragging long
 * lowercase passphrases back in with them.
 */
const SINGLE_CLASS_BITS_FLOOR = 70

/**
 * …and below *this* ceiling, "Minor" is the wrong word entirely.
 *
 * `4111111111111111` — sixteen digits, 53 bits, a card number — was reported in
 * the same breath as "you could add a capital". Fifty bits is a password an
 * offline attack finishes, and the panel's severity is what the user reads
 * (`decisions/0030`). The ceiling still never appears in the copy; it is allowed
 * to order the list rather than to describe anything, which is the line the
 * module drew for it in the first place.
 */
const SINGLE_CLASS_SERIOUS_BITS = 60

/**
 * How many other entries a `reused` finding names before it starts counting
 * instead. Four is what the sentence can carry out loud; past that "and 96
 * others" is both shorter and more alarming, which is the correct effect.
 */
const REUSE_NAMES_KEPT = 4

/**
 * The longest lowercase run `looksLikeDecoratedWord` will treat as "a word".
 * Without a bound the rule matches any run-together lowercase phrase with a
 * trailing `!`, so `walnuttrellisharbourkiln!` — four random words and 147
 * ceiling bits — would be reported as the shape a site's complexity rule
 * produces. Flagging that trains the user to dismiss the panel.
 */
const WORD_RUN_MAX = 12

// Pool sizes for the ceiling arithmetic. `symbol` is the 32 printable ASCII
// punctuation characters plus space; `other` is a deliberately rough stand-in,
// since the alphabet someone draws an emoji or an accented letter from is not
// knowable from one sample.
const POOL = { lower: 26, upper: 26, digit: 10, symbol: 33, other: 64 } as const

export function characterClasses(password: string): CharacterClasses {
  const classes: CharacterClasses = {
    lower: false,
    upper: false,
    digit: false,
    symbol: false,
    other: false,
  }
  for (const ch of password) {
    const code = ch.codePointAt(0) ?? 0
    if (ch >= 'a' && ch <= 'z') classes.lower = true
    else if (ch >= 'A' && ch <= 'Z') classes.upper = true
    else if (ch >= '0' && ch <= '9') classes.digit = true
    else if (code >= 0x20 && code <= 0x7e) classes.symbol = true
    else classes.other = true
  }
  return classes
}

/** The ceiling described on `CredentialAudit.ceilingBits`. */
export function ceilingBits(password: string): number {
  if (password.length === 0) return 0
  const classes = characterClasses(password)
  let pool = 0
  for (const [name, present] of Object.entries(classes)) {
    if (present) pool += POOL[name as keyof CharacterClasses]
  }
  // Unreachable while the string is non-empty — every character lands in some
  // class — but a pool of 0 or 1 would produce -Infinity or 0 bits silently.
  // Written as a negated `>=` so that a NaN pool, which `<` would wave through,
  // lands here too.
  if (!(pool >= 2)) return 0
  // Counted in code points rather than `.length` so a password containing
  // anything outside the basic plane is not credited twice for one character.
  return Math.round([...password].length * Math.log2(pool))
}

/**
 * A single word with a capital in front and/or a few digits and one or two
 * punctuation marks behind it.
 *
 * This is the shape the ceiling arithmetic most overrates, and it is worth
 * catching precisely because it is what someone produces when a site demands
 * "a capital, a number and a symbol". Requiring the decoration is what keeps it
 * distinct from `single-class`: a bare lowercase word is a different complaint.
 */
/**
 * Built once rather than per call.
 *
 * The runs of decoration are unbounded on purpose, and that is the whole lesson
 * of this rule: it is anchored at both ends, so decoration it does not model
 * does not weaken the match, it *removes* it. A digit cap meant `password1234`
 * was caught and `password12345` was clean; raising the cap to eight only moved
 * the cliff, and a symbol cap of two left `Password123!` flagged while
 * `Password123!!!` — the same password, one keypress more emphatic — came back
 * with nothing to say. Runs that end the string cost a guess nothing, so there
 * is no length at which they should buy silence.
 *
 * The three things that *are* modelled beyond the bare word: an all-caps run
 * (`PASSWORD2024`, which one leading `[A-Z]?` cannot reach), a single separator
 * between the word and its digits (`Summer-2024!`, `summer 2024`), and either
 * kind of trailing run in any amount.
 *
 * The word-run cap is different in kind and stays: it is what keeps a
 * run-together diceware phrase with a `!` on the end out of the finding
 * (`WORD_RUN_MAX`). And an anchored rule always has an edge somewhere —
 * `Sunshine_2024ab` is still clean, because letters after the digits are a
 * shape this does not claim to know. What it must not have is an edge that a
 * *more* decorated password falls off.
 */
const DECORATED_WORD = new RegExp(
  `^(?:[A-Z]?[a-z]{2,${WORD_RUN_MAX}}|[A-Z]{2,${WORD_RUN_MAX}})([^A-Za-z0-9]?)([0-9]*)([^A-Za-z0-9]*)$`,
)

function looksLikeDecoratedWord(password: string): boolean {
  const match = DECORATED_WORD.exec(password)
  if (!match) return false
  // A bare word is `single-class`'s complaint, not this one; the decoration is
  // what makes the shape worth naming. The separator counts as decoration —
  // `summer-` is a word someone dressed up, however thinly.
  return match[1].length + match[2].length + match[3].length >= 1
}

/**
 * The whole string is one short unit repeated: `aaaa`, `1111`, `abcabc`,
 * `passwordpassword`.
 *
 * A single repeated character is the obvious case, but the general one is worth
 * the same complaint and costs nothing extra to see: doubling a word doubles the
 * length while adding nothing a guess has to work through, and the ceiling
 * arithmetic credits the whole of it. This stays inside the no-dictionary rule —
 * it never asks what the unit *is*, only that the password is made of copies
 * of it.
 */
function isRepeat(password: string): boolean {
  const chars = [...password]
  if (chars.length < 3) return false
  // Only units short enough that repeating them is a shortcut rather than a
  // coincidence, and only whole numbers of copies.
  for (let unit = 1; unit <= Math.min(WORD_RUN_MAX, chars.length / 2); unit++) {
    if (chars.length % unit !== 0) continue
    if (chars.every((ch, i) => ch === chars[i % unit])) return true
  }
  return false
}

/** The whole string is a run of adjacent code points, up or down: `abcd`, `4321`. */
function isSequence(password: string): boolean {
  const chars = [...password]
  if (chars.length < 3) return false
  const step = (chars[1].codePointAt(0) ?? 0) - (chars[0].codePointAt(0) ?? 0)
  if (step !== 1 && step !== -1) return false
  return chars.every(
    (ch, i) => i === 0 || (ch.codePointAt(0) ?? 0) - (chars[i - 1].codePointAt(0) ?? 0) === step,
  )
}

/**
 * Case, separators and digits folded away, so that `correct horse battery`,
 * `Correct-Horse-Battery`, `correcthorsebattery` and `correcthorsebattery2024`
 * are recognised as the same phrase. Someone who typed their master passphrase
 * into a site's password box did not necessarily type it the way the house
 * spells it — and "the site demanded a number" is the single most likely reason
 * it does not match character for character.
 *
 * Digits go rather than stay because the wordlists are alphabetic: no master
 * phrase contains a digit, so keeping them could only ever let a decorated copy
 * of the phrase through. `1correcthorsebattery…` was clean before this did.
 *
 * `\p{L}` rather than `a-z` so a phrase in a non-Latin script folds to itself
 * instead of to the empty string — which the guard in `auditPassword` reads as
 * "this vault has no phrase to compare against", silently turning off the most
 * important check in the module.
 */
function fold(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}]/gu, '')
}

/**
 * The findings for one password, given the folded master phrase and the labels
 * of any other entries using the same string.
 */
function auditPassword(
  password: string,
  foldedMaster: string,
  sharedWith: string[],
  sharedTotal: number,
): Finding[] {
  const findings: Finding[] = []
  const length = [...password].length

  // First, because it is the one failure this product can produce that a
  // general password manager cannot: the phrase the whole memory house exists
  // to protect, handed to a website. A breach there is a breach of the vault,
  // and no amount of Argon2id in front of it matters.
  if (foldedMaster !== '' && fold(password) === foldedMaster) {
    findings.push({ kind: 'master-phrase', severity: 'critical' })
  }

  if (sharedTotal > 0) {
    findings.push({ kind: 'reused', severity: 'serious', sharedWith, sharedTotal })
  }

  // Not guarded on `length > 0`. The add/edit form refuses an empty password, so
  // a zero-length one means a vault restored from somewhere that did not — and
  // answering "nothing wrong here" about it would be the one clearly false thing
  // this pass could say.
  if (length < SHORT_LENGTH) {
    findings.push({
      kind: 'short',
      severity: length < VERY_SHORT_LENGTH ? 'critical' : 'serious',
    })
  }

  if (isRepeat(password)) {
    findings.push({ kind: 'repeat', severity: 'critical' })
  } else if (isSequence(password)) {
    findings.push({ kind: 'sequence', severity: 'critical' })
  } else if (looksLikeDecoratedWord(password)) {
    findings.push({ kind: 'predictable-shape', severity: 'serious' })
  } else {
    // Only when none of the shapes above fired, so a run of digits is reported
    // as a run rather than as "you only used one character class".
    const classes = characterClasses(password)
    const count = Object.values(classes).filter(Boolean).length
    const bits = ceilingBits(password)
    const thin = length < CLASS_ADVICE_CEILING || bits < SINGLE_CLASS_BITS_FLOOR
    if (count === 1 && length > 0 && thin) {
      findings.push({
        kind: 'single-class',
        severity: bits < SINGLE_CLASS_SERIOUS_BITS ? 'serious' : 'minor',
      })
    }
  }

  return findings
}

/** The worst severity in a list of findings. */
function worst(findings: Finding[]): Verdict {
  return findings.reduce<Verdict>(
    (acc, f) => (SEVERITY_RANK[f.severity] < SEVERITY_RANK[acc] ? f.severity : acc),
    'ok',
  )
}

/**
 * Audit every stored credential.
 *
 * `masterWords` is `VaultData.words` — the diceware phrase itself. It is passed
 * in rather than read from anywhere so that this stays a pure function of its
 * arguments, and so the one caller that has no business seeing it can pass `[]`.
 */
export function auditVault(credentials: Credential[], masterWords: string[]): VaultAudit {
  const foldedMaster = fold(masterWords.join(''))

  /**
   * Composed form, everywhere, before anything is measured or compared.
   *
   * The same eight accented characters are eight code points typed on one
   * operating system and sixteen typed on another. Without this, one of those
   * is `critical [short, repeat]` and the other is a clean sixteen-character
   * password — the same password, two opposite verdicts.
   */
  const normalised = credentials.map((cred) =>
    // Typed as a string, but this vault may have been restored from a file this
    // app did not write: `decryptVault` checks that `entries` is an array and
    // stops there. A missing password used to throw here, and with no error
    // boundary anywhere in the app that took the whole unlocked screen down —
    // a vault that decrypts perfectly, rendering as a blank page. An entry with
    // no password is instead the empty string, which the rules below already
    // have an answer for.
    (typeof cred.password === 'string' ? cred.password : '').normalize('NFC'),
  )
  // Same reasoning, and the sort at the bottom calls `localeCompare` on it.
  const labels = credentials.map((cred) =>
    typeof cred.label === 'string' && cred.label !== '' ? cred.label : 'Untitled entry',
  )

  // Grouped on the exact string, with surrounding whitespace off the key and
  // nothing else: two passwords differing by one character are two passwords,
  // and treating them as related would need the fuzzy matching this pass
  // deliberately does not do. A trailing space is different in kind — it is what
  // a copy-paste or a phone keyboard does to the *same* password, not a
  // different one someone chose, and without this `x` and `x ` on two sites were
  // reported as two unrelated passwords, both clean (`decisions/0030`).
  //
  // The key and only the key. Length, shape, the class count and the
  // master-phrase comparison all keep seeing the string as it is stored, because
  // the space really is in the password the site was given.
  const groupKey = (password: string) => password.trim()
  const byPassword = new Map<string, number[]>()
  normalised.forEach((password, index) => {
    // An entry with no password is not "shared with" every other empty one —
    // and after trimming, neither is one that is nothing but spaces.
    const key = groupKey(password)
    if (key === '') return
    const group = byPassword.get(key)
    if (group) group.push(index)
    else byPassword.set(key, [index])
  })

  const all = credentials.map((cred, index) => {
    const password = normalised[index]
    // Grouped by position rather than by id, so that two entries an import gave
    // the same id still count as two entries. Excluding by id let a duplicate
    // id hide the reuse entirely.
    const group = byPassword.get(groupKey(password)) ?? []
    // Counted and scanned rather than filtered. `group.filter(i => i !== index)`
    // built a copy of the whole group for every member of it before four names
    // were taken off the front and the rest thrown away — quadratic work on the
    // synchronous render path, which is half a second of a frozen screen on the
    // eight-thousand-entry import this finding exists for. The count is
    // arithmetic and the names are the first few of a list already in hand.
    const sharedTotal = group.length > 0 ? group.length - 1 : 0
    const sharedWith: string[] = []
    for (const i of group) {
      if (sharedWith.length >= REUSE_NAMES_KEPT) break
      if (i !== index) sharedWith.push(labels[i])
    }
    const findings = auditPassword(password, foldedMaster, sharedWith, sharedTotal)
    return {
      credentialId: cred.id,
      index,
      label: labels[index],
      length: [...password].length,
      ceilingBits: ceilingBits(password),
      classes: characterClasses(password),
      findings,
      verdict: worst(findings),
    }
  })

  const worstKind = (entry: CredentialAudit) =>
    entry.findings.reduce((rank, f) => Math.min(rank, KIND_RANK[f.kind]), Number.MAX_SAFE_INTEGER)

  const flagged = all
    .filter((a) => a.verdict !== 'ok')
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.verdict] - SEVERITY_RANK[b.verdict]
      if (bySeverity !== 0) return bySeverity
      const byKind = worstKind(a) - worstKind(b)
      if (byKind !== 0) return byKind
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    })

  return {
    all,
    flagged,
    counts: {
      total: all.length,
      flagged: flagged.length,
      critical: all.filter((a) => a.verdict === 'critical').length,
    },
  }
}
