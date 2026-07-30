// Open the full palace tab on toolbar click — or focus the one already open.
// Each tab is a separate unlocked session with its own key and its own timers,
// so clicking the icon three times over a morning should not leave three
// vaults open.
const UI_URL = chrome.runtime.getURL('index.html')

// `runtime.getContexts` is used rather than `tabs.query({url})` deliberately:
// filtering tabs by URL needs the broad `tabs` permission, while asking about
// our OWN contexts needs none. Keeping the permission set at `activeTab` +
// `scripting` is worth a slightly less obvious API.
chrome.action.onClicked.addListener(async () => {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['TAB'],
      documentUrls: [UI_URL],
    })
    const open = contexts.find((c) => c.tabId !== undefined && c.tabId >= 0)
    if (open) {
      await chrome.tabs.update(open.tabId, { active: true })
      if (open.windowId >= 0) await chrome.windows.update(open.windowId, { focused: true })
      return
    }
  } catch {
    // Older Chromium has no getContexts; opening a new tab is the safe path.
  }
  await chrome.tabs.create({ url: UI_URL })
})

// Relay autofill requests from the extension page to the active tab's content
// script. The content script is injected on demand (not declaratively on every
// page) so only the target tab ever loads it.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'wwmp-autofill-relay') return false

  // Only accept from our own extension pages, not from content scripts and not
  // from another extension. Compare the exact origin rather than the scheme:
  // `chrome-extension://` alone would also match a different extension's page
  // if an external listener were ever added.
  if (sender.id !== chrome.runtime.id || sender.origin !== `chrome-extension://${chrome.runtime.id}`) {
    sendResponse({ ok: false, reason: 'unauthorized-sender' })
    return true
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0]
    if (!tab?.id) {
      sendResponse({ ok: false, reason: 'no-active-tab' })
      return
    }
    // Our own pages are never a fill target: filling one would mean typing a
    // password into this extension's UI.
    //
    // `tab.url` is only populated for an extension holding `tabs` or a host
    // permission, and this one holds neither — so it is normally `undefined`
    // and this guard has to fail closed on that, not fall through. The content
    // script re-checks its own protocol as well, because that is the only
    // place that can see it first hand.
    if (!tab.url || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
      sendResponse({ ok: false, reason: 'no-page-tab', detail: tab.url ? undefined : 'tab url not visible' })
      return
    }
    // Inject the content script on demand, then send the autofill message.
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      .then(() => {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: 'wwmp-autofill',
            username: msg.username,
            password: msg.password,
            // The content script re-checks this against its own location.
            expectedOrigin: msg.expectedOrigin,
            // The origin the user was shown and approved, not a boolean: the
            // content script requires it to equal the page it is filling, so
            // an approval cannot be carried over to a page that navigated.
            overrideOrigin: typeof msg.overrideOrigin === 'string' ? msg.overrideOrigin : undefined,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              sendResponse({
                ok: false,
                reason: 'content-script-unreachable',
                detail: chrome.runtime.lastError.message,
              })
            } else {
              sendResponse(response)
            }
          },
        )
      })
      .catch((err) => {
        sendResponse({ ok: false, reason: 'injection-failed', detail: err.message })
      })
  })

  return true // async response
})
