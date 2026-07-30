# 0006 — Mobile version: scope and approach

**Status:** RESOLVED (user call, 2026-07-30) — see the resolution at the bottom.

## Context

Directive 0005 asks for a mobile version proposal. The current app is a
browser extension (MV3) with a Vite/React SPA. All rendering is
HTML/SVG/CSS — no native-only dependencies. The vault uses IndexedDB,
Argon2id WASM, and the Web Crypto API.

## Options considered

### A. Progressive Web App (PWA) — recommended default

Wrap the existing SPA as an installable PWA with a service worker,
manifest, and offline support. The memory palace, training flow, and
credential management would work identically. Autofill would not be
available (no browser extension API on mobile), but copy-to-clipboard
with auto-clear would still work.

**Pros:**
- Minimal code changes — same React/Vite app, add a manifest + service worker
- Single codebase for web, desktop extension, and mobile
- Works on iOS Safari and Android Chrome without app store review
- Argon2id WASM and Web Crypto API both work in mobile browsers

**Cons:**
- No system-level autofill integration (Android Autofill Framework / iOS
  AutoFill Credential Provider)
- iOS Safari has PWA limitations (no push notifications, background limits)
- Users must "Add to Home Screen" rather than install from a store

### B. Capacitor / Ionic wrapper

Bundle the SPA inside a native shell using Capacitor. This gives access
to native APIs (biometrics, system autofill) while keeping the React UI.

**Pros:**
- App store distribution (discoverability, trust)
- Could integrate Android Autofill Framework / iOS Credential Provider
  for system-wide password autofill
- Biometric unlock (fingerprint/face) as a convenience layer

**Cons:**
- Adds a native build pipeline (Xcode, Android Studio, signing certs)
- System autofill integration is significant new code — credential
  provider extensions on both platforms
- App store review process (Apple may flag password managers)

### C. React Native rewrite

Rewrite the UI in React Native; share crypto/vault logic.

**Pros:**
- True native UX

**Cons:**
- Rewrites the SVG memory palace (React Native SVG libs exist but differ)
- Two codebases to maintain
- Argon2id: would need a native module (no WASM in React Native's Hermes)
- Highest effort by far

## Recommendation

Start with **Option A (PWA)** — it's the fastest path to a working
mobile experience with near-zero divergence from the existing codebase.
If James wants system-level autofill on mobile (the key feature a PWA
can't deliver), then **Option B (Capacitor)** is the next step — it
wraps the same SPA in a native shell. Option C is only worth considering
if native UX parity becomes a hard requirement.

## Decisions needed from James

1. **Platform priority:** iOS-first, Android-first, or both simultaneously?
2. **Packaging:** PWA (no store, no native autofill) or Capacitor
   (app store + potential native autofill)?
3. **Biometrics:** Should mobile support fingerprint/face unlock as a
   convenience layer on top of the passphrase (e.g., biometric for
   quick re-opens within a session, passphrase required for cold
   starts)?
4. **Scope:** Mobile-as-viewer (walk the house, review credentials, copy
   passwords) or full parity (including training/onboarding flow)?

## Acceptance criteria for resuming

Any subset of decisions 1-4 unblocks meaningful work. The PWA path
(option A) can start immediately with zero decisions if James is fine
with the recommended default.

## UPDATE 2026-07-30 (guidance via exec assistant, not yet a ruling)

1. **Adopt the recommended PWA path as the starting approach**: James said "That seems reasonable" in response to the PWA default. Proceed with a mobile installable web app experience (manifest, service worker, offline support) and rely on copy-to-clipboard with auto-clear instead of system-wide autofill. Do not pursue a native wrapper or React Native rewrite at this stage.
2. **Clarify remaining choices before finalizing scope**: Platform priority (iOS-first, Android-first, or both), biometric convenience unlock, and viewer-only versus full-featured scope are still open. Bring back a short proposal assuming the PWA path with a recommended platform rollout and a minimal viable scope, and note what would change if a native wrapper is later required.

## RESOLUTION (user call, 2026-07-30 — via exec assistant)

1. **Defer a mobile app and focus on the extension**: James said "maybe we should focus on the extension itself." Treat mobile work as out of scope for now. Do not build a PWA, Capacitor wrapper, or React Native version at this stage.
2. **Revisit later when priorities or budget change**: When a mobile experience becomes a priority, bring back a brief proposal comparing the PWA first approach versus a native wrapper, including distribution costs and maintenance overhead.
