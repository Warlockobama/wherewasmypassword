# Cutting a release

`decisions/0022` settled how v1 reaches someone who is not holding a Node
toolchain: **a tagged GitHub release with a zip and a checksum, now; the Chrome
Web Store and Edge Add-ons later**, once the extension is stable enough to want
an audience. James's words were "one now" and "we'll go with the store once we
have it stable and ready for an audience."

That choice has a consequence worth keeping in front of you every time you run
this list: **there is no update channel.** Whoever loads this zip stays on it
until they notice a newer one and load that instead. A bug shipped here does not
get recalled. That is the whole reason the checklist ends where it does.

## The list

Everything happens in `app/`, and on a clean tree — a release should be a
commit anyone can check out, not a state of somebody's laptop.

1. **Decide the version.** It lives in `public/manifest.json`, and
   `package.json` must agree; `npm run package` refuses if they do not. Bump
   both in one commit.

   It also refuses to package a version that is **already a tag** from a tree
   that is not that tag — the case `decisions/0027` creates every time a feature
   lands and the release waits. Two archives called 1.1.0 is precisely what
   makes the published checksum worth nothing, so this step is enforced rather
   than remembered (`scripts/release-guard.mjs`).

2. **Gates, all five, all green.**

   ```bash
   npm test          # unit + screen suites
   npm run build     # tsc -b && vite build; CSP injected
   npm run visual    # onboarding in a real browser, every screen shot
   npm run autofill  # the packed extension's fill path, both passes
   npm run journey   # the whole product end to end, in the extension
   ```

   `autofill` and `journey` need Microsoft Edge: Chrome 137 and later ignore
   `--load-extension`, so on Chrome they would pass vacuously. `visual` serves
   `dist/` as a page and drives whichever browser it finds, so it does not care.

3. **Look at the screenshots.** `npm run visual` writes `screenshots/`. They
   are gitignored and they are the point — a layout regression is not something
   a passing assertion catches.

4. **Package it.**

   ```bash
   npm run package
   ```

   Builds, then writes `release/wherewasmypassword-<version>.zip` and a
   `.sha256` beside it. It refuses to package a build whose manifest asks for
   any permission set other than exactly `activeTab`, `scripting`, `storage`
   and `alarms` — fewer is as much a surprise as more — one that requests host
   permissions at all, or one carrying source maps. Those are not
   ceremony: a package is what reaches someone who will never read a manifest.

   **The zip is reproducible.** Every entry is stamped 1980-01-01 rather than
   with its mtime, so building the same commit twice gives a byte-identical
   archive and the same SHA-256. That is what makes the published checksum
   worth publishing: a stranger can check out the tag, run `npm run package`,
   and compare, rather than taking our word for the file. If you ever change
   the packaging, check that property still holds — package twice and diff the
   hashes, and once from a fresh clone rather than only from this working tree.

   **The v1.1.0 archive is the exception, and it is worth knowing why.** Its
   entries came from a tree whose line endings were the ones this machine
   happened to have; `public/` is copied into `dist/` byte for byte, so a fresh
   checkout on Windows produced CRLF where the published zip has LF and the
   checksum did not match. `.gitattributes` pins that from `04cfe19` onward
   (`decisions/0028`), which makes the property true for the next release and
   leaves v1.1.0 unreproducible from its tag.

5. **Load the zip itself — not `dist/`.** Unzip it somewhere else, open
   `edge://extensions` (or `chrome://extensions`), turn on Developer mode, and
   **Load unpacked** onto the unzipped folder. Everything up to here has tested
   a build tree; this is the first time anything tests the artifact.

6. **The one manual check no harness can do.** `activeTab` is conferred by the
   browser's own action-invocation path, and nothing over the DevTools protocol
   reaches it — measured, not assumed (see the README). So, by hand, on the
   extension you just loaded from the zip:

   1. Go to a real login page.
   2. Click the toolbar button.
   3. The popup should name that site — "Filling into example.com". That
      sentence *is* the proof the grant arrived, because the URL is unreadable
      without it.
   4. Unlock, click **Fill**, and watch the password land in the form.

   If the popup cannot name the site, stop. Nothing else in this list can catch
   that, and it is the one thing the product is for.

7. **Tag and publish.**

   ```bash
   git tag -a v<version> -m "..."
   git push origin master --tags
   gh release create v<version> \
     app/release/wherewasmypassword-<version>.zip \
     app/release/wherewasmypassword-<version>.zip.sha256 \
     --title "..." --notes-file <notes>
   ```

   Put the SHA-256 in the release notes as well as in the file. Someone
   checking a download should not have to download a second file to do it.

8. **Say what it is.** The notes should carry the install steps, the checksum,
   and the two things a person is owed before they trust a password manager
   with a zip: that it never auto-updates, and that a vault is local to the
   browser profile it was created in.

## When the store question comes back

`decisions/0022` deferred it rather than declining it, and named what a second
round would need to settle: whose developer account, and what the listing says
about data handling. Two things change on the day it stops being deferred —
the extension ID becomes stable and permanent, and every installed vault starts
receiving whatever is signed and pushed, silently. For this category of software
that second one is the decision, not the fee. It deserves its own doc.
