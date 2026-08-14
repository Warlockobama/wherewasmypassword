/**
 * Turn `dist/` into the thing a person downloads.
 *
 *   npm run package
 *
 * James's ruling on `decisions/0022` was "one now" — a packaged download, with
 * the Chrome/Edge store held until the extension is stable enough for an
 * audience. This is that package: a zip of the built extension, a SHA-256 of
 * the zip, and a set of checks that the archive is the thing it claims to be.
 *
 * Deliberately dependency-free, like every other script here. Node has no zip
 * writer, so there is a small one at the bottom of this file — a password
 * manager is the wrong place to add a build-time dependency for eighty lines of
 * well-specified format.
 *
 * WHAT IT REFUSES TO PACKAGE, and why each one is worth a check rather than a
 * habit:
 *
 *  - A version in `package.json` that disagrees with the one in the manifest.
 *    They had already drifted (1.0.0 against 1.1.0) with nothing to notice, and
 *    the manifest's is the one a browser shows the user.
 *  - A permission set other than the four the extension has always asked for.
 *    The autofill harness checks this against a running browser; a release is
 *    the other moment it matters, because a package is what reaches someone
 *    who will never read the manifest.
 *  - Any host permission at all. `activeTab` is the whole reason the popup
 *    exists, and a build that quietly acquired "read and change all your data
 *    on every website" must not be the one that gets a download link.
 *  - Optional permissions, and registered content scripts. Both are host or
 *    API access arriving by a door the two checks above do not watch — one
 *    behind a runtime `permissions.request()`, the other in a `matches` list.
 *  - Source maps, including the inline kind, which has no `.map` file to
 *    notice. They are not emitted today; if they ever are, they do not belong
 *    in a shipped artifact.
 *  - A version that already has a tag, from a tree that is not that tag. Two
 *    different archives called 1.1.0 is the one thing that makes the published
 *    checksum worthless, and `decisions/0027` (ship the review later) is exactly
 *    the shape of decision that leaves master ahead of its version number. See
 *    `scripts/release-guard.mjs`.
 *
 * Exits non-zero if any of that fails, having written nothing.
 */
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OVERRIDE, repackageProblem, tagFacts } from './release-guard.mjs'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(APP_DIR, 'dist')
const OUT_DIR = join(APP_DIR, 'release')

/** Exactly what this extension asks for, and has since `decisions/0017`. */
const EXPECTED_PERMISSIONS = ['activeTab', 'alarms', 'scripting', 'storage']

async function filesUnder(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await filesUnder(full)))
    else found.push(full)
  }
  return found
}

