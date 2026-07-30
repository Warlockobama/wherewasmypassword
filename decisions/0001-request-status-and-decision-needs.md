# 0001 — Request status and decision needs

**Status:** DIRECTIVE (user, 2026-07-29 — via exec assistant)

## The directive

James requests a status update. Please summarize current progress, what's actively being worked, what's blocked, and explicitly list any decisions that need James's input. If no decisions are needed, say so and suggest the next sensible step.

## Status report (2026-07-29)

**Current progress.** The v1 app is feature-complete and all gates pass
(22/22 tests, TypeScript clean, production build clean). Implemented:
tutorial + demo walk, diceware passphrase generation (2,257 picturable
words), 8-locus memory palace with SVG rooms and resident anchors,
placement journeys with coaching, training gauntlet (forward/backward/
random/mastery), Argon2id (64 MiB) + AES-256-GCM vault, encrypted
backup export/import, SRS practice schedule, and auto-lock. MV3
extension manifest is in place.

**Actively being worked.** Nothing in-flight — this session was dispatched
solely for this status check.

**Blocked / decisions needed.** Nothing. No open decision docs.

**Suggested next step.** The v2 credential storage feature is the natural
next piece of work. The data model has a placeholder (`VaultData.entries:
unknown[]`) and the UI says "coming in v2." James should decide scope and
UX when he's ready — questions like: autofill vs. copy-paste, site
matching strategy, and whether entries get their own encryption layer.
No rush; v1 is shippable as-is.
