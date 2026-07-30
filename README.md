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
- **The vault**: Argon2id (64 MiB, t=3) stretches the phrase into an AES-256-GCM key; the
  vault (your words + imagery, and in v2 your site credentials) is stored encrypted in
  IndexedDB, on this device only. Encrypted backup export/import. Spaced practice
  reminders at 1, 2, 4, 7, 14, 30 days — unlocking *is* the rehearsal.

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

**Known limitation:** autofill does not currently work. The extension opens its UI in a
full tab, and the `activeTab` permission is granted to the tab that was active when the
toolbar icon was clicked — never the tab the fill targets. Confirmed by
`npm run autofill`, which drives the packed extension in a real browser; see
`decisions/0009`. Until it is resolved, Copy is the working path. Copy clears the
clipboard 30 seconds after you return to the extension's tab (the browser will not let a
background page touch the clipboard) — note your OS may keep its own clipboard history.

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
It currently exits non-zero — see the known limitation above.

### Install as a browser extension

1. `npm run build` in `app/`
2. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**
3. **Load unpacked** → select `app/dist`
4. Click the toolbar button — the memory house opens in a tab

The same `dist/` also works as a plain static site on any host; the extension wrapper is
`public/manifest.json` + `public/background.js`. Vault data lives in the extension's own
IndexedDB, so the web version and extension version have separate vaults — use the
encrypted backup export/import to move between them.
