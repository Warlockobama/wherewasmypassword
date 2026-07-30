// Open the full palace tab on toolbar click.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
})

// Relay autofill requests from the extension page to the active tab's content
// script. The content script is injected on demand (not declaratively on every
// page) so only the target tab ever loads it.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'wwmp-autofill-relay') return false

  // Only accept from our own extension pages, not from content scripts.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith('chrome-extension://')) {
    sendResponse({ ok: false, reason: 'unauthorized-sender' })
    return true
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0]
    if (!tab?.id) {
      sendResponse({ ok: false, reason: 'no-active-tab' })
      return
    }
    // Inject the content script on demand, then send the autofill message.
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      .then(() => {
        chrome.tabs.sendMessage(
          tab.id,
          { type: 'wwmp-autofill', username: msg.username, password: msg.password },
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
