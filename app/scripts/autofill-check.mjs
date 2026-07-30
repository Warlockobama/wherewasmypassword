/**
 * Drives the PACKED EXTENSION in a real browser and exercises the autofill
 * path end to end, because unit tests cannot answer the only question that
 * matters about it: does a password actually land in the login form?
 *
 *   npm run build && npm run autofill
 *
 * Deliberately dependency-free, in the same style as `visual-check.mjs`: it
 * serves its own test pages, launches an already-installed Chromium browser
 * with `--load-extension=dist`, and drives everything over the DevTools
 * protocol.
 *
 * It runs the suite TWICE:
 *
 *   1. Against `dist/` exactly as shipped. This is the real product.
 *   2. Against a scratch copy whose manifest also carries a host permission
 *      for the test origin. That second pass isolates "the fill logic is
 *      wrong" from "the extension was never allowed to touch the page" — it
 *      is a diagnostic, not a product configuration, and the extension does
 *      not ship that permission.
 *
 * Exits non-zero if any pass-1 expectation fails.
 */
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { cp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(APP_DIR, 'dist')
const PORT = 5189
const ORIGIN = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = 9334

// Edge first, deliberately: Chrome 137 and later ignore `--load-extension`
// entirely (it was removed as an attack vector), so on a current Chrome the
// extension silently never loads and every check below would be vacuous.
// Edge is the same Chromium engine and still honours the switch.
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]

/** A believable login form, plus a decoy text input outside it. */
const LOGIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Login</title></head>
<body><h1>Sign in</h1>
<form id="login">
  <input name="username" autocomplete="username" style="width:200px;height:24px">
  <input name="password" type="password" autocomplete="current-password" style="width:200px;height:24px">
  <button type="submit">Sign in</button>
</form>
<form id="newsletter"><input name="q" type="text" style="width:200px;height:24px"></form>
</body></html>`

/** Every field an off-screen harvester would use, and nothing visible. */
const HARVEST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Article</title></head>
<body><h1>Just an article</h1>
<input name="user" style="width:1px;height:1px">
<input name="pw1" type="password" style="width:1px;height:1px">
<input name="pw2" type="password" style="width:200px;height:24px;opacity:0">
<input name="pw3" type="password" style="position:absolute;left:-9999px;width:200px;height:24px">
<input name="pw4" type="password" style="display:none">
<input name="pw5" type="password" style="position:absolute;left:9999px;width:200px;height:24px">
<div style="opacity:0"><input name="pw6" type="password" style="width:200px;height:24px"></div>
<input name="pw7" type="password" disabled style="width:200px;height:24px">
<div style="position:relative;width:200px;height:24px">
  <input name="pw8" type="password" style="position:absolute;inset:0;width:200px;height:24px">
  <div style="position:absolute;inset:0;background:#fff"></div>
</div>
<input name="pw9" type="password" style="width:200px;height:24px;visibility:hidden">
<input name="pw10" type="password" readonly style="width:200px;height:24px">
<div style="visibility:hidden"><input name="pw11" type="password" style="width:200px;height:24px"></div>
</body></html>`

function startServer() {
  const server = createServer((req, res) => {
    const path = new URL(req.url, ORIGIN).pathname
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(path === '/harvest' ? HARVEST_PAGE : LOGIN_PAGE)
  })
  return new Promise((ok) => server.listen(PORT, '127.0.0.1', () => ok(server)))
}

let nextId = 1
function rpc(ws, method, params = {}, sessionId) {
  const id = nextId++
  return new Promise((ok, fail) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== id) return
      ws.removeEventListener('message', onMessage)
      msg.error ? fail(new Error(`${method}: ${msg.error.message}`)) : ok(msg.result)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

/**
 * Chromium derives an unpacked extension's ID from its absolute path: the
 * first 16 bytes of SHA-256 over the path (UTF-16LE on Windows), each nibble
 * mapped 0->a .. 15->p. Knowing it up front is what lets this script tell
 * "our extension loaded" apart from "a component extension is present".
 */
function unpackedExtensionId(path) {
  const hash = createHash('sha256').update(Buffer.from(path, 'utf16le')).digest()
  return [...hash.subarray(0, 16)]
    .flatMap((b) => [b >> 4, b & 0xf])
    .map((n) => String.fromCharCode(97 + n))
    .join('')
}

async function devToolsUrl(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      return (await res.json()).webSocketDebuggerUrl
    } catch {
      await sleep(250)
    }
  }
  throw new Error('browser DevTools endpoint never came up')
}

