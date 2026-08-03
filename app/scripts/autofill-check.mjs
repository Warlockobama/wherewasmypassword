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
 * protocol — including the real toolbar popup, which `chrome.action.openPopup()`
 * opens and which attaches as an ordinary DevTools target.
 *
 * It runs the suite TWICE:
 *
 *   1. Against `dist/` exactly as shipped. This is the real product.
 *   2. Against a scratch copy whose manifest also carries a host permission
 *      for the test origin.
 *
 * THE ONE THING NO HARNESS CAN DO is click the toolbar button. `activeTab` is
 * conferred by the browser's own action-invocation path — a real click, a
 * commands-API shortcut, a context menu — and none of those are reachable over
 * CDP. Measured, not assumed: `chrome.action.openPopup()` opens the popup for
 * real but confers nothing; `Input.dispatchKeyEvent` never reaches the command
 * dispatcher (an extension command's `onCommand` does not fire, and an unpacked
 * extension's `suggested_key` is not even bound in a fresh profile); a
 * pre-seeded profile `Preferences` is discarded for a `--load-extension` build.
 *
 * So pass 2's host permission is not papering over a fill bug — the fill logic
 * is the same shipped code, driven from the same shipped popup. It stands in
 * for the ONE thing a script cannot produce: the grant a human's click makes.
 * Both passes must be green; the summary says which is which, and the README
 * carries the one manual click that closes the gap.
 *
 * Exits non-zero if any expectation in either pass fails.
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
// A second port is a second origin, which is what lets the suite navigate a tab
// out from under a resolved target and check what happens next.
const OTHER_PORT = 5190
const OTHER_ORIGIN = `http://127.0.0.1:${OTHER_PORT}`
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

function startServer(port) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, ORIGIN).pathname
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(path === '/harvest' ? HARVEST_PAGE : LOGIN_PAGE)
  })
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)))
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
 * What the shipped build promises about itself, checked against the files
 * rather than the running browser: the toolbar button must open the popup, it
 * must still be buying that without host permissions, and the one storage area
 * a derived key ever reaches must stay closed to page scripts.
 */
