/**
 * Walks the WHOLE product, once, as a person would — in a real browser, in the
 * real extension, from an empty profile to a filled login form and back again.
 *
 *   npm run build && npm run journey
 *
 * `visual-check.mjs` drives the same onboarding but against `dist/` served as a
 * plain web page, and stops at the first credential. `autofill-check.mjs` drives
 * the extension but starts from a vault that never existed — it messages the
 * worker directly and never types a passphrase. Neither of them ever ran the one
 * sequence the app is actually for:
 *
 *   create a vault from scratch → store a credential → fill it on a login page
 *   from the toolbar popup → export a backup → restore it over a changed vault.
 *
 * That is what this does, in that order, in one profile, with one passphrase
 * that only exists because the generator rolled it. Every step is checked
 * against what the *user* can see, not against internal state.
 *
 * Deliberately dependency-free and in the same style as its two neighbours: it
 * serves its own login page, launches an already-installed Chromium, and drives
 * everything over the DevTools protocol.
 *
 * TWO THINGS A SCRIPT CANNOT DO, both named where they happen:
 *
 *  1. Click the toolbar button. `activeTab` is conferred by the browser's own
 *     action-invocation path and nothing over CDP reaches it — measured in
 *     `autofill-check.mjs`, not assumed. So this loads a scratch copy of `dist/`
 *     carrying a host permission for the test origin, exactly as that harness's
 *     pass 2 does, and everything else is the shipped code.
 *  2. Pick a file out of the OS file dialog. The restore step sets the files on
 *     the lock screen's own hidden `<input type=file>` instead, which fires the
 *     same `change` handler the dialog would.
 *
 * Exits non-zero if any check fails.
 */
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { cp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(APP_DIR, 'dist')
const PORT = 5191
const ORIGIN = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = 9336

/** The password the vault will hold. Fixed, so the login form can be checked. */
const SITE_PASSWORD = 'journey-secret-9x7-Qm'
const SITE_USER = 'someone@example.com'
const FIRST_LABEL = 'Journey login'
const SECOND_LABEL = 'Added after the backup'

// Edge first, deliberately: Chrome 137 and later ignore `--load-extension`
// entirely, so on a current Chrome the extension silently never loads and every
// check below would be vacuous. Edge is the same engine and still honours it.
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]

const LOGIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Login</title></head>
<body><h1>Sign in</h1>
<form id="login">
  <input name="username" autocomplete="username" style="width:220px;height:26px">
  <input name="password" type="password" autocomplete="current-password" style="width:220px;height:26px">
  <button type="submit">Sign in</button>
