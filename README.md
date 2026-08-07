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
  export/import — a restore sets the vault it replaces aside, and the lock screen will
  put it back if you restored the wrong file and can type that vault's passphrase.
  Spaced practice reminders at 1, 2, 4, 7, 14, 30 days — unlocking *is* the rehearsal.
- **Changing the master phrase**: generates a new one, walks you through placing it, and
  re-encrypts the vault under it with your passwords untouched. Vaults created under
  weaker key-derivation settings are re-keyed to the current ones automatically, the
  next time they are unlocked.
- **The toolbar popup**: on a login page, click the toolbar button. A compact panel
  unlocks, puts the entry saved for *that* site at the top of the list, and types it
  straight into the form — no clipboard. The memory house stays a full tab, which is
  where training, palace walks, and adding or editing entries live. It asks for the
  passphrase every time unless you tick **Stay unlocked for 5 minutes**, which is off
  until you turn it on.

### Security model

- Nothing derived from the passphrase is stored except the ciphertext itself; a wrong
  passphrase is detected by GCM auth-tag failure, not a stored verifier.
- The word→image associations live only in memory during training and inside the
  encrypted vault afterwards — never in plaintext storage.
- No server, no analytics, zero network requests; production builds ship a strict CSP
  (`default-src 'self'`; WASM allowed for Argon2id only).
- Auto-lock after 5 minutes idle, 60 seconds after the tab is hidden, and a 30-minute
  ceiling no activity can extend. The popup drops its key 5 minutes after the unlock that
  made it, whether or not the session below is on. Deadlines are wall-clock, so a
  suspended laptop wakes locked. Locking one tab locks every open copy.
- If you forget the phrase, nothing can recover the vault. That's the deal — and the
  whole point of the training.
- **Autofill without host permissions.** The extension asks for `activeTab`,
  `scripting`, `storage` and `alarms`, and nothing else — no "read and change all your
  data on every website". (The last two reach nothing outside this extension and add no
  warning at install: `storage` holds the opt-in popup session below, and `alarms` is
  what wakes the extension at that session's deadline to delete the key.)
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
- **The popup asks every time, unless you say otherwise.** By default the key it derives
  dies with the popup — the browser destroys a popup the moment it loses focus — and it
  never shares a session with the full tab. **Stay unlocked for 5 minutes**, off until
  you turn it on, keeps that key in `chrome.storage.session`: browser memory, never
  written to disk, gone when the browser closes, and closed to page scripts. The five
  minutes run from the unlock and are not extended by using it; **Lock now** in either
  place ends it early, as does turning the setting off, changing the passphrase, or
  restoring or deleting the vault. Past the deadline the key is not merely refused: the
  browser wakes the extension at the deadline to delete it (Chrome will not fire an alarm
  less than thirty seconds out, so a session with seconds left on it when you turn the
  setting on can outlive its deadline by that much, refused throughout), and the wake-up
  is cancelled by every lock (`decisions/0017`). The old belts are still there — a sweep
  on every start of the extension, and the whole area emptied when the browser closes.
  What it costs is that until the time is up, anyone at
  your computer can fill passwords without knowing the phrase — an unattended-machine
  trade, made deliberately (`decisions/0015`).

- **An old vault record can be put back, and nothing here can prove it wasn't.** The
  header is bound into the ciphertext, so a record cannot be *edited* — but it can be
  *replaced whole*. Anyone who can write to the browser profile directory can drop
  yesterday's vault, or an old backup file, into place, and your correct passphrase
  opens it without complaint: credential edits since then are gone, and a password you
  rotated is live again. Every defence against this — a monotonic counter, a signed
  timestamp — needs somewhere to keep state that the same attacker cannot also roll
  back, and inside a browser profile there is no such place. So rather than a scheme
  that cannot be anchored, the unlocked screen shows when the vault was last changed: a
  date you do not recognise is the signal (`decisions/0016`). The lock screen's offer to
  put the previous vault back asks for *that* vault's passphrase first and swaps nothing
  until it opens it — otherwise a moment at your keyboard would be enough to change which
  vault your machine opens (`decisions/0018`).

- **Restoring a backup asks for two passphrases, and you choose how many.** The lock
  screen offers to restore a backup file over the vault on this device — it has to, since
  the case it exists for is a vault you can no longer open. It used to ask for nothing at
  all, which made the sentence above about the undo being the only gated control on that
  screen an overclaim, and let the same press twice consume the one archive slot without
  a passphrase being typed at any point. It now asks for the **backup file's** passphrase
  (the file is one you can open, not one you merely carried in) and then for **this
  device's** (the vault being pushed aside is yours to push). One phrase that opens both
  is typed once. **Restoring a backup** under Housekeeping in the unlocked app lowers that
  to the file's phrase alone, or to nothing — and only from there, because a switch that
  turned the gate off from the lock screen would *be* the gate (`decisions/0019`).
  Two things this does not change. There is still one slot for the vault set aside, so a
  second restore spends it — **at the default setting** that now means opening the vault
  the first restore installed, but at either weaker setting the original two-restore
  path is exactly as open as it was: two files of someone else's, two presses, and the
  vault this device started with is gone from disk. That is the cost of turning the
  second half off, and it is why it is not the default. And with the default setting and
  no memory of this device's phrase, this browser will not restore over that vault at
  all: the way out is to clear the extension's data, erasing a vault nobody could have
  opened. Keep your own export somewhere else.

**Known limitation:** Copy remains the fallback for pages autofill cannot reach, and is
only offered in the full tab. It clears the clipboard 30 seconds after you return to that
tab (the browser will not let a background page touch the clipboard) — note your OS may
keep its own clipboard history.

### Develop

```bash
cd app
npm install
npm run dev    # http://localhost:5199
npm test       # vitest: crypto, backup, credential-persistence, schedule and screen suites
npm run build  # production build in dist/ (web page + extension), CSP injected
npm run visual # drives the whole onboarding in a real browser, screenshots each screen
npm run autofill  # loads the packed extension in a real browser and tests the fill path
npm run journey   # walks the entire product once, in the extension, as a user would
```

Most of `npm test` runs under `node` with no DOM. The screens are the exception:
files starting `// @vitest-environment jsdom` render React components, and they
are where the *refusals* are checked — the restore gate, the undo gate, the
onboarding refusal, the origin-mismatch warning, the passphrase-change gate.
Those cost two dev-only dependencies, `jsdom` and `@testing-library/react`,
which is a supply-chain addition to a password manager and so worth stating
plainly: neither is in `dependencies`, neither reaches the extension, and the
production build has exactly the four runtime dependencies it always had. Under
those tests the crypto is real — real AES-GCM, real header binding, the real
storage layer over an in-memory `idb` — and only Argon2id is stubbed, because
256 MiB per assertion would make the suite take minutes.

`npm run journey` is the one that answers "does the thing actually work". In a
single fresh browser profile it builds a vault from the welcome screen (tutorial,
demo walk, generated phrase, placement, all three gauntlets, mastery gate), saves
a credential, exports a backup as a real download, locks and reopens with nothing
but the generated phrase, fills that credential into a real login form from the
real toolbar popup, restores the backup over a vault that has changed since,
undoes the restore, and changes the master passphrase. 35 checks, every one of
them against what is on screen rather than against internal state. It needs Edge,
for the same reason `autofill` does, and takes a few minutes — most of it Argon2id.

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
