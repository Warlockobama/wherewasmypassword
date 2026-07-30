// Content script injected into web pages for credential autofill.
// Receives messages from the extension background worker and fills login
// fields directly — passwords never touch the system clipboard.

;(() => {
  'use strict'

  /** Find the best-matching input for a username / email field. */
  function findUsernameField() {
    // Prefer visible inputs with common name/type/autocomplete hints.
    const selectors = [
      'input[autocomplete="username"]',
      'input[autocomplete="email"]',
      'input[type="email"]',
      'input[name*="user" i]',
      'input[name*="login" i]',
      'input[name*="email" i]',
      'input[id*="user" i]',
      'input[id*="login" i]',
      'input[id*="email" i]',
      'input[type="text"]',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el && isVisible(el)) return el
    }
    return null
  }

  /** Find the best-matching password field. */
  function findPasswordField() {
    const selectors = [
      'input[autocomplete="current-password"]',
      'input[autocomplete="new-password"]',
      'input[type="password"]',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el && isVisible(el)) return el
    }
    return null
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return false
    const style = getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }

  /**
   * Set the value of an input in a way that fires all the events React and
   * other frameworks listen for (input, change, compositionend).
   */
  function fillField(el, value) {
    // Use the native setter to bypass React's synthetic value tracking.
    const proto = Object.getPrototypeOf(el)
    const descriptor =
      Object.getOwnPropertyDescriptor(proto, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value)
    } else {
      el.value = value
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'wwmp-autofill') return false

    // Only accept messages from our own extension.
    if (sender.id !== chrome.runtime.id) return false

    const { username, password } = msg
    const userField = findUsernameField()
    const passField = findPasswordField()

    if (passField) {
      if (userField && username) fillField(userField, username)
      fillField(passField, password)
      sendResponse({ ok: true, filled: true })
    } else {
      sendResponse({ ok: true, filled: false, reason: 'no-password-field' })
    }

    return false // synchronous response
  })
})()
