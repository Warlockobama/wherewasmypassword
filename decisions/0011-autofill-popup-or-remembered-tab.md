# 0011 — Autofill is broken: popup, remembered tab, or drop it

**Status:** RESOLVED (user call, 2026-07-31) — see the resolution at the bottom.

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

## RESOLUTION (user call, 2026-07-31 — via exec assistant)

1. **Ship the compact popup flow**: James chose the recommended default, saying "let’s go with the recommendation." Implement a compact popup for unlock, search, and fill, and keep the full tab for training and walkthroughs.
2. **Align permissions and intent**: Ensure the popup flow aligns the permission grant with the active tab and the user’s target page, avoiding broad host permissions.
3. **Verify with the existing test**: Use the existing autofill test to confirm the chosen path works end-to-end before release.

## IMPLEMENTED (2026-07-31)

Built as ruled. `action.default_popup` now points the toolbar button at a compact
`popup.html` — unlock, search, fill — and the memory house stays a full tab,
opened from a link in the popup (with `default_popup` set, `action.onClicked`
can never fire, so the worker gained a `wwmp-open-app` message and lost its click
handler). The popup resolves the target tab once, shows the user its origin, and
sends that tab id with the fill, so the password lands in the page they were told
about rather than in whatever is active a moment later. Permissions are unchanged
and unbroadened: still `activeTab` + `scripting`, no host permissions — ruling 2.

The full tab's Autofill button is gone rather than left failing: that tab is the
active tab whenever it is on screen, so a fill from there has nowhere to go. Copy
stays there as the fallback.

`npm run autofill` is green — 29 checks — and now fails the build if it is not.
One caveat, measured rather than assumed, and written up in the README: no script
can produce the `activeTab` grant, because the browser confers it on its own
action-invocation path. `chrome.action.openPopup()` opens the real popup but
grants nothing; synthesised keystrokes never reach the command dispatcher; a
pre-seeded profile is discarded for an unpacked extension. So pass 1 checks
everything reachable without the grant (including the headline one: the popup
points at the login tab, not at our own UI) and pass 2 runs the same shipped
popup, worker and content script through every fill and origin check with a host
permission standing in for the grant. The README carries the one manual click
that closes the gap; the popup naming the site is itself proof the grant arrived,
since the URL is unreadable without it.

Two follow-on questions the build surfaced are parked in `0015` — whether the
popup may inherit an unlocked session, and whether it should offer Copy.
