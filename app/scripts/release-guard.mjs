/**
 * One version, one archive.
 *
 * `decisions/0022` bought a published checksum instead of an update channel:
 * there is no auto-update, so the only thing a stranger has to check a download
 * against is the SHA-256 in the release notes, and the only reason that number
 * is worth printing is that `npm run package` is reproducible — check out the
 * tag, package, compare (`scripts/package.mjs`, `FIXED_STAMP`).
 *
 * That property has a quiet enemy, and `decisions/0027` created it deliberately:
 * James ruled "let it ride" on releasing the password review, so `master` now
 * carries a feature the published 1.1.0 does not, while both call themselves
 * 1.1.0. Package master today and you get a file named
 * `wherewasmypassword-1.1.0.zip` whose hash is not the published 1.1.0's — the
 * same name and the same version for two different archives. The published asset
 * on GitHub is untouched by this; what gets overwritten is the local copy, which
 * is exactly the copy someone reaches for when checking a report about "the
 * 1.1.0 zip".
 *
 * So: if the version being packaged already has a tag, this refuses unless the
 * tree *is* that tag. Bump the version (RELEASE.md step 1) or check the tag out.
 * The gap widens with every feature that lands before the next release, which is
 * why it is a refusal and not a note in a doc nobody reads at the wrong moment.
 *
 * Not a git checkout, no such tag, or `git` not on PATH — nothing to compare
 * against, so nothing to say. Packaging proceeds.
 */
import { execFileSync } from 'node:child_process'

/** The escape hatch, for wanting a zip of work in progress on purpose. */
export const OVERRIDE = 'WWMP_PACKAGE_ANYWAY'

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // No git, no repository, or no such revision. All three mean "cannot tell",
    // which this treats the same as "nothing wrong" — see the header.
    return null
  }
}

/**
 * What git knows about `v<version>`, gathered separately from the judgement so
 * the judgement can be tested without a repository.
 *
 * `dirty` is scoped to `cwd` (the app directory): an edited decision doc does
 * not change a byte of the zip, and refusing to package over one would be
 * ceremony. Untracked files are excluded for the same reason — `dist/` and
 * `release/` are gitignored, but a stray scratch file is not the build.
 */
export function tagFacts(version, cwd) {
  const tag = `v${version}`
  const tagSha = git(['rev-list', '-n', '1', tag], cwd)
  if (!tagSha) return { tag, tagSha: null, headSha: null, dirty: [] }
  return {
    tag,
    tagSha,
    headSha: git(['rev-parse', 'HEAD'], cwd),
    dirty: (git(['status', '--porcelain', '--untracked-files=no', '--', '.'], cwd) ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  }
}

const short = (sha) => (sha ? sha.slice(0, 7) : 'an unknown commit')

/**
 * The judgement: a string explaining the refusal, or `null` to go ahead.
 *
 * Pure — every fact arrives as an argument.
 */
export function repackageProblem({ version, tag, tagSha, headSha, dirty = [], override = false }) {
  if (override || !tagSha) return null

  const bumpOrCheckout =
    `Bump the version in public/manifest.json and package.json together ` +
    `(RELEASE.md step 1), or check out ${tag} to rebuild the published archive. ` +
    `Set ${OVERRIDE}=1 to package anyway.`

  if (headSha !== tagSha) {
    return (
      `version ${version} is already published — ${tag} is ${short(tagSha)} and this tree ` +
      `is ${short(headSha)}. Packaging would write wherewasmypassword-${version}.zip with ` +
      `contents the published ${version} does not have, under a SHA-256 that does not match ` +
      `its release notes. A published checksum is only worth anything while one version ` +
      `means one archive. ${bumpOrCheckout}`
    )
  }

  if (dirty.length) {
    const shown = dirty.slice(0, 5).join(', ')
    const rest = dirty.length > 5 ? `, and ${dirty.length - 5} more` : ''
    return (
      `the tree is at ${tag} but has uncommitted changes in app/: ${shown}${rest}. ` +
      `The zip would carry ${version}'s name and not ${version}'s contents. ` +
      `Commit them and bump the version, or stash them. Set ${OVERRIDE}=1 to package anyway.`
    )
  }

  return null
}
