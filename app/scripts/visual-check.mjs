/**
 * Drives the built app through the whole onboarding in a real browser and
 * screenshots every screen, so a UI change can be reviewed by looking at it
 * rather than by reading diffs. Deliberately dependency-free: it serves
 * `dist/` itself and drives an already-installed Chrome/Edge over the
 * DevTools protocol, so nothing needs installing to run a visual review.
 *
 *   npm run build && npm run visual
 *
 * The viewport is deliberately narrow (a phone-sized 390x844) because that is
 * the worst case for layout; the extension itself opens in a full tab.
 * Shots land in `screenshots/` (gitignored). Exits non-zero on a page
 * exception, a console error, a missing control, or a layout overflow.
 */
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, extname, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(APP_DIR, 'dist')
const SHOTS = join(APP_DIR, 'screenshots')
const PORT = 5188
const ORIGIN = `http://localhost:${PORT}`

const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

function startServer() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, ORIGIN).pathname)
    const file = join(DIST, path === '/' ? 'index.html' : path)
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
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

async function waitForDevTools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9333/json/version')
      return (await res.json()).webSocketDebuggerUrl
    } catch {
      await sleep(250)
    }
  }
  throw new Error('browser DevTools endpoint never came up')
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/ is missing — run the build first')
  const browser = BROWSERS.find((p) => existsSync(p))
  if (!browser) throw new Error('no Chrome or Edge found in the usual install locations')

  await mkdir(SHOTS, { recursive: true })
  const server = await startServer()

  const profile = join(tmpdir(), `wwmp-visual-${process.pid}`)
  const child = spawn(browser, [
    '--headless=new',
    '--remote-debugging-port=9333',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'about:blank',
  ])
  child.stderr.resume()

  const problems = []
  let ws
  try {
    ws = new WebSocket(await waitForDevTools())
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok, { once: true })
      ws.addEventListener('error', () => fail(new Error('devtools socket failed')), { once: true })
    })

    const { targetId } = await rpc(ws, 'Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true })
    const call = (method, params) => rpc(ws, method, params, sessionId)

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.method === 'Runtime.exceptionThrown') {
        problems.push(`page exception: ${msg.params.exceptionDetails.text}`)
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        problems.push(`console error: ${msg.params.entry.text}`)
      }
    })

    await call('Runtime.enable')
    await call('Log.enable')
    await call('Page.enable')
    await call('Emulation.setDeviceMetricsOverride', VIEWPORT)
    await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

    const shot = async (name) => {
      const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      await writeFile(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'))
      console.log(`  shot: ${name}.png`)
    }

    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await call('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      if (exceptionDetails) throw new Error(exceptionDetails.text)
      return result.value
    }

    /**
     * Click the first button/link whose trimmed text matches. Steps that may
     * legitimately not be on screen (a route that ended early, a quiz that
     * wasn't asked) pass `optional` so they don't count as failures.
     */
    const click = async (text, { optional = false } = {}) => {
      const found = await evaluate(`(() => {
        const wanted = ${JSON.stringify(text)}.toLowerCase()
        const nodes = [...document.querySelectorAll('button, [role="button"], a')]
        const el = nodes.find((n) => {
          if (n.disabled) return false
          const label = (n.textContent || '').trim().toLowerCase()
          const aria = (n.getAttribute('aria-label') || '').trim().toLowerCase()
          return label.startsWith(wanted) || aria.startsWith(wanted)
        })
        if (!el) return false
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
        return true
      })()`)
      if (!found && !optional) problems.push(`could not find a control labelled "${text}"`)
      // Long enough to clear the app's 550ms scene-transition guard.
      await sleep(700)
      return found
    }

    /** Click a control whose whole label is exactly this text (e.g. a "6"). */
    const clickText = async (text) =>
      evaluate(`(() => {
        const el = [...document.querySelectorAll('button')].find(
          (n) => (n.textContent || '').trim() === ${JSON.stringify(text)},
        )
        if (!el) return false
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
        return true
      })()`)

    /**
     * Click the compartment the app is currently pulsing at, retrying while the
     * scene-transition guard is up (the app ignores clicks for ~550ms after a
     * walk). The pulse ring disappearing is the signal that it opened.
     */
    const clickHotspot = async ({ optional = false } = {}) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const clicked = await evaluate(`(() => {
          const ring = document.querySelector('.locus-pulse')
          const target = ring?.closest('[role="button"]')
          if (!target) return false
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
          return true
        })()`)
        await sleep(500)
        if (clicked && !(await evaluate(`!!document.querySelector('.locus-pulse')`))) return true
      }
      if (!optional) problems.push('a compartment never opened when clicked')
      return false
    }

    /**
     * Set a React-controlled field. React installs its own value setter, so the
     * native one has to be called before dispatching input for it to notice.
     */
    const type = async (selector, value, nth = 1) => {
      const ok = await evaluate(`(() => {
        const el = document.querySelectorAll(${JSON.stringify(selector.replace(/:nth-of-type\(\d+\)/, ''))})[${nth - 1}]
        if (!el) return false
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
        Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)})
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      if (!ok) problems.push(`no field matching "${selector}" (#${nth}) to type into`)
      await sleep(200)
      return ok
    }

    /** The locus name from the palace header: "stop 2 of 6 — Kitchen Sink". */
    const currentStop = async () =>
      evaluate(`(() => {
        const el = [...document.querySelectorAll('span')].find((n) => /^stop \\d+ of \\d+ — /.test(n.textContent.trim()))
        return el ? el.textContent.trim().split('—').pop().trim() : ''
      })()`)

    const overflow = () =>
      evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)

    console.log(`\nLoading ${ORIGIN} at ${VIEWPORT.width}x${VIEWPORT.height}...`)
    await call('Page.navigate', { url: `${ORIGIN}/index.html` })
    await sleep(1500)
    await shot('01-welcome')

    // Tutorial: three pages, then the guided demo walk of a sample house.
    await click('Next')
    await click('Next')
    await click('Take the practice walk')
    await shot('02-demo-walk')

    // The demo route: open each compartment, then walk on.
    for (let i = 0; i < 3; i++) {
      await clickHotspot()
      console.log(`  demo stop ${i + 1}: ${(await evaluate(`document.body.innerText`)).slice(0, 60).replace(/\n/g, ' | ')}`)
      await click('Walk to the next stop', { optional: true })
    }
    await click('End of the route')
    await shot('03-demo-route-end')

    // Two multiple-choice cards close the tutorial.
    await click('tornado')
    await click('Continue')
    await click('the tornado under the doormat')
    await click('Continue')
    await click('Generate my passphrase')
    await sleep(700)

    // Shortest phrase keeps the run quick; the layout is the same either way.
    await clickText('6')
    await sleep(300)
    await shot('04-phrase-generator')

    // The re-roll budget: choosing among alternatives costs entropy, so the
    // meter has to fall as re-rolls are spent and the buttons have to stop.
    // Without this the meter would happily read "~66.8 bits" while the user
    // hunted through the wordlist for six words they liked.
    const readBits = () =>
      evaluate(`(() => {
        const el = [...document.querySelectorAll('p')].find((n) => /bits of entropy/.test(n.textContent))
        return el ? Number(el.textContent.match(/~([\\d.]+) bits/)?.[1]) : null
      })()`)
    const bitsBefore = await readBits()
    for (let i = 1; i <= 6; i++) {
      await evaluate(`(() => {
        const el = document.querySelector('[aria-label="Re-roll word ${i}"]')
        if (!el || el.disabled) return false
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
        return true
      })()`)
      await sleep(120)
    }
    const bitsAfter = await readBits()
    const stillOffered = await evaluate(
      `[...document.querySelectorAll('[aria-label^="Re-roll word"]')].filter((b) => !b.disabled).length`,
    )
    console.log(`\nRe-roll budget: ${bitsBefore} bits -> ${bitsAfter} after six re-rolls`)
    if (!(bitsAfter < bitsBefore - 5)) {
      problems.push(`six re-rolls only moved the entropy meter ${bitsBefore} -> ${bitsAfter}`)
    }
    if (stillOffered !== 0) {
      problems.push(`${stillOffered} re-roll buttons still enabled after the budget was spent`)
    }

    const words = await evaluate(`[...document.querySelectorAll('span.group')].map(
      (el) => [...el.childNodes].map(n => n.textContent.trim()).filter(t => t && !/^\\d+$/.test(t) && t !== '↻')[0]
    )`)
    console.log(`\nGenerated phrase: ${words.join(' ')}`)
    if (!words.length) throw new Error('could not read the generated words off the page')

    await click('Hide these in the house')
    await sleep(500)

    // Placement: one vivid image per word. Remember which stop took which word
    // so the quizzes below can answer in whatever order they ask.
    const wordAtStop = {}
    for (let i = 0; i < words.length; i++) {
      const stop = await currentStop()
      wordAtStop[stop] = words[i]
      // The compartment has to be opened before the imagery box appears.
      await clickHotspot()
      await type('textarea', `a vivid test image for ${words[i]}`)
      if (i === 0) await shot('05-placement')
      await click('Place it')
      await click('Shut it away')
    }
    await sleep(400)

    // Three gauntlets: forward, backward, then random order.
    for (const label of ['06-quiz-forward', '07-quiz-backward', '08-quiz-random']) {
      for (let i = 0; i < words.length; i++) {
        const stop = await currentStop()
        await type('input', wordAtStop[stop] ?? '')
        if (i === 0) await shot(label)
        await click('Open it')
        await click('Next stop', { optional: true })
        await click('Finish this pass', { optional: true })
        await sleep(150)
      }
      await sleep(500)
    }

    // Mastery test: the whole phrase, repeated until the gate is satisfied.
    for (let attempt = 0; attempt < 4; attempt++) {
      const onMastery = await evaluate(`document.body.innerText.includes('Mastery Test')`)
      if (!onMastery) break
      await type('input', words.join(' '))
      if (attempt === 0) await shot('09-mastery')
      await click('Check', { optional: true })
      await sleep(500)
    }
    await sleep(400)
    await shot('10-create-vault')
    await click('Create my encrypted vault')
    await sleep(4000) // Argon2id at 64 MiB is deliberately slow.
    await click('Enter the vault')
    await sleep(600)
    await shot('11-unlocked-home')

    // The v2 credential screens — the part that matters most on a phone.
    await click('+ Add')
    await sleep(300)
    await type('input', 'An example account with a long label')
    await type('input:nth-of-type(1)', 'someone@a-fairly-long-domain.example.com', 2)
    await click('Generate random password')
    await shot('12-credential-form')
    await click('Add')
    await sleep(500)
    await shot('13-credential-list')

    const widest = await evaluate(`(() => {
      let worst = null
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.right > window.innerWidth + 1 || r.left < -1) {
          const w = Math.max(r.right - window.innerWidth, -r.left)
          if (!worst || w > worst.by) worst = { by: Math.round(w), tag: el.tagName, cls: el.className?.toString?.().slice(0, 90) }
        }
      }
      return worst
    })()`)

    const doc = await overflow()
    console.log(`\nHorizontal document overflow: ${doc}px`)
    if (doc > 0) problems.push(`document scrolls horizontally by ${doc}px at ${VIEWPORT.width}px wide`)
    if (widest) console.log(`Widest out-of-viewport element: ${widest.tag}.${widest.cls} (+${widest.by}px)`)

    // A reload must land on the lock screen: the vault persisted, and the
    // sealed state is what the user meets next time.
    await call('Page.reload')
    await sleep(2000)
    const afterReload = await evaluate(`document.body.innerText.trim().slice(0, 80)`)
    const rendered = await evaluate(`!!document.querySelector('#root')?.children.length`)
    console.log(`\nAfter reload: ${rendered ? 'app rendered' : 'BLANK'} — "${afterReload.split('\n').join(' ')}"`)
    if (!rendered) problems.push('app did not render after a reload')
    if (!afterReload.toLowerCase().includes('unlock')) {
      problems.push('a reload did not land on the lock screen')
    }
    await shot('14-after-reload')
  } finally {
    try {
      ws?.close()
    } catch {
      /* already gone */
    }
    child.kill()
    server.close()
  }

  console.log('')
  if (problems.length) {
    console.error(`FAILED — ${problems.length} problem(s):`)
    problems.forEach((p) => console.error(`  - ${p}`))
    process.exitCode = 1
  } else {
    console.log('All visual checks passed.')
  }
}

await main()
