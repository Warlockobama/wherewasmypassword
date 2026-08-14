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
 * And whether or not the version has a tag: not from a tree with uncommitted
 * work in it, because the tag that follows a release has to name a commit that
 * rebuilds the zip.
 *
 * Not a git checkout, or `git` not on PATH — nothing to compare against, so
 * nothing to say. Packaging proceeds.
 *
 * One limit worth naming rather than pretending away: the tag lookup is local.
 * A tag that exists only on the remote — `gh release create` makes one
 * server-side, and a shallow or `--no-tags` clone will not have it — reads here
 * as "no such tag" and packaging proceeds. `RELEASE.md` step 7 tags locally
 * before publishing, which is what keeps that path out of the normal workflow;
 * this deliberately does not reach the network to close it, because packaging a
 * local-only password manager should not require one.
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
 * ceremony.
 *
 * Untracked files count. They were excluded on the grounds that a stray scratch
 * file is not the build — true of a scratch file, and false of the one place it
 * matters: `public/` is copied into `dist/` byte for byte, so a new file
 * dropped there is *in the archive* while no tracked file has changed. Every
 * output directory is gitignored (`dist/`, `release/`, `screenshots/`,
 * `node_modules/`, `*.tsbuildinfo`), and git does not report ignored paths here,
 * so what is left is a file that is genuinely in this tree and in no commit.
 */
export function tagFacts(version, cwd) {
  const tag = `v${version}`
  const tagSha = git(['rev-list', '-n', '1', tag], cwd)
  return {
    tag,
    tagSha,
    headSha: tagSha ? git(['rev-parse', 'HEAD'], cwd) : null,
    dirty: (git(['status', '--porcelain', '--', '.'], cwd) ?? '')
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
  if (override) return null

  const listed = () => {
    const shown = dirty.slice(0, 5).join(', ')
    return dirty.length > 5 ? `${shown}, and ${dirty.length - 5} more` : shown
  }

  // A version with no tag yet is the normal release path, and there is no
  // published archive to collide with — but `RELEASE.md` opens by saying a
  // release should be a commit anyone can check out, not a state of somebody's
  // laptop, and this is the moment that is decidable. Package 1.2.0 from a tree
  // with uncommitted work in it and the tag that follows points at a commit that
  // does not rebuild the zip, which is the whole failure `decisions/0028` is
  // about, arriving a second time by a different road.
  if (!tagSha) {
    if (!dirty.length) return null
    return (
      `this tree has uncommitted changes in app/: ${listed()}. Version ${version} has no tag ` +
      `yet, so what is packaged now is what ${tag} will be expected to rebuild — and a commit ` +
      `that does not contain these cannot. Commit them first. Set ${OVERRIDE}=1 to package anyway.`
    )
  }

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
    return (
      `the tree is at ${tag} but has uncommitted changes in app/: ${listed()}. ` +
      `The zip would carry ${version}'s name and not ${version}'s contents. ` +
      `Commit them and bump the version, or stash them. Set ${OVERRIDE}=1 to package anyway.`
    )
  }

  return null
}
