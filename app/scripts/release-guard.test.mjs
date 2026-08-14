import { describe, expect, it } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { OVERRIDE, repackageProblem, tagFacts } from './release-guard.mjs'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The published-tag case: v1.1.0 exists and the tree is somewhere ahead of it. */
const AHEAD = {
  version: '1.1.0',
  tag: 'v1.1.0',
  tagSha: '339b3e7a70d00c62e4dcfa1ec0039d3fadc9a5cd',
  headSha: '941259c2c49cdf642556c395b506e12caa9982f4',
  dirty: [],
}

describe('repackageProblem', () => {
  it('refuses to repackage a version that is already a tag', () => {
    const problem = repackageProblem(AHEAD)
    expect(problem).toBeTruthy()
    expect(problem).toContain('already published')
    // The message has to carry the way out, not just the complaint.
    expect(problem).toContain('RELEASE.md step 1')
    expect(problem).toContain('339b3e7')
    expect(problem).toContain('941259c')
  })

  it('allows packaging the tag itself — that is how the checksum is checked', () => {
    expect(repackageProblem({ ...AHEAD, headSha: AHEAD.tagSha })).toBeNull()
  })

  it('refuses at the tag when app/ has uncommitted changes', () => {
    const problem = repackageProblem({
      ...AHEAD,
      headSha: AHEAD.tagSha,
      dirty: ['M src/credentials/audit.ts'],
    })
    expect(problem).toContain('uncommitted changes')
    expect(problem).toContain('src/credentials/audit.ts')
  })

  it('names only the first few dirty paths, and counts the rest', () => {
    const dirty = Array.from({ length: 8 }, (_, i) => `M src/file-${i}.ts`)
    const problem = repackageProblem({ ...AHEAD, headSha: AHEAD.tagSha, dirty })
    expect(problem).toContain('src/file-0.ts')
    expect(problem).toContain('and 3 more')
    expect(problem).not.toContain('src/file-7.ts')
  })

  it('says nothing when the version has no tag yet — the normal release path', () => {
    expect(repackageProblem({ version: '1.2.0', tag: 'v1.2.0', tagSha: null, headSha: null })).toBeNull()
  })

  it('refuses an untagged version from a dirty tree, because the tag has to rebuild it', () => {
    // There is no published archive to collide with here, and that is not the
    // point: the zip goes out and the tag follows, and a commit that does not
    // contain these changes cannot rebuild what was published from them.
    const problem = repackageProblem({
      version: '1.2.0',
      tag: 'v1.2.0',
      tagSha: null,
      headSha: null,
      dirty: ['?? public/leftover.png'],
    })
    expect(problem).toContain('uncommitted changes')
    expect(problem).toContain('public/leftover.png')
    expect(problem).toContain('v1.2.0')
    expect(problem).toContain(OVERRIDE)
  })

  it('counts the rest on that path too', () => {
    const dirty = Array.from({ length: 8 }, (_, i) => `?? public/file-${i}.png`)
    const problem = repackageProblem({ version: '1.2.0', tag: 'v1.2.0', tagSha: null, dirty })
    expect(problem).toContain('and 3 more')
    expect(problem).not.toContain('public/file-7.png')
  })

  it('says nothing outside a git checkout, where there is nothing to compare', () => {
    // tagFacts reports every field null when git cannot answer; the judgement
    // must read that as "cannot tell", not as a refusal.
    expect(repackageProblem({ version: '1.1.0', tag: 'v1.1.0', tagSha: null, headSha: null })).toBeNull()
  })

  it('yields to the override, for wanting a zip of work in progress on purpose', () => {
    expect(repackageProblem({ ...AHEAD, override: true })).toBeNull()
    expect(repackageProblem({ version: '1.2.0', tagSha: null, dirty: ['M src/x.ts'], override: true })).toBeNull()
    expect(OVERRIDE).toBe('WWMP_PACKAGE_ANYWAY')
  })
})

describe('tagFacts', () => {
  it('reports no tag for a version that was never released', () => {
    const facts = tagFacts('999.999.999', APP_DIR)
    expect(facts).toMatchObject({ tag: 'v999.999.999', tagSha: null, headSha: null })
    // `dirty` is deliberately not asserted empty: it reports this working tree,
    // and the tree a test runs in is usually mid-change. That it is a list of
    // strings is the part that belongs to this module.
    expect(Array.isArray(facts.dirty)).toBe(true)
  })

  it('reads the working tree even when the version has no tag', () => {
    // The judgement now needs `dirty` on that path — it used to be handed an
    // empty list there whatever the tree looked like.
    const facts = tagFacts('999.999.999', APP_DIR)
    expect(facts.dirty).toEqual(
      tagFacts('1.1.0', APP_DIR).dirty,
    )
  })
})
