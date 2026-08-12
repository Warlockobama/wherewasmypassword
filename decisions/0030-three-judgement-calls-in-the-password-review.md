# 0030 — Three judgement calls left in the password review

**Status:** RESOLVED (user call, 2026-08-12) — see the resolution at the bottom.

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

## RESOLUTION (user call, 2026-08-12 — via exec assistant)

1. **Adopt the recommended changes.** James said "yeah, go with that", so implement the three recommended adjustments: escalate `single-class` severity when `ceilingBits` is well below the floor, trim surrounding whitespace only for the reuse grouping key (not for stored-string checks like length, shape, or master-phrase comparison), and darken the panel badges and the "what this cannot see" caveat for contrast within the panel.
2. **No app-wide visual sweep in this change.** Keep the contrast update scoped to the panel; any broader palette/contrast pass is a separate future decision or task.

## What was done (2026-08-12)

All three, as recommended, and nothing outside the panel moved.

**1. Severity.** `single-class` is `serious` below `SINGLE_CLASS_SERIOUS_BITS`
(60) and `minor` above it. `4111111111111111` (53 bits) and
`123456789012345` (50) now sort with the findings that matter; `lowercaseonly`
(61) stays Minor, which is the line the test pins so that moving it is a
deliberate act. The ceiling still never reaches the copy — it chooses the label
and the order, which was the module's own rule for it.

**2. Reuse.** Grouping is on `password.trim()` and nothing else is. Length,
shape, class count and the master-phrase comparison all still see the string as
stored, because the space really is in what the site was given: `Kq7!vRt2Ls9 `
is twelve characters and its untrimmed twin is eleven, so `short` still fires on
one and not the other. A password that is *only* whitespace groups with nothing,
for the same reason an empty one does not.

**3. Contrast.** Measured against the real composite — `bg-parchment-dark/60`
over `bg-parchment`, tints and text opacities blended — rather than against the
panel colour named in the markup:

| element | before | now |
|---|---|---|
| "Fix this first" | 3.08:1 | **5.06:1** |
| "Minor" | 3.56:1 | **7.16:1** |
| the "what this cannot see" caveat | 2.97:1 | **4.70:1** |

The badges keep their tint and border; only the words darkened. "Minor" and the
caveat needed no new colour — `text-dusk` and `text-dusk/80`, the weight the
body copy beside them already uses. `brick` as *text* cannot reach 4.5:1 on its
own tint at any opacity, so `--color-brick-deep` (`#8a4630`) exists for that one
job and says so where it is declared. It is used by this panel and nowhere else,
which is what keeps the ruling's second half true.

**Status:** RESOLVED, and the app-wide `text-dusk/50`–`/60` question the doc
raised is left where James put it — a separate piece of work, not started.
