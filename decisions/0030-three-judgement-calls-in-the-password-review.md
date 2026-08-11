# 0030 — Three judgement calls left in the password review

**Status:** OPEN — three small product calls, one doc, none of them blocking.

## Why this exists

An audit of the review panel (`decisions/0026`) turned up nine things. Six were
plain defects and are fixed and tested in `011e60b` — a shape rule that went
quiet on the passwords it exists to catch, a Fix button that could edit the
wrong entry, a malformed entry that took the whole unlocked screen down, a
quadratic scan on the render path, and two accessibility gaps.

These three are not defects. Each is a place where the module made a deliberate
choice, and the choice is arguably wrong — which makes it James's rather than
mine to overturn.

## 1. `single-class` is always "Minor", however weak the password

`ceilingBits` is computed for every entry and never affects severity. So:

- `123456789012345` — fifteen digits, 50 bits — is **Minor**, rendered as
  "Only one kind of character."
- `4111111111111111` — a card number, 53 bits, the exact case the tests were
  written for — is **Minor**.
- `Password123!` — 79 bits by the same arithmetic, and far more guessable in
  practice — is **Serious**.

A 50-bit password is crackable offline; "Minor" is the wrong word for it. The
fix is one condition: escalate `single-class` to `serious` when `ceilingBits`
falls well below `SINGLE_CLASS_BITS_FLOOR`. The reason it is a call and not a
patch is that severity is what the panel *says to the user*, and the module's
stated position is that the ceiling is never to be used as a measurement.

**Recommended:** escalate below roughly 60 bits. It keeps the ceiling out of the
copy while letting it order the list.

## 2. Reuse is exact, so a stray space hides it

`Kq7!vRt2Ls9#xB` and `Kq7!vRt2Ls9#xB ` on two entries are reported as two
unrelated passwords: `{ total: 2, flagged: 0 }`, both clean. Exactness is
deliberate and tested — "two passwords differing by one character are two
passwords" — and for case that is plainly right. Surrounding whitespace is
different in kind: it is what a copy-paste or a phone keyboard does to *the
same* password, not a different one someone chose.

**Recommended:** trim for the grouping key only — never for length, shape or the
master-phrase comparison, which must keep seeing the string as stored. The
exactness argument survives intact; what changes is that one password on two
sites is reported as one password on two sites.

## 3. The panel's own caveat is the least legible text on it

Computed against the palette in `index.css`, over the panel background:

| element | contrast | needs |
|---|---|---|
| "Fix this first" (`text-brick` on `bg-brick/10`) | 3.07:1 | 4.5:1 |
| "Minor" (`text-dusk/70` on `bg-dusk/5`) | 3.30:1 | 4.5:1 |
| the "what this cannot see" paragraph (`text-dusk/60`, 12px) | 2.83:1 | 4.5:1 |

All three are normal-size text, so WCAG AA wants 4.5:1. The body copy beside
them (`text-dusk/80`) computes to 4.57:1 and passes, so the palette is not the
problem — the opacities are. The third row is the one that stings: it is the
sentence the code argues hardest for, the one that stops a clean panel reading
as "your passwords are strong", and it is the hardest thing on the page to read.

The complication, and the reason this is not just fixed: `text-dusk/50`–`/60` is
used across the app (the unlocked screen, the housekeeping notes), so a fix that
stops at this panel makes it inconsistent, and one that does not stop here is a
sweep through the app's visual language.

**Recommended:** darken the two badges and the caveat here now (they are new
with this feature, so nothing else moves), and treat an app-wide contrast pass
as its own piece of work if James wants one.

## Acceptance criteria for resuming

Any answer, including "just the third one" or "your call". Each is small enough
to land in an afternoon and none blocks anything else.
