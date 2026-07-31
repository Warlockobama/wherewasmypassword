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
   * typically 1x1, transparent, parked off-screen, or sitting under an
   * overlay, and every one of those has to fail — hence the deliberately
   * strict set of checks.
   */
  function isVisible(el) {
    // A field the user could not type into is not a field they meant to fill.
    if (el.disabled || el.readOnly) return false

    const rect = el.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 8) return false
    // All four sides, symmetrically. `left: 9999px` is exactly as much of a
    // harvesting trick as `left: -9999px`, and only the negative side used to
    // be rejected.
    const viewportWidth = window.innerWidth || 0
    const viewportHeight = window.innerHeight || 0
    if (rect.bottom < 0 || rect.right < 0) return false
    if (rect.top > viewportHeight + rect.height) return false
    if (rect.left > viewportWidth + rect.width) return false

    // The element's own computed style first. These run ALWAYS, never as a
    // fallback: `checkVisibility` below is the newer and broader check, but it
    // is also the one whose option names changed, and an unknown dictionary
    // member is silently ignored rather than raising — so a version mismatch
    // there degrades to checking almost nothing, without saying so.
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (Number(style.opacity) === 0) return false

    // `checkVisibility` additionally accounts for ANCESTORS, which a computed
    // style cannot: a wrapper with `opacity: 0` leaves the input itself
    // computing an opacity of 1. Both spellings are passed because Chromium
    // 105-124 shipped `checkOpacity`/`checkVisibilityCSS` and 125+ renamed
    // them; passing only the new names silently disables the check on the old
    // versions.
    if (typeof el.checkVisibility === 'function') {
      const visible = el.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      })
      if (!visible) return false
    }

    // If the field is on screen right now, a SIBLING element covering it means
    // the user is not looking at what we are about to fill. Skipped when the
    // centre is off screen, because a legitimate form below the fold is not an
    // attack and a hit test there would always fail.
    //
    // Ancestors are allowed through: an input clipped by a scrolling wrapper,
    // or sitting under a transparent container that captures pointer events,
    // is ordinary page construction and refusing it would just mean "no login
    // field found" on real sites. Note also that `elementFromPoint` honours
    // `pointer-events`, so a cover with `pointer-events: none` is not caught —
    // this is a check against mis-filling, not an anti-harvesting control. The
    // checks above are what stop harvesting.
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    if (cx >= 0 && cy >= 0 && cx <= viewportWidth && cy <= viewportHeight) {
      const topmost = document.elementFromPoint(cx, cy)
      if (topmost && topmost !== el && !el.contains(topmost) && !topmost.contains(el)) return false
    }
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

  /**
   * The page's origin with a leading `www.` dropped, matching what
   * `credentialOrigin()` stores on the app side. Kept in step with
   * `src/credentials/match-url.ts` — a content script cannot import it.
   */
  function canonicalOrigin() {
    try {
      const url = new URL(location.origin)
      url.hostname = url.hostname.replace(/^www\./i, '')
      return url.origin
    } catch {
      return location.origin
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'wwmp-autofill') return false

    // Only accept messages from our own extension.
    if (sender.id !== chrome.runtime.id) return false

    // Only ordinary web pages, ever. This is stricter than "not our own UI" on
    // purpose: `location.origin` is the literal string "null" for a `file://`,
    // `data:` or sandboxed document, so every one of them canonicalises to the
    // same value below. A user with file access enabled would be shown the
    // "no site saved against this password" card naming **null**, and clicking
    // "Fill anyway" would hand back `overrideOrigin: "null"` — which matches,
    // fills, and then goes on matching every other opaque-origin document the
    // tab visits, defeating the whole point of carrying the approved origin
    // rather than a boolean.
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      sendResponse({ ok: false, filled: false, reason: 'no-page-tab' })
      return false
    }

    const pageOrigin = canonicalOrigin()

    // `overrideOrigin` carries the origin the user was shown and approved —
    // not a bare `true`. A page that mismatched, got the user to click "Fill
    // anyway", and navigated elsewhere in between no longer matches what was
    // approved, so it is refused.
    const approved = typeof msg.overrideOrigin === 'string' && msg.overrideOrigin === pageOrigin

    // The credential's own origin must match the page it is about to be typed
    // into. Without this a look-alike phishing page gets the real password.
    if (!msg.expectedOrigin) {
      // A credential saved without a URL used to skip this check entirely and
      // fill anywhere, silently — the one case with no protection at all was
      // the router/VPN kind of entry whose password is most often reused.
      if (!approved) {
        sendResponse({
          ok: false,
          filled: false,
          reason: 'no-stored-origin',
          pageOrigin,
        })
        return false
      }
    } else if (msg.expectedOrigin !== pageOrigin && !approved) {
      sendResponse({
        ok: false,
        filled: false,
        reason: 'origin-mismatch',
        pageOrigin,
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
    sendResponse({ ok: true, filled: true, pageOrigin })

    return false // synchronous response
  })
})()
