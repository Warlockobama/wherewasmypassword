# WhereWasMyPassword — session ground rules

A browser-extension password manager that teaches users to genuinely
memorize a strong diceware master passphrase via the method of loci (an
illustrated memory house with placement journeys and training gauntlets),
backed by an Argon2id / AES-256-GCM encrypted local-only vault.

The active v1 lives in `app/` (TypeScript/Vite). `wherewasmypassword/`,
`go_wwmp/`, and `deeps/` are dead Street-View-based prototypes — don't
build on them.

Security posture: local-only vault, no telemetry, no network sync. Treat
any change that touches key derivation, encryption, or storage as
security-sensitive: prefer parking a decision doc over guessing.

## The decision bridge (James's exec assistant ⇄ this repo)

James talks decisions over with his exec assistant by voice; its rulings
land in this repo. Two files matter:

1. **`decisions/NNNN-short-title.md`** — when you hit a design, UX, or
   security call you can't settle from the code or a sensible default:
   do NOT block and do NOT guess. Write a numbered doc (Status: OPEN,
   the question, what you tried, a recommended default — see
   `decisions/README.md`) and move on to independent work. This is the
   channel for ANY "input needed from James" — small questions get
   small docs.

2. **`decisions/GUIDANCE.md`** — append-only log the assistant writes
   when James records a ruling. Check it at session start AND between
   tasks during long autonomous runs (at least once every ~30 minutes).
   A `RESOLVED` or `DIRECTIVE` entry is a user ruling/instruction —
   usually your new top priority.
   Never edit or truncate it.

A doc's `## RESOLUTION (user call, … — via exec assistant)` section is
James's decision verbatim — same authority as him typing it into your
session.