async function main() {
  if (!existsSync(join(DIST, 'manifest.json'))) {
    throw new Error('dist/manifest.json is missing — run the build first')
  }

  const pkg = JSON.parse(await readFile(join(APP_DIR, 'package.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'))

  const problems = []
  if (pkg.version !== manifest.version) {
    problems.push(
      `package.json says version ${pkg.version} and the manifest says ${manifest.version}. ` +
        'The manifest is what a browser shows; make them agree before packaging.',
    )
  }
  const permissions = [...(manifest.permissions ?? [])].sort()
  if (JSON.stringify(permissions) !== JSON.stringify(EXPECTED_PERMISSIONS)) {
    problems.push(
      `the manifest asks for ${JSON.stringify(permissions)}, not ${JSON.stringify(EXPECTED_PERMISSIONS)}. ` +
        'A permission is a decision taken in the open, not one that ships in a package.',
    )
  }
  if (manifest.host_permissions?.length || manifest.optional_host_permissions?.length) {
    problems.push(
      'the manifest requests host permissions. The popup exists precisely so that it ' +
        'does not need any (`decisions/0011`), and a release must not be the build that changed that.',
    )
  }
  // Optional permissions are not a smaller version of permissions: they are the
  // same grants behind a `chrome.permissions.request()` the user meets once, in
  // a dialog, with no release note beside it. The check above compares an exact
  // set precisely so that nothing arrives unannounced, and a build that listed
  // `tabs` here would have walked straight through it.
  if (manifest.optional_permissions?.length) {
    problems.push(
      `the manifest offers optional permissions ${JSON.stringify(manifest.optional_permissions)}. ` +
        'Optional or not, they are grants this extension can ask for at runtime, and the ' +
        'permission set a release ships is the one written down.',
    )
  }
  // A registered content script carries its own host access in `matches`, which
  // never appears in `host_permissions` — the same door, a different frame.
  // Nothing is registered today; `content.js` is injected through `scripting`
  // against the tab `activeTab` conferred, which is the whole design.
  if (manifest.content_scripts?.length) {
    problems.push(
      'the manifest registers content scripts. Their `matches` are host access that no ' +
        'host-permission check sees, and this extension injects through `scripting` on the ' +
        'tab `activeTab` gave it instead (`decisions/0011`).',
    )
  }

  // Read `dist/` once: the same bytes get checked and then archived, and the
  // entries are ordered by the path each will carry *in the zip*, not by the
  // path the host filesystem uses. Sorting native paths would order `icons/i.png`
  // against `icons2.png` differently on Windows (`\`, 0x5C) and on POSIX (`/`,
  // 0x2F), so the same commit could produce two byte-different archives — which
  // is exactly the cross-platform rebuild the published checksum invites.
  const entries = []
  for (const file of await filesUnder(DIST)) {
    // Zip paths are forward-slashed on every platform, whatever the host uses.
    entries.push({ path: relative(DIST, file).split(sep).join('/'), body: await readFile(file) })
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const maps = entries.filter((e) => e.path.endsWith('.map'))
  if (maps.length) {
    problems.push(`the build emitted source maps: ${maps.map((e) => e.path).join(', ')}`)
  }
  // The check above is a filename, and `build.sourcemap: 'inline'` emits no
  // filename at all — it base64s the map into the bottom of the .js. Same
  // source, shipped, past a check looking for a `.map`.
  const inlined = entries.filter(
    (e) => /\.(js|css|html)$/.test(e.path) && e.body.includes('sourceMappingURL=data:'),
  )
  if (inlined.length) {
    problems.push(
      `these carry an inline source map: ${inlined.map((e) => e.path).join(', ')}. ` +
        'A map with no filename is still the source.',
    )
  }

  // Asked of git rather than of the tree, and only when the version already has
  // a tag — see `scripts/release-guard.mjs` for why this is a refusal.
  const repackage = repackageProblem({
    version: manifest.version,
    ...tagFacts(manifest.version, APP_DIR),
    override: Boolean(process.env[OVERRIDE]),
  })
  if (repackage) problems.push(repackage)

  if (problems.length) {
    console.error(`Refusing to package — ${problems.length} problem(s):`)
    problems.forEach((p) => console.error(`  - ${p}`))
    process.exitCode = 1
    return
  }

  await mkdir(OUT_DIR, { recursive: true })
  const name = `wherewasmypassword-${manifest.version}.zip`
  const zipPath = join(OUT_DIR, name)

  const zip = buildZip(entries)
  await writeFile(zipPath, zip)

  const sha256 = createHash('sha256').update(zip).digest('hex')
  await writeFile(join(OUT_DIR, `${name}.sha256`), `${sha256}  ${name}\n`)

  console.log(`\nPackaged ${entries.length} files from dist/\n`)
  for (const entry of entries) {
    console.log(`  ${entry.path.padEnd(34)} ${String(entry.body.length).padStart(7)} bytes`)
  }
  console.log(`\n  ${relative(APP_DIR, zipPath)}`)
  console.log(`  ${zip.length} bytes`)
  console.log(`  SHA-256  ${sha256}\n`)
  console.log('Install: unzip it, open edge://extensions (or chrome://extensions),')
  console.log('turn on Developer mode, and Load unpacked onto the unzipped folder.')
}

// ────────────────────────────────────────────────────────────────────────────
// A minimal ZIP writer.
//
// Only the parts a browser needs to load an unpacked extension: local file
// headers, deflate-compressed bodies, a central directory, and an end-of-
// -central-directory record. No zip64 (nothing here is near 4 GiB), no
// directory entries (every path is a file), no data descriptors.
// ────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * The MS-DOS date and time every entry is stamped with.
 *
 * Fixed, not each file's mtime, so that packaging the same `dist/` twice gives
 * a byte-identical zip and therefore the same SHA-256. That is the whole point
 * of publishing a checksum for a download that will never auto-update: someone
 * who does not want to trust the file can rebuild from the tag and compare, and
 * a checksum that changed with the clock would make that impossible.
 *
 * 1980-01-01 00:00 is the earliest the format can represent — the zero of the
 * DOS epoch, and unmistakably a placeholder rather than a real build time.
 */
const FIXED_STAMP = { time: 0, day: (0 << 9) | (1 << 5) | 1 }

function buildZip(entries) {
  const chunks = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const compressed = deflateRawSync(entry.body)
    // Deflate is not guaranteed to be smaller — a 172-byte PNG is already
    // compressed — and storing the larger of the two would be silly.
    const stored = compressed.length >= entry.body.length
    const body = stored ? entry.body : compressed
    const { time, day } = FIXED_STAMP
    const crc = crc32(entry.body)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed (2.0 — deflate)
    // Bit 11: the name is UTF-8. Without it a non-ASCII path is read as CP437.
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(stored ? 0 : 8, 8) // method: store or deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(entry.body.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // no extra field
    chunks.push(local, name, body)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0) // central directory header signature
    header.writeUInt16LE(20, 4) // version made by
    header.writeUInt16LE(20, 6) // version needed
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(stored ? 0 : 8, 10)
    header.writeUInt16LE(time, 12)
    header.writeUInt16LE(day, 14)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(body.length, 20)
    header.writeUInt32LE(entry.body.length, 24)
    header.writeUInt16LE(name.length, 28)
    // extra, comment, disk number, internal attrs all zero
    // External attributes: a regular file, 0644. The shift lands past bit 31,
    // where JS bitwise operators produce a signed result — hence the `>>> 0`.
    header.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += local.length + name.length + body.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // end of central directory signature
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, directory, end])
}

await main()