</form>
</body></html>`

function startServer() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(LOGIN_PAGE)
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

/** Chromium derives an unpacked extension's ID from its absolute path. */
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

/**
 * A copy of `dist/` carrying a host permission for the test origin — the stand
 * -in for the grant a toolbar click makes. Everything inside it is the shipped
 * build; only `host_permissions` differs, and the summary says so.
 */
async function scratchBuildWithHostPermission() {
  const dir = join(tmpdir(), `wwmp-journey-ext-${process.pid}`)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  await cp(DIST, dir, { recursive: true, force: true })
  const manifest = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'))
  manifest.host_permissions = ['http://127.0.0.1/*']
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return dir
}

async function main() {
  if (!existsSync(join(DIST, 'manifest.json'))) {
    throw new Error('dist/manifest.json is missing — run the build first')
  }
  const browser = BROWSERS.find((p) => existsSync(p))
  if (!browser) throw new Error('no Chrome or Edge found in the usual install locations')
  console.log(`Browser: ${browser}`)

  const results = []
  const check = (name, passed, detail) => {
    results.push({ name, passed, detail })
    console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`)
  }

  const extDir = await scratchBuildWithHostPermission()
  const downloads = join(tmpdir(), `wwmp-journey-dl-${process.pid}`)
  await rm(downloads, { recursive: true, force: true })
  await mkdir(downloads, { recursive: true })
  const profile = join(tmpdir(), `wwmp-journey-profile-${process.pid}`)
  await rm(profile, { recursive: true, force: true })

  const server = await startServer()
  const child = spawn(browser, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
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
    ws = new WebSocket(await devToolsUrl(DEBUG_PORT))
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok, { once: true })
      ws.addEventListener('error', () => fail(new Error('devtools socket failed')), { once: true })
    })
    await rpc(ws, 'Target.setDiscoverTargets', { discover: true })
    // The backup arrives as a real download, so it has to land somewhere this
    // process can read it.
    await rpc(ws, 'Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloads,
      eventsEnabled: true,
    })

    const extId = unpackedExtensionId(extDir)
    const extPrefix = `chrome-extension://${extId}/`
    const targets = async () => (await rpc(ws, 'Target.getTargets')).targetInfos
    const findTarget = async (predicate, tries = 40) => {
      for (let i = 0; i < tries; i++) {
        const found = (await targets()).find(predicate)
        if (found) return found
        await sleep(250)
      }
      return null
    }
    if (!(await findTarget((t) => t.url.startsWith(extPrefix)))) {
      throw new Error(
        `the extension never loaded (no target under ${extPrefix}). ` +
          'Chrome 137+ ignores --load-extension; use Microsoft Edge.',
      )
    }
    console.log(`\nExtension ${extId} loaded from ${extDir}`)
    console.log(`Downloads land in ${downloads}\n`)

    /** Attach to a target; hand back the evaluators for it. */
    const attach = async (targetId) => {
      const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true })
      await rpc(ws, 'Runtime.enable', {}, sessionId)
      const evaluate = async (expression) => {
        const { result, exceptionDetails } = await rpc(
          ws,
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true },
          sessionId,
        )
        if (exceptionDetails) {
          throw new Error(`${exceptionDetails.text} :: ${expression.slice(0, 80)}`)
        }
        return result.value
      }
      return { sessionId, evaluate }
    }

    // ---- the extension's own service worker -----------------------------
    const swTarget = await findTarget(
      (t) => t.type === 'service_worker' && t.url.startsWith(extPrefix),
    )
    if (!swTarget) throw new Error('the extension service worker never appeared')
    const { evaluate: swEval } = await attach(swTarget.targetId)
    for (let i = 0; i < 20; i++) {
      try {
        await swEval('chrome.runtime.id')
        break
      } catch {
        await sleep(250)
      }
    }

    // ==================================================================== //
    // A page under test, with the handful of gestures a person makes.
    // ==================================================================== //
    const openPage = async (url) => {
      const { targetId } = await rpc(ws, 'Target.createTarget', { url })
      const { sessionId, evaluate } = await attach(targetId)
      await rpc(ws, 'DOM.enable', {}, sessionId)
      await sleep(500)

      const text = () => evaluate(`document.body.innerText`)

      /** Poll until `predicate` (a JS expression) is true, or give up. */
      const waitFor = async (expression, { timeout = 20000, what = expression } = {}) => {
        const deadline = Date.now() + timeout
        while (Date.now() < deadline) {
          if (await evaluate(`!!(${expression})`)) return true
          await sleep(200)
        }
        throw new Error(`timed out after ${timeout}ms waiting for ${what}`)
      }

      const seen = (needle) => evaluate(`document.body.innerText.includes(${JSON.stringify(needle)})`)

      /** Click the first enabled control whose label starts with `label`. */
      const click = async (label, { optional = false } = {}) => {
        const found = await evaluate(`(() => {
          const wanted = ${JSON.stringify(label)}.toLowerCase()
          const el = [...document.querySelectorAll('button, [role="button"], a')].find((n) => {
            if (n.disabled) return false
            const t = (n.textContent || '').trim().toLowerCase()
            const a = (n.getAttribute('aria-label') || '').trim().toLowerCase()
            return t.startsWith(wanted) || a.startsWith(wanted)
          })
          if (!el) return false
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
          return true
        })()`)
        if (!found && !optional) throw new Error(`no control labelled "${label}" on screen`)
        // Long enough to clear the app's 550ms scene-transition guard.
        await sleep(700)
        return found
      }

      const clickExact = (label) =>
        evaluate(`(() => {
          const el = [...document.querySelectorAll('button')].find(
            (n) => (n.textContent || '').trim() === ${JSON.stringify(label)})
          if (!el) return false
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
          return true
        })()`)

      /** The compartment the app is pulsing at. */
      const clickHotspot = async () => {
        for (let attempt = 0; attempt < 8; attempt++) {
          const clicked = await evaluate(`(() => {
            const ring = document.querySelector('.locus-pulse')
            const target = ring?.closest('[role="button"]')
            if (!target) return false
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
            return true
          })()`)
          await sleep(450)
          if (clicked && !(await evaluate(`!!document.querySelector('.locus-pulse')`))) return true
        }
        throw new Error('a compartment never opened when clicked')
      }

      /** Set a React-controlled field: React installs its own value setter. */
      const type = async (selector, value, nth = 1) => {
        const ok = await evaluate(`(() => {
          const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth - 1}]
          if (!el) return false
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
          Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)})
          el.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        })()`)
        if (!ok) throw new Error(`no field matching "${selector}" (#${nth}) to type into`)
        await sleep(150)
      }

      /**
       * Hand a real file to a real `<input type=file>`. This is the one gesture
       * the OS owns — the dialog — so the files are set on the element directly;
       * the app's own `onChange` runs exactly as it would after a dialog.
       */
      const chooseFile = async (selector, path) => {
        const { result } = await rpc(
          ws,
          'Runtime.evaluate',
          { expression: `document.querySelector(${JSON.stringify(selector)})` },
          sessionId,
        )
        if (!result.objectId) throw new Error(`no file input matching "${selector}"`)
        await rpc(ws, 'DOM.setFileInputFiles', { files: [path], objectId: result.objectId }, sessionId)
        await sleep(600)
      }

      return {
        targetId,
        sessionId,
        evaluate,
        text,
        seen,
        waitFor,
        click,
        clickExact,
        clickHotspot,
        type,
        chooseFile,
        activate: () => rpc(ws, 'Target.activateTarget', { targetId }),
        close: () => rpc(ws, 'Target.closeTarget', { targetId }),
      }
    }

    // ==================================================================== //
    // 1. A brand-new browser meets the memory house.
    // ==================================================================== //
    console.log('──── 1. First run: building a vault from nothing ────\n')
    const house = await openPage(`${extPrefix}index.html`)
    await house.waitFor(`document.body.innerText.length > 0`, { what: 'the app to render' })
    check(
      'a browser with no vault opens on the welcome screen, not a lock screen',
      (await house.seen('Where Was My Password')) && !(await house.seen('Unlock')),
      `first line: ${(await house.text()).split('\n')[0]}`,
    )

    // The tutorial, then the guided demo walk of a sample house.
    await house.click('Next')
    await house.click('Next')
    await house.click('Take the practice walk')
    for (let i = 0; i < 3; i++) {
      await house.clickHotspot()
      await house.click('Walk to the next stop', { optional: true })
    }
    await house.click('End of the route')
    await house.click('tornado')
    await house.click('Continue')
    await house.click('the tornado under the doormat')
    await house.click('Continue')
    await house.click('Generate my passphrase')
    await house.waitFor(`document.body.innerText.includes('bits of entropy')`, {
      what: 'the phrase generator',
    })

    // Six words: the shortest phrase, and the same screens either way.
    const rollSixWords = async () => {
      await house.clickExact('6')
      await sleep(400)
      const rolled = await house.evaluate(`[...document.querySelectorAll('span.group')].map(
        (el) => [...el.childNodes].map((n) => n.textContent.trim())
          .filter((t) => t && !/^\\d+$/.test(t) && t !== '↻')[0])`)
      if (!rolled?.length) throw new Error('could not read the generated words off the page')
      return rolled
    }
    const words = await rollSixWords()
    const phrase = words.join(' ')
    console.log(`\n  The dice rolled: ${phrase}\n`)
    check(
      'the generator rolls a six-word phrase the user has never seen before',
      words.length === 6 && words.every((w) => typeof w === 'string' && w.length > 1),
      `words=${JSON.stringify(words)}`,
    )

    await house.click('Hide these in the house')
    await sleep(400)

    // Placement: one image per word, and remember which stop took which so the
    // gauntlets below can answer in whatever order they ask.
    const stopName = () =>
      house.evaluate(`(() => {
        const el = [...document.querySelectorAll('span')].find(
          (n) => /^stop \\d+ of \\d+ — /.test(n.textContent.trim()))
        return el ? el.textContent.trim().split('—').pop().trim() : ''
      })()`)
    /** Walk the placement journey, one vivid image per word. */
    const placeWords = async (list) => {
      const placed = {}
      for (const word of list) {
        placed[await stopName()] = word
        await house.clickHotspot()
        await house.type('textarea', `a vivid test image for ${word}`)
        await house.click('Place it')
        await house.click('Shut it away')
      }
      await sleep(400)
      return placed
    }
    const wordAtStop = await placeWords(words)
    check(
      'every stop on the route took exactly one word',
      Object.keys(wordAtStop).length === words.length,
      `stops=${JSON.stringify(wordAtStop)}`,
    )

    // Three gauntlets: forward, backward, random.
    for (const pass of ['forward', 'backward', 'random']) {
      for (let i = 0; i < words.length; i++) {
        const stop = await stopName()
        await house.type('input', wordAtStop[stop] ?? '')
        await house.click('Open it')
        await house.click('Next stop', { optional: true })
        await house.click('Finish this pass', { optional: true })
        await sleep(120)
      }
      await sleep(400)
      console.log(`  gauntlet: ${pass} pass done`)
    }

    // Mastery: the whole phrase, cold, twice.
    await house.waitFor(`document.body.innerText.includes('Mastery Test')`, {
      what: 'the mastery test',
    })
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!(await house.seen('Mastery Test'))) break
      await house.type('input', phrase)
      await house.click('Check', { optional: true })
      await sleep(400)
    }
    check(
      'typing the phrase twice from memory clears the mastery gate',
      await house.seen('Create'),
      `on screen: ${(await house.text()).split('\n').slice(0, 2).join(' | ')}`,
    )

    await house.click('Create my encrypted vault')
    // 256 MiB of Argon2id, deliberately slow. Polled rather than slept through:
    // a fixed wait here is the difference between a harness and a stopwatch.
    await house.waitFor(`document.body.innerText.includes('Enter the vault')`, {
      timeout: 60000,
      what: 'the vault to be sealed',
    })
    await house.click('Enter the vault')
    await house.waitFor(`document.body.innerText.includes('Vault Unlocked')`, {
      what: 'the unlocked home',
    })
    check(
      'the vault is sealed and the user lands inside it',
      await house.seen('Vault Unlocked'),
      `header: ${(await house.text()).split('\n').slice(0, 3).join(' | ')}`,
    )

    // ==================================================================== //
    // 2. A password goes in.
    // ==================================================================== //
    console.log('\n──── 2. Storing a credential ────\n')
    const addCredential = async ({ label, url, username, password }) => {
      await house.click('+ Add')
      await house.waitFor(`document.body.innerText.includes('Add credential')`, {
        what: 'the credential form',
      })
      // Label, Site URL, Username, Password — the form's own order.
      await house.type('input', label, 1)
      await house.type('input', url, 2)
      await house.type('input', username, 3)
      await house.type('input', password, 4)
      await house.click('Add')
      await house.waitFor(
        `!document.body.innerText.includes('Add credential')`,
        { timeout: 30000, what: 'the credential to be saved' },
      )
    }
    await addCredential({
      label: FIRST_LABEL,
      url: `${ORIGIN}/login`,
      username: SITE_USER,
      password: SITE_PASSWORD,
    })
    check(
      'a saved credential appears in the list on the unlocked screen',
      await house.seen(FIRST_LABEL),
      `list shows: ${(await house.text()).match(/Passwords[\s\S]{0,160}/)?.[0]?.replace(/\n/g, ' | ')}`,
    )
    check(
      'the password itself is not printed on the unlocked screen',
      !(await house.seen(SITE_PASSWORD)),
      'the list shows labels and usernames only',
    )

    // ==================================================================== //
    // 3. The backup, as a real download.
    // ==================================================================== //
    console.log('\n──── 3. Exporting an encrypted backup ────\n')
    await house.click('Export encrypted backup')
    let backupPath = null
    for (let i = 0; i < 40 && !backupPath; i++) {
      const files = (await readdir(downloads)).filter((f) => f.endsWith('.wwmp.json'))
      if (files.length) backupPath = join(downloads, files[0])
      else await sleep(250)
    }
    check(
      'Export encrypted backup writes a .wwmp.json file to disk',
      backupPath !== null,
      backupPath ? `wrote ${backupPath}` : `nothing in ${downloads}: ${(await readdir(downloads)).join(', ') || '(empty)'}`,
    )
    if (!backupPath) throw new Error('no backup file to carry into the restore steps')
    const backupText = await readFile(backupPath, 'utf8')
    const backup = JSON.parse(backupText)
    check(
      'the backup is a well-formed vault file, not a blob of nothing',
      backup.kind === 'wherewasmypassword-backup' &&
        typeof backup.vault?.ciphertext === 'string' &&
        backup.vault.ciphertext.length > 100,
      `kind=${backup.kind} version=${backup.vault?.version} ciphertext=${backup.vault?.ciphertext?.length} chars`,
    )
    check(
      'nothing in the backup file is readable — not the password, not the words',
      !backupText.includes(SITE_PASSWORD) &&
        !backupText.includes(SITE_USER) &&
        !words.some((w) => backupText.includes(w)),
      `${backupText.length} bytes, and none of the phrase, the username or the password appear in them`,
    )

    // ==================================================================== //
    // 4. Lock it, and open it again with nothing but the phrase.
    // ==================================================================== //
    console.log('\n──── 4. Locking, and unlocking from memory ────\n')
    await house.click('Lock now')
    await house.waitFor(`document.body.innerText.includes('Walk the house. Type the words')`, {
      what: 'the lock screen',
    })
    check(
      'Lock now leaves the lock screen, with the credential out of reach',
      !(await house.seen(FIRST_LABEL)),
      'no entry labels on the locked screen',
    )

    const unlockHouse = async (attempt) => {
      await house.type('input[type=password]', attempt)
      await house.click('Unlock')
      await house.waitFor(
        `document.body.innerText.includes('Vault Unlocked') ||
         document.body.innerText.includes('That doesn’t open the door')`,
        { timeout: 60000, what: 'the unlock to resolve' },
      )
      return house.seen('Vault Unlocked')
    }
    check(
      'a wrong passphrase is refused, and says so in the app’s own words',
      (await unlockHouse('mailbox doormat closet fireplace oven fridge')) === false &&
        (await house.seen('start at the mailbox')),
      `screen says: ${(await house.text()).split('\n').find((l) => l.includes('open the door')) ?? '(nothing)'}`,
    )
    check(
      'the phrase the dice rolled opens the vault',
      await unlockHouse(phrase),
      `after unlock: ${(await house.text()).split('\n')[0]}`,
    )
    check(
      'and the credential stored before the lock is still there',
      await house.seen(FIRST_LABEL),
      `list shows ${FIRST_LABEL}`,
    )

    // ==================================================================== //
    // 5. The whole point: fill it on a real login page, from the popup.
    // ==================================================================== //
    console.log('\n──── 5. Filling a real login page from the toolbar popup ────\n')
    const login = await openPage(`${ORIGIN}/login`)
    await login.activate()
    await sleep(400)

    const openToolbarPopup = async () => {
      const stale = (await targets()).find((t) => t.url === `${extPrefix}popup.html`)
      if (stale) await rpc(ws, 'Target.closeTarget', { targetId: stale.targetId })
      await swEval('chrome.action.openPopup()')
      const found = await findTarget((t) => t.url === `${extPrefix}popup.html`)
      if (!found) throw new Error('the toolbar popup never opened')
      const { sessionId, evaluate } = await attach(found.targetId)
      await rpc(ws, 'DOM.enable', {}, sessionId)
      await sleep(400)
      return { sessionId, evaluate }
    }

    const popup = await openToolbarPopup()
    const popupText = () => popup.evaluate(`document.body.innerText`)
    const popupClick = async (label) => {
      const ok = await popup.evaluate(`(() => {
        const wanted = ${JSON.stringify(label)}.toLowerCase()
        const el = [...document.querySelectorAll('button')].find(
          (n) => !n.disabled && (n.textContent || '').trim().toLowerCase().startsWith(wanted))
        if (!el) return false
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
        return true
      })()`)
      if (!ok) throw new Error(`no control labelled "${label}" in the popup`)
      await sleep(400)
      return ok
    }
    const popupType = (value) =>
      popup.evaluate(`(() => {
        const el = document.querySelector('input[type=password]')
        if (!el) return false
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)})
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
    const popupWaitFor = async (expression, { timeout = 60000, what = expression } = {}) => {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        if (await popup.evaluate(`!!(${expression})`)) return true
        await sleep(200)
      }
      throw new Error(`timed out after ${timeout}ms waiting for ${what} in the popup`)
    }

    check(
      'the popup names the page it is pointed at — which only the grant makes readable',
      (await popupText()).includes(`Filling into ${ORIGIN}`),
      `popup header: ${(await popupText()).replace(/\n/g, ' | ').slice(0, 80)}`,
    )
    check(
      'the popup asks for the passphrase rather than opening straight up',
      (await popupText()).includes('Unlock') && !(await popupText()).includes(FIRST_LABEL),
      'the entry list is behind the passphrase',
    )

    await popupType(phrase)
    await popupClick('Unlock')
    await popupWaitFor(`document.body.innerText.includes(${JSON.stringify(FIRST_LABEL)})`, {
      what: 'the popup to unlock',
    })
    check(
      'the same phrase opens the vault in the popup, and the entry for this page is on top',
      (await popupText()).includes(FIRST_LABEL) &&
        // The badge is rendered lower-case and upper-cased by CSS, and
        // `innerText` reports what is on the glass rather than what is in the DOM.
        /this page/i.test(await popupText()),
      `popup shows: ${(await popupText()).replace(/\n/g, ' | ').slice(0, 140)}`,
    )

    const fields = () =>
      login.evaluate(`[...document.querySelectorAll('input')].map((i) => i.name + '=' + i.value).join(',')`)
    check(
      'nothing is in the login form before Fill is pressed',
      !(await fields()).includes(SITE_PASSWORD),
      `fields=[${await fields()}]`,
    )
    await popupClick('Fill')
    // The popup closes itself 700ms after a fill, so the page is where the
    // answer has to be read.
    const deadline = Date.now() + 15000
    let filled = ''
    while (Date.now() < deadline) {
      filled = await fields()
      if (filled.includes(SITE_PASSWORD)) break
      await sleep(200)
    }
    check(
      'Fill types the password into the real login form',
      filled.includes(`password=${SITE_PASSWORD}`),
      `fields=[${filled}]`,
    )
    check(
      'and the username with it',
      filled.includes(`username=${SITE_USER}`),
      `fields=[${filled}]`,
    )

    // ==================================================================== //
    // 6. Change the vault, then put the backup back over it.
    // ==================================================================== //
    console.log('\n──── 6. Restoring the backup over a changed vault ────\n')
    await house.activate()
    await sleep(500)
    // The memory house locks itself a minute after it goes to the background,
    // which is exactly what has been happening while the popup was in front.
    // Whether it did is not the check here — that it can be reopened is.
    if (await house.seen('Walk the house. Type the words')) {
      console.log('  (the memory house had auto-locked in the background; unlocking again)')
      if (!(await unlockHouse(phrase))) throw new Error('could not re-open the memory house')
    }
    await addCredential({
      label: SECOND_LABEL,
      url: 'https://example.org',
      username: 'later@example.com',
      password: 'a-second-password',
    })
    check(
      'a second credential is added after the backup was taken',
      (await house.seen(SECOND_LABEL)) && (await house.seen(FIRST_LABEL)),
      'the live vault now holds two entries; the backup file holds one',
    )

    await house.click('Lock now')
    await house.waitFor(`document.body.innerText.includes('Restore from a backup file instead')`, {
      what: 'the lock screen with its restore offer',
    })
    await house.chooseFile('input[type=file]', backupPath)
    await house.waitFor(
      `document.body.innerText.includes('This replaces the vault already on this device')`,
      { what: 'the restore confirmation' },
    )
    check(
      'choosing a backup file asks before it replaces anything',
      await house.seen('This replaces the vault already on this device'),
      'the confirmation panel is up',
    )
    check(
      'and asks for the backup file’s passphrase first (`decisions/0019` default)',
      await house.seen('passphrase of that backup file'),
      `panel says: ${(await house.text()).match(/First, the[\s\S]{0,90}/)?.[0]?.replace(/\n/g, ' ') ?? '(no prompt)'}`,
    )

    // One phrase opens both records here, which is the ordinary case: the file
    // is this device's own export. It is typed once and proves both halves.
    await house.type('input[type=password]', phrase, 2)
    await house.click('Replace my vault')
    await house.waitFor(
      `!document.body.innerText.includes('This replaces the vault already on this device')`,
      { timeout: 90000, what: 'the restore to commit' },
    )
    check(
      'one phrase that opens both records satisfies the gate in a single typing',
      !(await house.seen('This replaces the vault already on this device')) &&
        !(await house.seen('doesn’t open')),
      `screen: ${(await house.text()).replace(/\n/g, ' | ').slice(0, 150)}`,
    )
    check(
      'the vault that was replaced is offered back, in case this was the wrong file',
      await house.seen('Restored the wrong file?'),
      'the undo offer is on the lock screen',
    )

    check(
      'the restored vault opens with the same phrase',
      await unlockHouse(phrase),
      `after unlock: ${(await house.text()).split('\n')[0]}`,
    )
    check(
      'it is the vault as it was when the backup was taken — one entry, not two',
      (await house.seen(FIRST_LABEL)) && !(await house.seen(SECOND_LABEL)),
      `${FIRST_LABEL} present=${await house.seen(FIRST_LABEL)}, ` +
        `${SECOND_LABEL} present=${await house.seen(SECOND_LABEL)}`,
    )

    // ==================================================================== //
    // 7. That was the wrong file: put the previous vault back.
    // ==================================================================== //
    console.log('\n──── 7. Undoing the restore ────\n')
    await house.click('Lock now')
    await house.waitFor(`document.body.innerText.includes('Restored the wrong file?')`, {
      what: 'the lock screen with the undo offer',
    })
    await house.click('Restored the wrong file?')
    await house.waitFor(`document.body.innerText.includes('This device keeps one vault aside')`, {
      what: 'the undo confirmation',
    })
    // The second password field on this screen: the first is the unlock form,
    // which is still sitting above it.
    await house.type('input[type=password]', 'not the right words at all', 2)
    await house.click('Put the previous vault back')
    await house.waitFor(
      `document.body.innerText.includes('doesn’t open the vault set aside')`,
      { timeout: 60000, what: 'the undo to refuse a wrong phrase' },
    )
    check(
      'the undo will not swap vaults for someone who cannot open the one set aside',
      await house.seen('doesn’t open the vault set aside'),
      'a wrong phrase is refused and nothing is swapped (`decisions/0018`)',
    )

    await house.type('input[type=password]', phrase, 2)
    await house.click('Put the previous vault back')
    await house.waitFor(`!document.body.innerText.includes('This device keeps one vault aside')`, {
      timeout: 60000,
      what: 'the undo to complete',
    })
    check(
      'the right phrase puts the previous vault back',
      await unlockHouse(phrase),
      `after unlock: ${(await house.text()).split('\n')[0]}`,
    )
    check(
      'and the entry added after the backup is here again — nothing was thrown away',
      (await house.seen(FIRST_LABEL)) && (await house.seen(SECOND_LABEL)),
      `both entries present again`,
    )

    // ==================================================================== //
    // 8. A new master phrase over a vault with passwords in it.
    // ==================================================================== //
    console.log('\n──── 8. Changing the master passphrase ────\n')
    await house.click('Change passphrase')
    await house.waitFor(`document.body.innerText.includes('Change Your Passphrase')`, {
      what: 'the change-passphrase screen',
    })
    await house.type('input[type=password]', 'some other six words entirely here')
    await house.click('Continue')
    await house.waitFor(
      `document.body.innerText.includes('not the phrase this vault is locked with')`,
      { timeout: 60000, what: 'the current-phrase gate to refuse' },
    )
    check(
      'changing the phrase asks for the current one first, and means it',
      await house.seen('not the phrase this vault is locked with'),
      'an unattended unlocked screen cannot be used to lock the owner out',
    )

    await house.type('input[type=password]', phrase)
    await house.click('Continue')
    await house.waitFor(`document.body.innerText.includes('bits of entropy')`, {
      timeout: 60000,
      what: 'the new phrase generator',
    })
    const newWords = await rollSixWords()
    const newPhrase = newWords.join(' ')
    console.log(`\n  The new phrase: ${newPhrase}\n`)
    await house.click('Hide these in the house')
    await sleep(400)
    await placeWords(newWords)
    await house.waitFor(`document.body.innerText.includes('Prove the New Route')`, {
      what: 'the gate after placement',
    })
    // The walks themselves are the same three gauntlets the first run already
    // proved; what this step is here to exercise is the re-key underneath.
    await house.click('Skip the walks, seal it anyway')
    await house.waitFor(`document.body.innerText.includes('New Phrase, Same Vault')`, {
      timeout: 90000,
      what: 'the vault to be re-encrypted',
    })
    await house.click('Back to the vault')
    await house.waitFor(`document.body.innerText.includes('Vault Unlocked')`, {
      what: 'the unlocked home',
    })
    check(
      'every password comes across the re-encryption untouched',
      (await house.seen(FIRST_LABEL)) && (await house.seen(SECOND_LABEL)),
      'both entries survived the new key',
    )

    await house.click('Lock now')
    await house.waitFor(`document.body.innerText.includes('Walk the house. Type the words')`, {
      what: 'the lock screen',
    })
    check(
      'the retired phrase no longer opens the vault',
      (await unlockHouse(phrase)) === false,
      `screen says: ${(await house.text()).split('\n').find((l) => l.includes('open the door')) ?? '(nothing)'}`,
    )
    check(
      'the new phrase does',
      await unlockHouse(newPhrase),
      `after unlock: ${(await house.text()).split('\n')[0]}`,
    )
    // The copy set aside is still encrypted under the phrase that was just
    // retired, so leaving it would hand anyone with this profile the vault the
    // user was moving away from — and the lock screen would offer to put it
    // back. `ChangePassphrase` deletes it; this is where that is visible.
    await house.click('Lock now')
    await house.waitFor(`document.body.innerText.includes('Walk the house. Type the words')`, {
      what: 'the lock screen',
    })
    check(
      'changing the phrase takes the vault set aside with it, offer and all',
      !(await house.seen('Restored the wrong file?')),
      'no undo offer remains on the lock screen (`decisions/0012`)',
    )

    await login.close()
    await house.close()
  } finally {
    try {
      ws?.close()
    } catch {
      /* already gone */
    }
    child.kill()
    server.close()
    // This run created a real vault, a real backup file and a browser profile
    // holding both. None of them are interesting once the checks have reported,
    // and leaving encrypted vaults around temp directories is not a habit this
    // repo should get into. Best effort: Windows keeps the profile locked for a
    // moment after the browser exits, so it is worth a few tries and not worth
    // failing the run over.
    for (const dir of [profile, downloads, extDir]) {
      for (let i = 0; i < 10; i++) {
        try {
          await rm(dir, { recursive: true, force: true })
          break
        } catch {
          await sleep(300)
        }
      }
    }
  }

  const failed = results.filter((r) => !r.passed)
  console.log('\n════════ summary ════════')
  console.log(`  ${results.length - failed.length}/${results.length} checks passed`)
  console.log(
    '\n  One journey, one profile, one passphrase nobody chose: welcome screen to\n' +
      '  filled login form to restored backup. The only thing simulated is the\n' +
      '  activeTab grant a toolbar click makes, and the OS file dialog.',
  )
  if (failed.length) {
    console.error(`\nFAILED — ${failed.length} of ${results.length} checks:`)
    failed.forEach((f) => console.error(`  - ${f.name}`))
    process.exitCode = 1
  } else {
    console.log(`\nThe whole journey works.`)
  }
}

await main()
