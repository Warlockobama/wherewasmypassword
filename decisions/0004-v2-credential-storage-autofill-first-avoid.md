# 0004 — v2 credential storage: autofill-first, avoid clipboard

**Status:** DIRECTIVE (user, 2026-07-29 — via exec assistant)

## The directive

For v2 credential storage, prioritize autofill over copy-paste — James wants passwords "kept off the clipboard when possible" since it's more secure (other apps, clipboard managers, and cloud clipboard sync can all read it). Autofill should inject credentials directly into the login field without touching the system clipboard. Copy-paste can remain as a fallback only for sites where autofill can't reliably match the field, and if clipboard copy is used at all, it should auto-clear after a short window (30-45 seconds). Proceed with scoping and design on this basis.
