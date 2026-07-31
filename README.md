# Where Was My Password

A password manager (browser extension) with one unusual promise: **you will actually
remember your master passphrase** — a long, random, genuinely strong one — without ever
writing it down.

Inspired by *Moonwalking with Einstein* and the 2,500-year-old **method of loci**: spatial
memory vastly outperforms working memory, so the app teaches you to hide each word of a
randomly generated passphrase at a spot along a fixed route through an illustrated house
(mailbox → doormat → coat closet → fireplace → oven → fridge → mirror → wardrobe), wrapped
in a vivid image of your own invention. Recall = walking the route in your mind.

Each locus also has a permanent, outrageous **resident** (the sumo wrestler in the mailbox,
Elvis in the coat closet, Einstein in a bikini in the fridge…) — the book's *anchoring*
technique: fusing your word with a shocking, emotionally charged character gives memory a
second handle. The app keeps its residents PG-13 and coaches you to make your private
mental version as lewd as you dare, which is, per the book, exactly what works.

Earlier prototypes (in `wherewasmypassword/`, `go_wwmp/`, `deeps/`) tried Google Street View
as the memory space; they died on the same rock: real-map imagery can't do **occlusion** —
you can't hide something in a drawer and open it later. The illustrated house can.

## The app (v1) — `app/`

- **Tutorial**: the method explained, then a risk-free demo walk with a throwaway phrase.
- **Generation**: diceware passphrase (6–8 words, default 6 ≈ 67 bits) rolled with
  `crypto.getRandomValues` from the EFF large wordlist filtered to **picturable words
  only** (concreteness ≥ 4.0 in the Brysbaert et al. norms, 2,255 words) — the method of
  loci can't hang "dispersed" on a mailbox, but it can hang a zeppelin. Entropy is
  computed from the filtered list's true size. Words can be re-rolled, but re-rolls are
  **counted and charged**: keeping only the draw you liked is a choice you made rather
  than the dice, so the meter falls as you spend and a six-bit budget holds the floor at
  ~60.8 bits.
- **Placement journey**: room by room, craft a vivid image for each word, place it, and
  watch the compartment close over it.
- **Training gauntlet**: forward walk → backward walk → random spot-checks (all requiring
  typed recall before the compartment opens) → mastery gate: the full phrase, cold, twice.
- **The vault**: Argon2id (256 MiB, t=3) stretches the phrase into an AES-256-GCM key; the
  vault (your words + imagery, and in v2 your site credentials) is stored encrypted in
  IndexedDB, on this device only. The plaintext is padded to 4 KiB blocks so the stored
  size does not track what is inside, and the header (salt, KDF parameters, format
  version) is bound into the ciphertext as additional data. Encrypted backup
  export/import. Spaced practice reminders at 1, 2, 4, 7, 14, 30 days — unlocking *is*
  the rehearsal.
- **Changing the master phrase**: generates a new one, walks you through placing it, and
  re-encrypts the vault under it with your passwords untouched. Vaults created under
  weaker key-derivation settings are re-keyed to the current ones automatically, the
  next time they are unlocked.
- **The toolbar popup**: on a login page, click the toolbar button. A compact panel
  unlocks, puts the entry saved for *that* site at the top of the list, and types it
  straight into the form — no clipboard. The memory house stays a full tab, which is
  where training, palace walks, and adding or editing entries live.

### Security model

- Nothing derived from the passphrase is stored except the ciphertext itself; a wrong
  passphrase is detected by GCM auth-tag failure, not a stored verifier.
- The word→image associations live only in memory during training and inside the
  encrypted vault afterwards — never in plaintext storage.
- No server, no analytics, zero network requests; production builds ship a strict CSP
  (`default-src 'self'`; WASM allowed for Argon2id only).
- Auto-lock after 5 minutes idle, 60 seconds after the tab is hidden, and a 30-minute
  ceiling no activity can extend. Deadlines are wall-clock, so a suspended laptop wakes
  locked. Locking one tab locks every open copy.
- If you forget the phrase, nothing can recover the vault. That's the deal — and the
  whole point of the training.
