// The toolbar button opens `popup.html` (see `action.default_popup` in the
// manifest), NOT a tab. That is the whole point: `activeTab` is granted for the
// tab that was active when the button was clicked, and a popup is not a tab, so
// the login page underneath stays active and stays granted. Opening the UI in a
// tab — what this extension used to do — moved the active tab to our own page,
// which can never be scripted, and autofill could not work at all.
//
// A consequence worth naming: with a `default_popup` set, `chrome.action.onClicked`
// never fires. The full memory house is opened from inside the popup instead,
// via the `wwmp-open-app` message below.
const UI_URL = chrome.runtime.getURL('index.html')

// The opt-in five-minute popup session parks a derived key in
// `chrome.storage.session` — in memory, never on disk (`decisions/0015`). That
// area is already closed to content scripts by default; this says so out loud,
// on every worker start, so the day someone opens it up for something else it
// has to be a deliberate edit to this line rather than a default quietly
// changing underneath a key.
try {
  chrome.storage.session
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch(() => {
      /* older Chromium: the default is already trusted-contexts-only */
    })
} catch {
  /* the API is absent entirely; same default applies */
}

/**
 * Open the full palace tab — or focus the one already open. Each tab is a
 * separate unlocked session with its own key and its own timers, so clicking
 * through to the memory house three times over a morning should not leave three
 * vaults open.
 */
async function openMemoryHouseTab() {
  let open = null
  try {
    // `runtime.getContexts` is used rather than `tabs.query({url})` deliberately:
    // filtering tabs by URL needs the broad `tabs` permission, while asking about
    // our OWN contexts needs none. Keeping the permission set at `activeTab` +
    // `scripting` is worth a slightly less obvious API.
    //
    // Deliberately unfiltered: `documentUrls` matches exactly, so any query
    // string or fragment on the UI document — a bookmark, a future route —
    // would miss and quietly open a second unlocked session.
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] })
    open = contexts.find((c) => c.documentUrl?.startsWith(UI_URL) && c.tabId >= 0)
  } catch {
    // Older Chromium has no getContexts; opening a new tab is the safe path.
  }
  if (open) {
    // Past this point we must not fall through to `tabs.create`: focusing the
    // window is a nicety, and failing at it should not open a duplicate tab
    // on top of the one just activated.
    try {
      await chrome.tabs.update(open.tabId, { active: true })
      if (open.windowId >= 0) await chrome.windows.update(open.windowId, { focused: true })
    } catch {
      // The tab went away between the query and the update; nothing to do.
    }
    return
  }
  await chrome.tabs.create({ url: UI_URL })
}

/**
 * Only our own extension pages may drive this worker — not content scripts, not
 * another extension. The exact origin is compared rather than the scheme:
 * `chrome-extension://` alone would also match a different extension's page if
 * an external listener were ever added.
 */
function fromOurExtensionPage(sender) {
  return (
    sender.id === chrome.runtime.id &&
    sender.origin === `chrome-extension://${chrome.runtime.id}`
  )
}

/**
 * The tab to fill — the one the caller named, and only that one.
 *
 * The popup resolves the target once, up front, and shows the user its origin
 * before they pick an entry, so the fill has to land in *that* tab. There is
 * deliberately no "otherwise use the active tab" fallback: it would quietly
 * turn "fill the page I showed you" into "fill whatever is in front of the
 * browser now", which is the entire class of bug the popup exists to remove.
 * A request with no tab id is a bug in the caller, and fails closed.
 *
 * `chrome.tabs.get` needs no permission of its own, and for the tab `activeTab`
 * was granted on, its `url` is readable too.
 */
async function resolveTargetTab(msg) {
  if (typeof msg.tabId !== 'number' || msg.tabId < 0) return null
  try {
    return await chrome.tabs.get(msg.tabId)
  } catch {
    return null
  }
}

/**
 * The page's origin in the canonical form everything else here uses: http(s)
 * only, one leading `www.` dropped. Kept deliberately in step with
 * `content.js`'s `canonicalOrigin()` and `src/credentials/match-url.ts` — a
 * worker that disagreed with the content script about which page it is looking
 * at would refuse fills the user was told were fine.
 */