async function checkShippedBuild() {
  const results = []
  const check = (name, passed, detail) => {
    results.push({ name, passed, detail })
    console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`)
  }
  console.log('\n──── what the shipped manifest promises ────\n')
  const manifest = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'))

  check(
    'the toolbar button opens the popup rather than a tab',
    manifest.action?.default_popup === 'popup.html' && existsSync(join(DIST, 'popup.html')),
    `action.default_popup=${manifest.action?.default_popup} popup.html present=${existsSync(join(DIST, 'popup.html'))}`,
  )
  check(
    'no host permissions are requested — the popup is what makes activeTab enough',
    !manifest.host_permissions?.length && !manifest.optional_host_permissions?.length,
    `host_permissions=${JSON.stringify(manifest.host_permissions ?? null)}`,
  )
  // Deliberately an exact set rather than a subset: the point is that adding a
  // permission has to be a decision someone takes here, in the open, and not a
  // line that slips in with a feature. Two of these were bought that way:
  // `storage` by the five-minute popup session (`decisions/0015`) and `alarms`
  // by the ruling that the key must be *deleted* at its deadline rather than
  // merely refused (`decisions/0017`). Neither grants access to anything
  // outside this extension, and neither shows the user a new warning at install.
  check(
    'the permission set is still just activeTab + scripting + storage + alarms',
    JSON.stringify([...(manifest.permissions ?? [])].sort()) ===
      JSON.stringify(['activeTab', 'alarms', 'scripting', 'storage']),
    `permissions=${JSON.stringify(manifest.permissions)}`,
  )
  // The parked key lives in `chrome.storage.session`. Content scripts cannot
  // read that area by default, and the worker says so explicitly so that the
  // default changing — or someone opening the area up for something unrelated
  // — cannot quietly expose a key. If that line goes, this check goes red.
  const worker = await readFile(join(DIST, 'background.js'), 'utf8')
  check(
    'the worker pins session storage to trusted contexts',
    /setAccessLevel\(\s*\{\s*accessLevel:\s*'TRUSTED_CONTEXTS'\s*\}\s*\)/.test(worker),
    `setAccessLevel present=${worker.includes('setAccessLevel')}`,
  )
  // The permission is only worth having if something listens for what it buys.
  // The listener must be registered at the worker's top level, or the browser
  // has nothing to start the worker *for* and the alarm is delivered to nobody.
  check(
    'the worker listens for the deadline alarm that deletes the parked key',
    /chrome\.alarms\.onAlarm\.addListener/.test(worker) &&
      worker.includes("'popup-session-deadline'"),
    `onAlarm listener=${/chrome\.alarms\.onAlarm\.addListener/.test(worker)} ` +
      `alarm name present=${worker.includes("'popup-session-deadline'")}`,
  )
  return results
}

/**
 * Run the whole suite against one extension directory.
 *
 * `hasGrant` says whether this pass can reach page content at all. Without it
 * the fill checks cannot run — not because the fill code is different, but
 * because no script can produce the toolbar click that grants `activeTab`.
 */
async function runSuite({ extDir, browser, port, label, hasGrant }) {
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
    // Service workers and popups are only listed once discovery is on.
    await rpc(ws, 'Target.setDiscoverTargets', { discover: true })

    // Wait for OUR extension specifically. A browser always has component
    // extensions loaded, so "some extension target exists" proves nothing.
    const extId = unpackedExtensionId(extDir)
    const extPrefix = `chrome-extension://${extId}/`
    let loaded = false
    for (let i = 0; i < 40 && !loaded; i++) {
      const { targetInfos } = await rpc(ws, 'Target.getTargets')
      loaded = targetInfos.some((t) => t.url.startsWith(extPrefix))
      if (!loaded) await sleep(250)
    }
    if (!loaded) {
      throw new Error(
        `the extension never loaded (no target under ${extPrefix}). ` +
          'Chrome 137+ ignores --load-extension; use Microsoft Edge, or load dist/ by hand.',
      )
    }
    console.log(`\n──── ${label} ────\nExtension ${extId} loaded from ${extDir}\n`)

    const targets = async () => (await rpc(ws, 'Target.getTargets')).targetInfos
    const findTarget = async (predicate, tries = 40) => {
      for (let i = 0; i < tries; i++) {
        const found = (await targets()).find(predicate)
        if (found) return found
        await sleep(250)
      }
      return null
    }

    /** Attach to a target and hand back an `evaluate` for it. */
    const attach = async (targetId) => {
      const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true })
      await rpc(ws, 'Runtime.enable', {}, sessionId)
      return async (expression) => {
        const { result, exceptionDetails } = await rpc(
          ws,
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true },
          sessionId,
        )
        if (exceptionDetails) throw new Error(`${exceptionDetails.text} :: ${expression.slice(0, 70)}`)
        return result.value
      }
    }

    const openTab = async (url) => {
      const { targetId } = await rpc(ws, 'Target.createTarget', { url })
      const evaluate = await attach(targetId)
      await sleep(600)
      return {
        targetId,
        evaluate,
        activate: () => rpc(ws, 'Target.activateTarget', { targetId }),
        close: () => rpc(ws, 'Target.closeTarget', { targetId }),
      }
    }

    // ---- the extension's own service worker -----------------------------
    const swTarget = await findTarget(
      (t) => t.type === 'service_worker' && t.url.startsWith(extPrefix),
    )
    if (!swTarget) throw new Error('the extension service worker never appeared')
    const swEval = await attach(swTarget.targetId)
    // The worker target is listed a beat before `chrome` is live in it.
    for (let i = 0; i < 20; i++) {
      try {
        await swEval('chrome.runtime.id')
        break
      } catch {
        await sleep(250)
      }
    }

    /** Which tab the browser considers active, as a tab id. Needs no permission. */
    const activeTabId = () =>
      swEval(`new Promise((ok) => chrome.tabs.query({ active: true, currentWindow: true },
        (t) => ok(t[0] ? t[0].id : -1)))`)

    /**
     * Open the REAL toolbar popup and attach to it.
     *
     * `openPopup()` opens the same document a click opens — it just does not
     * carry the click's `activeTab` grant with it, which is the one gap this
     * harness cannot close.
     */
    const openToolbarPopup = async () => {
      const stale = (await targets()).find((t) => t.url === `${extPrefix}popup.html`)
      // A popup left over from an earlier step is pointed at the wrong tab, and
      // a second openPopup() while one is up throws.
      if (stale) await rpc(ws, 'Target.closeTarget', { targetId: stale.targetId })
      await swEval('chrome.action.openPopup()')
      const popup = await findTarget((t) => t.url === `${extPrefix}popup.html`)
      if (!popup) throw new Error('the toolbar popup never opened')
      const evaluate = await attach(popup.targetId)
      await sleep(400)
      return evaluate
    }

    /** Fire the same message the app's `requestAutofill()` sends. */
    const relayFrom = (evaluate, request) =>
      evaluate(`new Promise((ok) => {
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
    // Setup: a login page and a harvesting page, and the tab ids for both.
    // Ids are read while each tab is active, which needs no permission at all
    // — `tabs.query` hides a tab's URL without one, but never its id.
    const loginTab = await openTab(`${ORIGIN}/login`)
    await loginTab.activate()
    await sleep(300)
    const loginTabId = await activeTabId()

    const harvestTab = await openTab(`${ORIGIN}/harvest`)
    await harvestTab.activate()
    await sleep(300)
    const harvestTabId = await activeTabId()

    await loginTab.activate()
    await sleep(300)

    // -------------------------------------------------------------------- 1
    console.log('\nScenario: the toolbar popup opens on a login page')
    let popupEval = await openToolbarPopup()
    const popupSees = await popupEval(`new Promise((ok) =>
      chrome.tabs.query({ active: true, currentWindow: true },
        (t) => ok(JSON.stringify(t.map((x) => ({ id: x.id, url: x.url ?? null }))))))`)
    check(
      'the popup is pointed at the login page, not at the extension’s own UI',
      JSON.parse(popupSees)[0]?.id === loginTabId,
      `popup sees ${popupSees}; login tab is ${loginTabId}`,
    )
    // The whole reason for the popup: the tab underneath stays the active one.
    // Opening the UI in a tab is what used to move the grant off the login page.
    const stillActive = await activeTabId()
    check(
      'opening the popup does not make the extension the active tab',
      stillActive === loginTabId,
      `active tab is ${stillActive}, login tab is ${loginTabId}`,
    )

    // -------------------------------------------------------------------- 2
    console.log('\nScenario: opening the full memory house from the popup')
    const houseUrl = `${extPrefix}index.html`
    const houseCount = async () => (await targets()).filter((t) => t.url.startsWith(houseUrl)).length
    const opened = await popupEval(`new Promise((ok) =>
      chrome.runtime.sendMessage({ type: 'wwmp-open-app' },
        (r) => ok(chrome.runtime.lastError ? { ok: false, detail: chrome.runtime.lastError.message } : r)))`)
    await sleep(900)
    check(
      'the popup can open the memory house (the toolbar click no longer can)',
      opened?.ok === true && (await houseCount()) === 1,
      `response=${JSON.stringify(opened)} memory-house tabs=${await houseCount()}`,
    )

    // Twice must not mean two unlocked sessions, each holding its own key.
    popupEval = await openToolbarPopup()
    await popupEval(`new Promise((ok) => chrome.runtime.sendMessage({ type: 'wwmp-open-app' }, () => ok(1)))`)
    await sleep(900)
    check(
      'asking twice focuses the memory house instead of opening a second one',
      (await houseCount()) === 1,
      `memory-house tabs=${await houseCount()}`,
    )

    // -------------------------------------------------------------------- 3
    // The old full-tab flow sent no tab id and let the worker pick the active
    // tab. That fallback is gone: a request that names no tab is refused rather
    // than pointed at whatever is in front of the browser, which is the whole
    // invariant the popup buys. Asked for from the memory house — the exact
    // caller that used to do this — it must go nowhere.
    console.log('\nScenario: a fill request that names no tab')
    const houseTarget = (await targets()).find((t) => t.url.startsWith(houseUrl))
    const houseEval = await attach(houseTarget.targetId)
    await clearFields(loginTab)
    const fromHouse = await relayFrom(houseEval, {
      username: 'someone@example.com',
      password: 'correct-horse-battery',
      expectedOrigin: ORIGIN,
    })
    const houseFields = await fieldValues(loginTab)
    check(
      'a request naming no tab is refused, not retargeted at the active one',
      fromHouse?.filled !== true &&
        fromHouse?.reason === 'no-such-tab' &&
        !houseFields.includes('correct-horse-battery'),
      `relay=${JSON.stringify(fromHouse)} fields=[${houseFields}]`,
    )

    // -------------------------------------------------------------------- 4
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

    // --------------------------------------------------------------------
    console.log('\nScenario: where the five-minute popup session parks its key')
    // The opt-in session (`decisions/0015`) is the only thing this extension
    // writes a derived key into, and it writes it to `chrome.storage.session`:
    // browser memory, never disk, and closed to anything running in a page.
    // Asserted here rather than trusted, because the whole trade the user
    // agreed to rests on who can read that area.
    const pageSeesStorage = await loginTab.evaluate(
      `typeof chrome === 'undefined' || !chrome.storage ? 'unreachable' : 'REACHABLE'`,
    )
    check(
      'a web page cannot see the extension storage API at all',
      pageSeesStorage === 'unreachable',
      `page sees chrome.storage as: ${pageSeesStorage}`,
    )

    // Driven from the worker rather than the popup: both are trusted extension
    // contexts and the property under test is about the boundary, not about
    // which side of it does the writing. The worker is also always attached,
    // where a second `chrome.action.openPopup()` throws.
    const parked = await swEval(`(async () => {
      try {
        await chrome.storage.session.set({ 'wwmp-probe': 'parked' })
        const back = (await chrome.storage.session.get('wwmp-probe'))['wwmp-probe']
        return back === undefined ? 'nothing came back' : back
      } catch (e) { return 'threw: ' + e.message }
    })()`)
    check(
      'a trusted extension context can park a value in session storage',
      parked === 'parked',
      `the worker read back: ${parked}`,
    )

    // The deadline, end to end in a real browser (`decisions/0017`). A record
    // in the shape the popup parks, past its deadline, plus the alarm the popup
    // arms — and then nothing but the shipped worker's own handler to delete
    // it. Nothing else can be doing the deleting: the worker is already running
    // (this evaluation is in it), so its start-up sweep is long past.
    //
    // What this does NOT show is the other half of why an alarm was worth a
    // permission — that the browser *starts* a stopped worker to deliver one.
    // A worker with a DevTools session attached does not idle out, and the poll
    // below runs inside it, so the worker here never sleeps. That half is
    // Chrome's contract rather than this extension's code.
    //
    // A packed extension will not fire an alarm less than thirty seconds out;
    // an unpacked one, which is what this harness loads, has no such floor, so
    // this costs a second rather than half a minute.
    const sweptAtDeadline = await swEval(`(async () => {
      try {
        await chrome.storage.session.set({ 'popup-session':
          { key: 'AAAA', salt: 'probe-not-a-real-key', expiresAt: Date.now() - 1000 } })
        if (!(await chrome.storage.session.get('popup-session'))['popup-session']) {
          return 'the probe record did not stick'
        }
        await chrome.alarms.create('popup-session-deadline', { when: Date.now() })
        for (let i = 0; i < 40; i++) {
          await new Promise((ok) => setTimeout(ok, 250))
          if (!(await chrome.storage.session.get('popup-session'))['popup-session']) return 'deleted'
        }
        return 'still parked ten seconds past its deadline'
      } catch (e) { return 'threw: ' + e.message }
    })()`)
    check(
      'the worker deletes the parked key when its deadline alarm arrives',
      sweptAtDeadline === 'deleted',
      `the worker reported: ${sweptAtDeadline}`,
    )
    // And the alarm is not left armed once there is nothing to delete.
    const alarmAfter = await swEval(
      `chrome.alarms.get('popup-session-deadline').then((a) => (a ? 'still armed' : 'cleared'))`,
    )
    check(
      'and clears the alarm with it, rather than leaving one behind',
      alarmAfter === 'cleared',
      `after the sweep the alarm is: ${alarmAfter}`,
    )

    if (hasGrant) {
      // A content script is where page-controlled code gets closest to this
      // extension. `storage.local` *is* readable from one — that is the control
      // here, and it is not decoration: without it a content script that failed
      // to inject at all would report "cannot read the key" and pass while
      // proving nothing. `storage.session` is closed to it by default and by the
      // worker's explicit access level, so a parked key is out of reach of the
      // very page being filled. If either half changes, this goes red.
      await swEval(`chrome.storage.local.set({ 'wwmp-probe': 'control' })`)
      const seen = await swEval(`(async () => {
        const [injected] = await chrome.scripting.executeScript({
          target: { tabId: ${loginTabId} },
          func: async () => {
            const read = async (area) => {
              try {
                if (!chrome.storage || !chrome.storage[area]) return 'no ' + area + ' area'
                const got = await chrome.storage[area].get('wwmp-probe')
                return got && got['wwmp-probe'] ? 'READ:' + got['wwmp-probe'] : 'empty'
              } catch (e) { return 'refused: ' + e.message }
            }
            return { local: await read('local'), session: await read('session') }
          },
        })
        return injected ? injected.result : null
      })()`)
      check(
        'the content script really is running there (it can read local storage)',
        seen?.local === 'READ:control',
        `content script saw in storage.local: ${seen?.local ?? 'no injection result'}`,
      )
      check(
        'a content script in the filled page cannot read the parked key',
        typeof seen?.session === 'string' && !seen.session.startsWith('READ:'),
        `content script saw in storage.session: ${seen?.session ?? 'no injection result'}`,
      )
      await swEval(`chrome.storage.local.remove('wwmp-probe')`)
    }
    await swEval(`chrome.storage.session.remove('wwmp-probe')`)

    // --------------------------------------------------------------------
    // Everything past here types into a page, so it needs the grant.
    if (!hasGrant) {
      console.log(
        '\n  (The fill checks themselves run in pass 2: they need the activeTab\n' +
          '   grant, and no script can click a toolbar button.)',
      )
      await harvestTab.close()
      await loginTab.close()
      return results
    }

    await loginTab.activate()
    await sleep(300)
    popupEval = await openToolbarPopup()
    /** Fill from the popup, naming the tab the popup showed the user. */
    const fill = (request) => relayFrom(popupEval, { tabId: loginTabId, ...request })

    // -------------------------------------------------------------------- 5
    console.log('\nScenario: filling the login page from the popup')
    await clearFields(loginTab)
    const filled = await fill({
      username: 'someone@example.com',
      password: 'correct-horse-battery',
      expectedOrigin: ORIGIN,
    })
    const filledFields = await fieldValues(loginTab)
    check(
      'autofill reaches the login page from the popup',
      filled?.filled === true && filledFields.includes('password=correct-horse-battery'),
      `relay=${JSON.stringify(filled)} fields=[${filledFields}]`,
    )
    check(
      'username goes in the login form, not the newsletter box',
      filledFields.includes('username=someone@example.com') && filledFields.includes('q='),
      `fields=[${filledFields}]`,
    )

    // -------------------------------------------------------------------- 6
    console.log('\nScenario: origin mismatch (a look-alike phishing page)')
    await clearFields(loginTab)
    const mismatch = await fill({
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

    const override = await fill({
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
    const staleOverride = await fill({
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

    // ------------------------------------------------------------------- 6b
    console.log('\nScenario: a credential saved with no site at all')
    await clearFields(loginTab)
    const noOrigin = await fill({
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
    const noOriginApproved = await fill({
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

    // -------------------------------------------------------------------- 7
    // The login tab stays the active one throughout: the fill has to follow the
    // tab id the popup showed the user, not whatever is in front of the browser.
    console.log('\nScenario: a page whose only password fields are hidden')
    await clearFields(loginTab)
    const harvest = await relayFrom(popupEval, {
      tabId: harvestTabId,
      username: 'someone@example.com',
      password: 'correct-horse-battery',
      expectedOrigin: ORIGIN,
    })
    const harvestFields = await fieldValues(harvestTab)
    const loginUntouched = await fieldValues(loginTab)
    check(
      'hidden, tiny, transparent, off-screen, disabled and covered fields are all refused',
      harvest?.filled !== true && !harvestFields.includes('correct-horse-battery'),
      `relay=${JSON.stringify(harvest)} fields=[${harvestFields}]`,
    )
    check(
      'the named tab is the one filled, not whichever tab is active',
      harvest?.reason === 'no-password-field' && !loginUntouched.includes('correct-horse-battery'),
      `relay=${JSON.stringify(harvest)} active(login) fields=[${loginUntouched}]`,
    )
    const goneTab = await relayFrom(popupEval, {
      tabId: 999999,
      username: 'u',
      password: 'p',
      expectedOrigin: ORIGIN,
    })
    check(
      'a tab that no longer exists is refused rather than redirected somewhere',
      goneTab?.filled !== true && goneTab?.reason === 'no-such-tab',
      `relay=${JSON.stringify(goneTab)}`,
    )

    // ------------------------------------------------------------------- 7b
    // The gap between the popup resolving a tab and the user clicking Fill is a
    // whole Argon2id derivation wide — over a second — and a page can navigate
    // inside it. The password must not be delivered to the page that arrived in
    // the meantime, and "delivered" means handed to its renderer at all, not
    // merely typed into it: the content script refusing to type is too late if
    // the plaintext is already in a process the attacker controls.
    console.log('\nScenario: the page navigates after the popup resolved it')
    await clearFields(loginTab)
    await loginTab.evaluate(`(location.href = ${JSON.stringify(`${OTHER_ORIGIN}/login`)}, true)`)
    await sleep(900)
    const navigatedAway = await fill({
      username: 'someone@example.com',
      password: 'correct-horse-battery',
      expectedOrigin: ORIGIN,
    })
    const navigatedFields = await fieldValues(loginTab)
    check(
      'a tab that navigated to another origin is refused, naming where it went',
      navigatedAway?.filled !== true &&
        navigatedAway?.reason === 'origin-mismatch' &&
        navigatedAway?.pageOrigin === OTHER_ORIGIN &&
        !navigatedFields.includes('correct-horse-battery'),
      `relay=${JSON.stringify(navigatedAway)} fields=[${navigatedFields}]`,
    )
    // Back where it started, so the checks below still mean what they say.
    await loginTab.evaluate(`(location.href = ${JSON.stringify(`${ORIGIN}/login`)}, true)`)
    await sleep(900)

    // -------------------------------------------------------------------- 8
    console.log('\nScenario: repeated fills (content-script listener stacking)')
    await clearFields(loginTab)
    await loginTab.evaluate(`(window.__fillCount = 0,
      document.querySelector('input[type=password]')
        .addEventListener('input', () => window.__fillCount++), true)`)
    for (let i = 0; i < 3; i++) {
      await fill({ username: 'u', password: 'p', expectedOrigin: ORIGIN })
      await sleep(150)
    }
    const fills = await loginTab.evaluate(`window.__fillCount`)
    check(
      'three fills fire three input events, not six or nine',
      fills === 3,
      `input events on the password field: ${fills}`,
    )

    await harvestTab.close()
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

  const build = await checkShippedBuild()
  const servers = await Promise.all([startServer(PORT), startServer(OTHER_PORT)])
  let shipped = []
  let granted = []
  try {
    shipped = await runSuite({
      extDir: DIST,
      browser,
      port: DEBUG_PORT,
      label: 'PASS 1 — the extension exactly as shipped',
      hasGrant: false,
    })
    const scratch = await scratchBuildWithHostPermission()
    granted = await runSuite({
      extDir: scratch,
      browser,
      port: DEBUG_PORT + 1,
      label:
        'PASS 2 — the same shipped code, with the activeTab grant a toolbar click ' +
        'would give it standing in as a host permission',
      hasGrant: true,
    })
  } finally {
    servers.forEach((s) => s.close())
  }

  const failed = [...build, ...shipped, ...granted].filter((r) => !r.passed)
  const total = build.length + shipped.length + granted.length

  console.log('\n════════ summary ════════')
  console.log(`  shipped build:      ${build.filter((r) => r.passed).length}/${build.length} passed`)
  console.log(`  as shipped:         ${shipped.filter((r) => r.passed).length}/${shipped.length} passed`)
  console.log(`  grant simulated:    ${granted.filter((r) => r.passed).length}/${granted.length} passed`)
  console.log(
    '\n  Pass 2 runs the shipped popup, the shipped worker and the shipped content\n' +
      '  script; the only thing it fakes is the activeTab grant, because the browser\n' +
      '  confers that on a real toolbar click and CDP cannot click one. The README\n' +
      '  carries the one manual click that closes that last gap.',
  )
  if (failed.length) {
    console.error(`\nFAILED — ${failed.length} of ${total} checks:`)
    failed.forEach((f) => console.error(`  - ${f.name}`))
    process.exitCode = 1
  } else {
    console.log(`\nAll ${total} autofill checks passed.`)
  }
}

await main()
