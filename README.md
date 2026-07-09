# Where Was My Password

A password manager with one unusual promise: **you will actually remember your master
passphrase** — a long, random, genuinely strong one — without ever writing it down.

Inspired by *Moonwalking with Einstein* and the 2,500-year-old **method of loci**: spatial
memory vastly outperforms working memory, so the app teaches you to hide each word of a
randomly generated passphrase at a spot along a fixed route through an illustrated house
(mailbox → doormat → coat closet → fireplace → oven → fridge → mirror → wardrobe), wrapped
in a vivid image of your own invention. Recall = walking the route in your mind.

Earlier prototypes (in `wherewasmypassword/`, `go_wwmp/`, `deeps/`) tried Google Street View
as the memory space; they died on the same rock: real-map imagery can't do **occlusion** —
you can't hide something in a drawer and open it later. The illustrated house can.

## The app (v1) — `app/`

- **Tutorial**: the method explained, then a risk-free demo walk with a throwaway phrase.
- **Generation**: diceware passphrase from the EFF large wordlist (5–8 words, default 6
  ≈ 77.5 bits), rolled with `crypto.getRandomValues`, per-word re-roll.
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
- Auto-lock after 5 minutes idle, or 60 seconds after the tab is hidden.
- If you forget the phrase, nothing can recover the vault. That's the deal — and the
  whole point of the training.

### Develop

```bash
cd app
npm install
npm run dev    # http://localhost:5199
npm test       # vitest: crypto, backup, schedule suites
npm run build  # static production build in dist/, CSP injected
```

Deploy `app/dist/` to any static host. There is nothing else to run.