/** Build the diagnostic copy of dist/ that carries a host permission. */
async function scratchBuildWithHostPermission() {
  const dir = join(tmpdir(), `wwmp-autofill-hostperm-${process.pid}`)
  await mkdir(dir, { recursive: true })
  await cp(DIST, dir, { recursive: true, force: true })
  const manifest = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'))
  manifest.host_permissions = [`http://127.0.0.1/*`]
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return dir
}

/**
 * Run the whole suite against one extension directory.
 * Returns the list of {name, passed, detail} results.
 */
async function runSuite({ extDir, browser, port, label }) {
  const results = []
  const check = (name, passed, detail) => {
    results.push({ name, passed, detail })
    console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`)
  }

  const profile = join(tmpdir(), `wwmp-autofill-${process.pid}-${port}`)
  const child = spawn(browser, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    'about:blank',
  ])
  child.stderr.resume()

  let ws
  try {
    ws = new WebSocket(await devToolsUrl(port))
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok, { once: true })
      ws.addEventListener('error', () => fail(new Error('devtools socket failed')), { once: true })
    })

    // Wait for OUR extension specifically. A browser always has component
    // extensions loaded, so "some extension target exists" proves nothing.
    const extId = unpackedExtensionId(extDir)
    let loaded = false
    for (let i = 0; i < 40 && !loaded; i++) {
      const { targetInfos } = await rpc(ws, 'Target.getTargets')
      loaded = targetInfos.some((t) => t.url.startsWith(`chrome-extension://${extId}/`))
      if (!loaded) await sleep(250)
    }
    if (!loaded) {
      throw new Error(
        `the extension never loaded (no target under chrome-extension://${extId}/). ` +
          'Chrome 137+ ignores --load-extension; use Microsoft Edge, or load dist/ by hand.',
      )
    }
    console.log(`\n──── ${label} ────\nExtension ${extId} loaded from ${extDir}\n`)

    const openTab = async (url) => {
      const { targetId } = await rpc(ws, 'Target.createTarget', { url })
      const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true })
      const call = (method, params) => rpc(ws, method, params, sessionId)
      await call('Runtime.enable')
      await call('Page.enable')
      await sleep(600)
      return {
        targetId,
        activate: () => rpc(ws, 'Target.activateTarget', { targetId }),
        close: () => rpc(ws, 'Target.closeTarget', { targetId }),
        async evaluate(expression) {
          const { result, exceptionDetails } = await call('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
          })
          if (exceptionDetails) throw new Error(`${exceptionDetails.text} :: ${expression.slice(0, 70)}`)
          return result.value
        },
      }
    }

    const loginTab = await openTab(`${ORIGIN}/login`)
    // The extension's own UI, opened exactly the way the toolbar icon opens it.
    const extTab = await openTab(`chrome-extension://${extId}/index.html`)

    /** Fire the same message the app's `requestAutofill()` sends. */
    const relay = (request) =>
      extTab.evaluate(`new Promise((ok) => {
        chrome.runtime.sendMessage(${JSON.stringify({ type: 'wwmp-autofill-relay', ...request })},
          (r) => ok(chrome.runtime.lastError
            ? { ok: false, reason: 'send-failed', detail: chrome.runtime.lastError.message }
            : r))
      })`)

    const fieldValues = (tab) =>
      tab.evaluate(`[...document.querySelectorAll('input')].map((i) => i.name + '=' + i.value).join(',')`)
    const clearFields = (tab) =>
      tab.evaluate(`([...document.querySelectorAll('input')].forEach((i) => (i.value = '')), true)`)

    // --------------------------------------------------------------------
    // Diagnostic: which tab does the worker's own query actually resolve to,
    // and is its URL even readable? `tabs.query` hides `url` from an
    // extension with no host permission for that tab, which silently defeats
    // any guard written against `tab.url`.
    console.log('Diagnostic: what the background worker sees')
    await extTab.activate()
    await sleep(300)
    const seen = await extTab.evaluate(`new Promise((ok) =>
      chrome.tabs.query({ active: true, currentWindow: true }, (t) =>
        ok(JSON.stringify(t.map((x) => ({ id: x.id, url: x.url ?? null, active: x.active })))))
    )`)
    console.log(`          active tab per tabs.query: ${seen}`)

    // The toolbar click cannot be driven over the DevTools protocol, so the
    // API it now relies on to focus an existing UI tab is checked directly.
    const contexts = await extTab.evaluate(`(async () => {
      try {
        const c = await chrome.runtime.getContexts({
          contextTypes: ['TAB'],
          documentUrls: [chrome.runtime.getURL('index.html')],
        })
        return JSON.stringify(c.map((x) => ({ tabId: x.tabId, windowId: x.windowId })))
      } catch (e) { return 'THREW: ' + e.message }
    })()`)
    check(
      'the toolbar click can find an already-open UI tab without the tabs permission',
      contexts.startsWith('[') && JSON.parse(contexts).some((c) => c.tabId >= 0),
      `runtime.getContexts -> ${contexts}`,
    )

    // -------------------------------------------------------------------- 1
    console.log('\nScenario: extension tab active (the real flow)')
    const realFlow = await relay({
      username: 'someone@example.com',
      password: 'correct-horse-battery',
      expectedOrigin: ORIGIN,
    })
    const realFlowFields = await fieldValues(loginTab)
    check(
      'autofill reaches the login page from the extension tab',
      realFlow?.filled === true && realFlowFields.includes('password=correct-horse-battery'),
      `relay=${JSON.stringify(realFlow)} fields=[${realFlowFields}]`,
    )

    // -------------------------------------------------------------------- 2
    console.log('\nScenario: login page active (control — proves the plumbing works)')
    await clearFields(loginTab)
    await loginTab.activate()
    await sleep(300)
    const control = await relay({
      username: 'someone@example.com',
      password: 'correct-horse-battery',
      expectedOrigin: ORIGIN,
    })
    const controlFields = await fieldValues(loginTab)
    check(
      'relay fills when the login page is the active tab',
      control?.filled === true && controlFields.includes('password=correct-horse-battery'),
      `relay=${JSON.stringify(control)} fields=[${controlFields}]`,
    )
    check(
      'username goes in the login form, not the newsletter box',
      controlFields.includes('username=someone@example.com') && controlFields.includes('q='),
      `fields=[${controlFields}]`,
    )

    // -------------------------------------------------------------------- 3
    console.log('\nScenario: origin mismatch (a look-alike phishing page)')
    await clearFields(loginTab)
    const mismatch = await relay({
      username: 'someone@example.com',
      password: 'correct-horse-battery',
      expectedOrigin: 'https://bank.example.com',
    })
    const mismatchFields = await fieldValues(loginTab)
    check(
      'a mismatched origin is refused and nothing is typed',
      mismatch?.filled !== true && !mismatchFields.includes('correct-horse-battery'),
      `relay=${JSON.stringify(mismatch)} fields=[${mismatchFields}]`,
    )
    check(
      'the refusal names both origins so the UI can ask',
      mismatch?.reason === 'origin-mismatch' &&
        mismatch?.pageOrigin === ORIGIN &&
        mismatch?.expectedOrigin === 'https://bank.example.com',
      `relay=${JSON.stringify(mismatch)}`,
    )

    const override = await relay({
      username: 'someone@example.com',
      password: 'correct-horse-battery',
      expectedOrigin: 'https://bank.example.com',
      overrideOrigin: ORIGIN,
    })
    const overrideFields = await fieldValues(loginTab)
    check(
      'an override naming the origin the user approved does fill',
      override?.filled === true && overrideFields.includes('password=correct-horse-battery'),
      `relay=${JSON.stringify(override)} fields=[${overrideFields}]`,
    )

    await clearFields(loginTab)
    const staleOverride = await relay({
      username: 'someone@example.com',
      password: 'correct-horse-battery',
      expectedOrigin: 'https://bank.example.com',
      // The user approved a different origin; the page navigated in between.
      overrideOrigin: 'https://somewhere-else.example',
    })
    const staleFields = await fieldValues(loginTab)
    check(
      'an override approved for a different origin is not honoured here',
      staleOverride?.filled !== true && !staleFields.includes('correct-horse-battery'),
      `relay=${JSON.stringify(staleOverride)} fields=[${staleFields}]`,
    )

    // ------------------------------------------------------------------- 3b
    console.log('\nScenario: a credential saved with no site at all')
    await clearFields(loginTab)
    const noOrigin = await relay({
      username: 'someone@example.com',
      password: 'correct-horse-battery',
      expectedOrigin: '',
    })
    const noOriginFields = await fieldValues(loginTab)
    check(
      'a credential with no stored site is not filled silently',
      noOrigin?.filled !== true &&
        noOrigin?.reason === 'no-stored-origin' &&
        !noOriginFields.includes('correct-horse-battery'),
      `relay=${JSON.stringify(noOrigin)} fields=[${noOriginFields}]`,
    )
    const noOriginApproved = await relay({
      username: 'someone@example.com',
      password: 'correct-horse-battery',
      expectedOrigin: '',
      overrideOrigin: ORIGIN,
    })
    check(
      'and does fill once the user approves this page for it',
      noOriginApproved?.filled === true,
      `relay=${JSON.stringify(noOriginApproved)}`,
    )

    // -------------------------------------------------------------------- 4
    console.log('\nScenario: a page whose only password fields are hidden')
    const harvestTab = await openTab(`${ORIGIN}/harvest`)
    await harvestTab.activate()
    await sleep(300)
    const harvest = await relay({
      username: 'someone@example.com',
      password: 'correct-horse-battery',
      expectedOrigin: ORIGIN,
    })
    const harvestFields = await fieldValues(harvestTab)
    check(
      'hidden, tiny, transparent, off-screen, disabled and covered fields are all refused',
      harvest?.filled !== true && !harvestFields.includes('correct-horse-battery'),
      `relay=${JSON.stringify(harvest)} fields=[${harvestFields}]`,
    )
    await harvestTab.close()

    // -------------------------------------------------------------------- 5
    console.log('\nScenario: repeated fills (content-script listener stacking)')
    await loginTab.activate()
    await sleep(300)
    await clearFields(loginTab)
    await loginTab.evaluate(`(window.__fillCount = 0,
      document.querySelector('input[type=password]')
        .addEventListener('input', () => window.__fillCount++), true)`)
    for (let i = 0; i < 3; i++) {
      await relay({ username: 'u', password: 'p', expectedOrigin: ORIGIN })
      await sleep(150)
    }
    const fills = await loginTab.evaluate(`window.__fillCount`)
    check(
      'three fills fire three input events, not six or nine',
      fills === 3,
      `input events on the password field: ${fills}`,
    )

    // -------------------------------------------------------------------- 6
    console.log('\nScenario: a plain web page trying to reach the extension')
    const pageReach = await loginTab.evaluate(
      `typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage
        ? 'unreachable' : 'REACHABLE'`,
    )
    check(
      'a web page cannot call the extension messaging API',
      pageReach === 'unreachable',
      `page sees chrome.runtime.sendMessage as: ${pageReach}`,
    )

    await loginTab.evaluate(
      `(window.postMessage({ type: 'wwmp-autofill', username: 'x', password: 'spoofed' }, '*'), true)`,
    )
    await sleep(250)
    const afterSpoof = await fieldValues(loginTab)
    check(
      'window.postMessage cannot drive the content script',
      !afterSpoof.includes('spoofed'),
      `fields=[${afterSpoof}]`,
    )

    await extTab.close()
    await loginTab.close()
  } finally {
    try {
      ws?.close()
    } catch {
      /* already gone */
    }
    child.kill()
  }
  return results
}