function pageOrigin(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.hostname = url.hostname.replace(/^www\./i, '')
    return url.origin
  } catch {
    return ''
  }
}

/**
 * Relay credentials to the target tab's content script for direct field
 * injection. The content script is injected on demand (not declaratively on
 * every page) so only the tab being filled ever loads it.
 */
async function relayAutofill(msg) {
  const tab = await resolveTargetTab(msg)
  if (!tab || typeof tab.id !== 'number') return { ok: false, reason: 'no-such-tab' }
  // Our own pages are never a fill target: filling one would mean typing a
  // password into this extension's UI.
  //
  // `tab.url` is only populated for a tab we hold permission on. Under the popup
  // flow that is exactly the tab being filled, so this guard now does real work
  // — but it still has to fail closed when the URL is missing rather than fall
  // through. The content script re-checks its own protocol as well, because that
  // is the only place that can see it first hand.
  if (!tab.url || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
    return { ok: false, reason: 'no-page-tab', detail: tab.url ? undefined : 'tab url not visible' }
  }

  // Check the origin BEFORE the password goes anywhere near the page.
  //
  // The content script checks it too, and that check is the authoritative one —
  // it is the only place that sees the page first hand. But by the time it runs,
  // the plaintext has already been posted into the process that renders that
  // page. A tab that navigated between the popup resolving it and the user
  // clicking Fill — a redirect during the second or so that Argon2id takes — was
  // therefore handed the password, refused to type it, and reported a tidy
  // mismatch, while the secret sat in a renderer the attacker controls. So the
  // cheap half of the check runs here, first, on the URL `activeTab` now lets us
  // read. The rules below mirror `content.js` exactly.
  const origin = pageOrigin(tab.url)
  const approved =
    typeof msg.overrideOrigin === 'string' && msg.overrideOrigin !== '' && msg.overrideOrigin === origin
  if (!approved) {
    if (!msg.expectedOrigin) {
      return { ok: false, filled: false, reason: 'no-stored-origin', pageOrigin: origin }
    }
    if (msg.expectedOrigin !== origin) {
      return {
        ok: false,
        filled: false,
        reason: 'origin-mismatch',
        pageOrigin: origin,
        expectedOrigin: msg.expectedOrigin,
      }
    }
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
  } catch (err) {
    return { ok: false, reason: 'injection-failed', detail: err?.message }
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'wwmp-autofill',
      username: msg.username,
      password: msg.password,
      // The content script re-checks this against its own location.
      expectedOrigin: msg.expectedOrigin,
      // The origin the user was shown and approved, not a boolean: the content
      // script requires it to equal the page it is filling, so an approval
      // cannot be carried over to a page that navigated.
      overrideOrigin: typeof msg.overrideOrigin === 'string' ? msg.overrideOrigin : undefined,
    })
    return response ?? { ok: false, reason: 'no-response' }
  } catch (err) {
    return { ok: false, reason: 'content-script-unreachable', detail: err?.message }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'wwmp-open-app' && msg?.type !== 'wwmp-autofill-relay') return false

  if (!fromOurExtensionPage(sender)) {
    sendResponse({ ok: false, reason: 'unauthorized-sender' })
    return true
  }

  const work =
    msg.type === 'wwmp-open-app' ? openMemoryHouseTab().then(() => ({ ok: true })) : relayAutofill(msg)

  // A popup is destroyed the moment it loses focus, so the caller is often gone
  // before the answer is ready — "Open the memory house" guarantees it, since
  // the new tab taking focus is what closes the popup. Answering a channel that
  // has hung up must not raise, and must not then raise again inside the
  // handler for the first raise, which is why this is `then(a, b)` rather than
  // `then().catch()`.
  const reply = (response) => {
    try {
      sendResponse(response)
    } catch {
      /* nobody left to tell */
    }
  }
  work.then(reply, (err) =>
    reply({ ok: false, reason: 'relay-failed', detail: err?.message ?? String(err) }),
  )

  return true // async response
})