- **Autofill without host permissions.** The extension asks for `activeTab` and
  `scripting` and nothing else — no "read and change all your data on every website".
  `activeTab` is granted for the tab that was active when the toolbar button was
  clicked, which is why filling happens from the popup: a popup is not a tab, so the
  login page underneath stays active and stays granted. (The UI used to open in a full
  tab, which made *itself* the active tab — autofill could not work at all, and this is
  what fixed it; see `decisions/0011`.) The password is typed into the field by a content
  script injected on demand into that one tab, and never touches the clipboard.
- **The page is checked twice, before anything is typed and before anything is sent.**
  The content script compares the credential's saved origin against the page it is
  actually on, so a look-alike phishing page does not get the real password; a mismatch
  asks first and names both origins, and the approval carries the origin the user was
  shown, so it cannot be reused after the page navigates. The background worker makes the
  same comparison *first*, on the URL `activeTab` lets it read, so a page that navigated
  while the passphrase was being typed is refused before the password is handed to its
  renderer at all. Fields the user cannot see — tiny, transparent, off-screen, disabled,
  covered — are refused, so a harvesting page gets nothing.
- **The popup holds the key for as long as it is open, and no longer.** The browser
  destroys a popup the moment it loses focus, so the key dies with it; the popup asks for
  the passphrase each time rather than sharing a session with the full tab
  (`decisions/0015`).

**Known limitation:** Copy remains the fallback for pages autofill cannot reach, and is
only offered in the full tab. It clears the clipboard 30 seconds after you return to that
tab (the browser will not let a background page touch the clipboard) — note your OS may
keep its own clipboard history.

### Develop

```bash
cd app
npm install
npm run dev    # http://localhost:5199
npm test       # vitest: crypto, backup, credential-persistence, schedule suites
npm run build  # production build in dist/ (web page + extension), CSP injected
npm run visual # drives the whole onboarding in a real browser, screenshots each screen
npm run autofill  # loads the packed extension in a real browser and tests the fill path
```

`npm run autofill` needs Microsoft Edge: Chrome 137 and later ignore `--load-extension`,
so on Chrome the extension silently never loads and every check would pass vacuously.

It runs in two passes, and both must be green. Pass 1 is `dist/` exactly as shipped: the
manifest wiring, the popup opening onto the login tab rather than onto the extension's own
UI, the memory house opening from the popup, and the old full-tab path still refusing.
Pass 2 runs the same shipped popup, worker and content script through every fill, origin
and harvesting check, with one thing simulated — the `activeTab` grant, replaced by a host
permission the extension does not ship.

That substitution is not laziness, it is the boundary of what a script can do: `activeTab`
is conferred by the browser's own action-invocation path, and none of it is reachable over
the DevTools protocol. Measured, not assumed — `chrome.action.openPopup()` opens the real
popup but confers nothing, synthesised keystrokes never reach the command dispatcher, and
a pre-seeded profile is discarded for an unpacked extension.

**The one manual check** that closes that gap, worth doing before a release:

1. `npm run build`, then load `app/dist` unpacked (`edge://extensions` → Developer mode)
2. Go to any real login page and click the toolbar button
3. The popup should name that site — "Filling into example.com" — which by itself proves
   the grant arrived, since the URL is only readable with it
4. Unlock, click **Fill**, and watch the password land in the form

### Install as a browser extension

1. `npm run build` in `app/`
2. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**
3. **Load unpacked** → select `app/dist`
4. Click the toolbar button — the popup opens; "Memory house" in it opens the full tab,
   which is where you build the vault the first time

The same `dist/` also works as a plain static site on any host; the extension wrapper is
`public/manifest.json` + `public/background.js`. Vault data lives in the extension's own
IndexedDB, so the web version and extension version have separate vaults — use the
encrypted backup export/import to move between them.

**The hosted build is meaningfully weaker than the extension, and not just because it
lacks autofill.** An extension page runs in its own origin with its own isolated world;
a hosted page shares an origin with whatever else that host serves, so a single XSS or a
compromised host yields the master passphrase itself, not just today's passwords. The
`<meta>` CSP also cannot carry `frame-ancestors` — send it as a real HTTP header if you
host this. Prefer the extension.
