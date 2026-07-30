# 0011 — Autofill is broken: popup, remembered tab, or drop it

**Status:** OPEN — highest priority of the four open calls. Split out of `0009`.

## The problem, confirmed in a real browser

**Autofill has never worked, at all.** Not "fills the wrong field" — it cannot
fill anything. Until this is answered, every password goes via the clipboard,
which is exactly what directive `0004` asked us to avoid.

The test is `app/scripts/autofill-check.mjs` (`npm run build && npm run
autofill`). It loads the real packed extension into a real browser, serves a
real login page, and clicks the real button. Every fill attempt fails with
*"Cannot access contents of the page. Extension manifest must request
permission to access the respective host."*

The cause is the permission model, not a bug in the fill code. `activeTab` is
granted for whichever tab was active when the toolbar icon was clicked — and
the first thing the icon does is open the app in a **new** tab, which then
becomes the active one. The grant sits on the page the user was looking at,
while the fill request targets the extension's own tab, which can never be
scripted. No ordering of clicks fixes this from a full tab.

The same run shows the rest of the fill path is sound: re-run with a host
permission added (a diagnostic, not something we would ship) and 12 of 13
checks pass — origin check refuses a look-alike page, honours an explicit
approval and refuses a stale one, skips hidden/tiny/transparent/off-screen/
disabled/covered fields, picks the login form over the newsletter box, and
does not stack listeners across repeated fills.

## The decision — one of three

1. **Add a compact popup** (unlock, search, fill) and keep the full tab for
   training and palace walks. This is the standard fix: it aligns the
   permission grant, the active tab, and the user's intent. *Recommended.*
2. **Keep the full tab, remember the target.** Capture the tab from
   `chrome.action.onClicked`'s `tab` argument at click time and fill *that*
   tab. No new permission, no new UI, much the smaller change — but less
   obvious to the user: they click the icon on the login page, walk their
   house, and the fill lands back where they came from.
3. **Accept that autofill does not work** and make the clipboard the only
   path — in which case the Autofill button should be removed rather than
   left sitting there failing.

Requesting broad host permissions is the fourth possibility and is **not
recommended**: it works against the local-only, minimal-permission posture.

## Acceptance criteria for resuming

Any one of the three answers unblocks the work immediately; option 2 could
ship the same day, option 1 in a day or so. The autofill test already exists
and will verify whichever path is chosen.
