// The palace needs a full tab (the popup is far too small for a house).
// v2 will add a real popup for quick credential access.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
})