async function main() {
  if (!existsSync(join(DIST, 'manifest.json'))) {
    throw new Error('dist/manifest.json is missing — run the build first')
  }
  const browser = BROWSERS.find((p) => existsSync(p))
  if (!browser) throw new Error('no Chrome or Edge found in the usual install locations')
  console.log(`Browser: ${browser}`)

  const server = await startServer()
  let shipped = []
  let diagnostic = []
  try {
    shipped = await runSuite({
      extDir: DIST,
      browser,
      port: DEBUG_PORT,
      label: 'PASS 1 — the extension exactly as shipped',
    })
    const scratch = await scratchBuildWithHostPermission()
    diagnostic = await runSuite({
      extDir: scratch,
      browser,
      port: DEBUG_PORT + 1,
      label: 'PASS 2 — DIAGNOSTIC ONLY: same build plus a host permission for the test origin',
    })
  } finally {
    server.close()
  }

  const failedShipped = shipped.filter((r) => !r.passed)
  const failedDiag = diagnostic.filter((r) => !r.passed)

  console.log('\n════════ summary ════════')
  console.log(`  as shipped:  ${shipped.length - failedShipped.length}/${shipped.length} passed`)
  console.log(`  diagnostic:  ${diagnostic.length - failedDiag.length}/${diagnostic.length} passed`)
  if (failedShipped.length > failedDiag.length) {
    console.log(
      '\n  The checks that fail as shipped but pass with a host permission are not\n' +
        '  fill-logic bugs: the fill logic is sound. They fail because `activeTab` is\n' +
        '  never granted for the tab being filled — the toolbar click opens the UI in\n' +
        '  a NEW tab, so the grant lands on the page the user was looking at while the\n' +
        '  request targets the extension\'s own tab. Autofill cannot work from a full\n' +
        '  tab; that is the popup-versus-tab question in decisions/0009.\n' +
        '\n  Expect this script to stay red until 0009 item 3 is decided.',
    )
  }
  if (failedShipped.length) {
    console.error(`\nFAILED — ${failedShipped.length} of ${shipped.length} checks against the shipped build:`)
    failedShipped.forEach((f) => console.error(`  - ${f.name}`))
    process.exitCode = 1
  } else {
    console.log('\nAll autofill checks passed against the shipped build.')
  }
}

await main()
