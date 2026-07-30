// Open the full palace tab on toolbar click.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
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
    if (tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('about:')) {
      sendResponse({ ok: false, reason: 'no-page-tab' })
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
            overrideOrigin: msg.overrideOrigin === true,
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
