// Content script injected into web pages for credential autofill.
// Receives messages from the extension background worker and fills login
// fields directly — passwords never touch the system clipboard.
//
// This script is the last checkpoint before a password is typed into a page,
// so the origin check lives here: this is the only place that knows, first
// hand, which page is actually about to receive it.

;(() => {
  'use strict'

  // The worker injects on every Autofill click. Without this guard each
  // injection would add another listener, and every one of them would fill
  // (and retain) the password again.
  if (window.__wwmpAutofillLoaded) return
  window.__wwmpAutofillLoaded = true

  /** Find the best-matching input for a username / email field. */
  function findUsernameField(form) {
    const root = form || document
    // Prefer visible inputs with common name/type/autocomplete hints. There is
    // deliberately no bare `input[type="text"]` fallback: on a page with no
    // login form that lands the username in a search or comment box.
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
    ]
    for (const sel of selectors) {
      for (const el of root.querySelectorAll(sel)) {
        if (isVisible(el)) return el
      }
    }
    // Inside a real login form, a lone text input is the username.
    if (form) {
      for (const el of form.querySelectorAll('input[type="text"]')) {
        if (isVisible(el)) return el
      }
    }
    return null
  }

  /** Find the best-matching password field. */
  function findPasswordField() {
    const selectors = [
      'input[autocomplete="current-password"]',
      'input[type="password"]',
      // Last resort: a signup-style field, only if nothing better exists.
      'input[autocomplete="new-password"]',
    ]
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el)) return el
      }
    }
    return null
  }

  /**
   * Reject anything the user cannot actually see. A harvesting field is
   * typically 1x1, transparent, or parked off-screen, and every one of those
   * has to fail — hence the deliberately strict set of checks.
   */
  function isVisible(el) {
    const rect = el.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 8) return false
    if (rect.bottom < 0 || rect.right < 0) return false
    if (rect.top > (window.innerHeight || 0) + rect.height) return false
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (Number(style.opacity) === 0) return false
    return true
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

    // The credential's own origin must match the page it is about to be typed
    // into. Without this a look-alike phishing page gets the real password.
    // `overrideOrigin` is only ever set after the user was shown both origins
    // and chose to fill anyway.
    if (msg.expectedOrigin && msg.expectedOrigin !== location.origin && !msg.overrideOrigin) {
      sendResponse({
        ok: false,
        filled: false,
        reason: 'origin-mismatch',
        pageOrigin: location.origin,
        expectedOrigin: msg.expectedOrigin,
      })
      return false
    }

    const passField = findPasswordField()
    if (!passField) {
      sendResponse({ ok: true, filled: false, reason: 'no-password-field' })
      return false
    }

    // Look for the username in the same form as the password field first: it
    // keeps the fill inside one login form even on a crowded page.
    const userField = findUsernameField(passField.form)
    if (userField && msg.username) fillField(userField, msg.username)
    fillField(passField, msg.password)
    sendResponse({ ok: true, filled: true, pageOrigin: location.origin })

    return false // synchronous response
  })
})()
