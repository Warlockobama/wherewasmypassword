import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)))

/**
 * The one thing no gate was checking.
 *
 * `npm test`, the build, `visual`, `autofill` and `journey` are the five gates,
 * and not one of them runs `package.mjs` — it is only ever run by hand, at
 * `RELEASE.md` step 4, which is the worst moment to discover that the file does
 * not parse. That is not hypothetical: a duplicate `const` sat in it through a
 * full green five-gate run and was found only by running the script.
 *
 * `node --check` parses without executing, which is what makes this safe to run
 * against a script whose whole job is to write files. It cannot tell whether
 * packaging is *correct* — `release-guard.test.mjs` covers the judgement, and
 * the archive itself still wants the by-hand run — but a syntax error is caught
 * here rather than on release day.
 */
describe('the scripts nothing else runs', () => {
  const scripts = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))

  it('has found the scripts at all', () => {
    // A glob that silently matches nothing is a test that silently passes.
    expect(scripts).toContain('package.mjs')
    expect(scripts.length).toBeGreaterThan(3)
  })

  it.each(scripts)('%s parses', (script) => {
    expect(() =>
      execFileSync(process.execPath, ['--check', join(SCRIPTS, script)], { stdio: 'pipe' }),
    ).not.toThrow()
  })
})
