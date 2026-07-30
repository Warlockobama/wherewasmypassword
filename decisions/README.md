# Decision docs

When a task needs a decision that can't be resolved from the codebase, the
plan, or sensible defaults, the working agent does NOT guess and does NOT
block: it writes a numbered doc here (`NNNN-short-title.md`), records the
question + a recommended default, then moves on to other independent work.
James (or a later session) resolves it; the doc is the durable record.

Each doc: **Status** on its own line near the top (`**Status:** OPEN — ...`),
the locked direction, what was tried, the specific decision(s) needed with a
recommended default, and the acceptance criteria for resuming. A doc counts
as open only while its Status value LEADS with the word OPEN. Keep them
short. One decision (or a tight cluster) per file.

## How resolutions arrive

James's exec assistant watches this folder: OPEN docs surface in his morning
briefing and get talked over in conversation. His rulings land back in the
doc as an appended `## RESOLUTION (user call, YYYY-MM-DD — via exec
assistant)` section — numbered rulings with his verbatim words — and the
Status line flips to RESOLVED. Interim direction arrives as `## UPDATE ...`
sections with the Status left OPEN. Treat a RESOLUTION exactly like James
typing the decision into your session.

## The pickup log: GUIDANCE.md

Every recorded ruling also appends one line to `GUIDANCE.md` in this folder
(`- DATE RESOLVED|UPDATE NNNN-file.md — first line`). Long-running sessions
poll that single file between slices (~30 min) and re-read the referenced
doc when a new line appears. Append-only; the assistant owns it.

James can also send instructions unprompted: a doc with
`**Status:** DIRECTIVE (user, DATE — via exec assistant)` and a
`## The directive` section is a James-initiated instruction — same
authority as a RESOLUTION, logged in GUIDANCE.md as a `DIRECTIVE` line.
