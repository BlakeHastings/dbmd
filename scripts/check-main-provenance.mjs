// Fail when a commit reached `main` without a pull request behind it.
//
// WHAT THIS PREVENTS
// Branch protection needs a paid plan on a private repo, so
// nothing at GitHub's end stops a direct push to `main` or a merge taken with CI
// red. Two layers stand in for it, and both are preventive: `guard-merge.mjs`
// only loads in a Claude Code session that started with `.claude/settings.json`
// present, and `merge-pr.mjs` only binds whoever chooses to type it. A layer
// that can be bypassed cannot tell you it was bypassed.
//
// This one runs on the result, so it cannot be. For every commit a push added to
// `main` it asks the API which pull requests that commit belongs to. A squash
// merge from a PR is associated with it; a commit pushed straight to `main` is
// associated with nothing. That is the whole distinction, and it is the one we
// need. Record it in an ADR when you install it.
//
// It detects rather than prevents: by the time it fails, the commit is on main.
// The value is that the failure is loud, dated and attributable, which is what
// makes "we enforce this procedurally" an auditable claim instead of a promise.
//
// HOW THIS IS TESTED
// A detector nothing has seen detect is a promise again. The rule here is one
// line — a commit associated with no pull request that merged into the default
// branch is a violation — and it lives in `landedPulls` and `auditCommits`
// below, whose git and API calls are arguments rather than imports.
// `test/guards/broken-on-purpose.test.ts` feeds them a commit with no pull
// request behind it and asserts this says so. `main()` holds the network and
// runs only when this file is the entry point. ADR 0058.
//
//   node scripts/check-main-provenance.mjs              # $BEFORE..$AFTER, or HEAD
//   node scripts/check-main-provenance.mjs <sha> [...]  # named commits
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// History below this commit is not judged, and the line is not arbitrary: it is
// the commit that added `guard-merge.mjs` and `merge-pr.mjs`. Before it, the
// PR-only rule was a sentence in a document; from the commit after it, every
// commit on main came through a pull request, without exception. Judging
// anything earlier would report eleven violations that were not violations at
// the time, and a check whose output is mostly noise gets muted.
//
// Do not move this forward to silence a failure. Moving it forward is how a
// real violation gets absorbed into "history we agreed not to look at".
// SETUP: the commit that first made the PR-only rule a control rather than a
// sentence, normally the one that adds this script and the merge wrapper.
const BASELINE = '30726ead8623a277be706f40a030b9c2fdce3954'

const DEFAULT_BRANCH = 'main'

// The association shows up in the API a moment after the merge, not always
// during it. We retry rather than accept a rare false positive: this check's
// only output is a red build that says somebody bypassed the process, and a
// check that cries wolf even once a month stops being read. Waiting half a
// minute to be sure is cheap; being ignored is not.
const RETRY_ATTEMPTS = 5
const RETRY_DELAY_MS = 6000

// Only a commit young enough for the API to still be catching up gets those
// retries. Anything older is being examined after the fact, where there is no
// lag left to wait out, so it answers immediately.
const LAG_WINDOW_MS = 15 * 60 * 1000

// ---------------------------------------------------------------------------
// The rule, and the words it prints. Nothing below this line runs git or `gh`:
// every fact arrives as an argument. ADR 0058.
// ---------------------------------------------------------------------------

/**
 * The pull requests that actually explain how a commit got onto the default
 * branch: merged, and targeting that branch.
 *
 * An open PR, or one aimed at some other branch, associates a commit without
 * landing it, so it is not evidence of anything. That narrowing is the rule,
 * and getting it wrong is how this check would go quiet without going away.
 */
export function landedPulls(pulls, defaultBranch = DEFAULT_BRANCH) {
  return pulls.filter((pull) => pull.merged_at && pull.base?.ref === defaultBranch)
}

/**
 * Every commit judged, with the network and git as arguments.
 *
 * `pullsFor(sha)` answers the associated pull requests, `describe(sha)` the
 * subject, author and date, `predatesBaseline(sha)` whether the commit is below
 * the line this repository agreed not to judge. `attemptsFor(sha)` says how
 * many times a young commit's association is worth waiting for, and `wait()` is
 * how the waiting happens; both are arguments so a test can exercise the retry
 * without spending thirty seconds on it.
 */
export async function auditCommits(shas, io) {
  const {
    pullsFor,
    describe,
    predatesBaseline,
    attemptsFor = () => 1,
    wait = async () => {},
    defaultBranch = DEFAULT_BRANCH,
  } = io

  const violations = []
  const accounted = []
  let exempt = 0

  for (const sha of shas) {
    if (predatesBaseline(sha)) {
      exempt += 1
      continue
    }

    const attempts = Math.max(1, attemptsFor(sha))
    let pulls = []
    let landed = []
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      pulls = await pullsFor(sha)
      landed = landedPulls(pulls, defaultBranch)
      if (landed.length > 0) break
      if (attempt < attempts) await wait()
    }

    const { subject, author, date } = describe(sha)
    if (landed.length > 0) {
      accounted.push(`${sha.slice(0, 8)}  #${landed[0].number}  ${subject}`)
    } else {
      violations.push({
        sha,
        subject,
        author,
        date,
        near: pulls.map((pull) => `#${pull.number} (${pull.state}, into ${pull.base?.ref})`).join(', '),
      })
    }
  }

  return { accounted, violations, exempt, checked: shas.length }
}

/** What a run with violations says, which is the only output anybody reads twice. */
export function violationReport({ violations, checked }, defaultBranch = DEFAULT_BRANCH) {
  const lines = [
    `A commit reached ${defaultBranch} outside the pull request flow ` +
      `(${violations.length} of ${checked}):`,
    '',
  ]
  for (const violation of violations) {
    lines.push(`  ${violation.sha}`)
    lines.push(`    ${violation.subject}`)
    lines.push(`    ${violation.author}  ${violation.date}`)
    lines.push(
      violation.near
        ? `    Associated pull requests, none of them merged into ${defaultBranch}: ${violation.near}`
        : `    No associated pull request.`,
    )
    lines.push('')
  }
  lines.push(
    `This is not a broken build. The code may be perfectly good. What failed is\n` +
      `that it arrived without review or green checks, which on this repo nothing\n` +
      `at GitHub's end prevents (see the ADR you wrote when installing this).\n\n` +
      `What to do, in order:\n` +
      `  1. Work out how it got there: a direct push, a merge taken with checks\n` +
      `     red, or a rewritten history. \`git show <sha>\` and the push event on\n` +
      `     this run tell you most of it.\n` +
      `  2. Decide whether the change stands. If it does not, revert it through a\n` +
      `     pull request like anything else.\n` +
      `  3. Close the gap that let it through, and record it. Per\n` +
      `     the process doc: this is a defect in the guard, not a mistake by\n` +
      `     whoever pushed. Add the case to scripts/guard-merge.mjs.\n\n` +
      `Do not silence this by moving the baseline in this script forward.`,
  )
  return lines.join('\n')
}

/** What a clean run says, listing what it checked so the line is an audit rather than a claim. */
export function accountedReport({ accounted, exempt }, defaultBranch = DEFAULT_BRANCH) {
  const skipped = exempt > 0 ? `, ${exempt} predating the baseline` : ''
  return [
    `Every new commit on ${defaultBranch} came through a pull request ` +
      `(${accounted.length} checked${skipped}).`,
    ...accounted.map((line) => `  ${line}`),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// The network, git and the exit codes. Everything below runs only when this
// file is the entry point, so importing the rule above shells out to nothing.
// ---------------------------------------------------------------------------

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function gh(args) {
  return execFileSync('gh', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function commitExists(rev) {
  try {
    git(['cat-file', '-e', `${rev}^{commit}`])
    return true
  } catch {
    return false
  }
}

// Which commits this run has to answer for.
//
// A push can add several commits at once, and only the head of it is visible in
// `github.sha`, so the range is what matters: every commit the push put on the
// branch gets asked about, not just the last one. `PROVENANCE_BEFORE` is
// `github.event.before`, which is the zero SHA on a branch creation and is not
// an ancestor at all after a force push. In either case `BASELINE..HEAD` is the
// honest fallback: it is every commit the baseline says we are willing to judge.
function commitsToCheck() {
  const named = process.argv.slice(2)
  if (named.length > 0) {
    return named.map((rev) => {
      if (!commitExists(rev)) {
        console.error(`Not a commit in this repository: ${rev}`)
        process.exit(1)
      }
      return git(['rev-parse', rev])
    })
  }

  const after = process.env.PROVENANCE_AFTER || 'HEAD'
  const before = process.env.PROVENANCE_BEFORE || ''
  const from = before && !/^0+$/.test(before) && commitExists(before) ? before : BASELINE

  return git(['rev-list', `${from}..${after}`])
    .split('\n')
    .filter(Boolean)
}

// A commit at or below the baseline predates the rule and is not judged.
function predatesBaseline(sha) {
  try {
    git(['merge-base', '--is-ancestor', sha, BASELINE])
    return true
  } catch {
    return false
  }
}

function associatedPulls(sha) {
  try {
    return JSON.parse(gh(['api', `repos/{owner}/{repo}/commits/${sha}/pulls`]))
  } catch (error) {
    console.error(
      `Could not ask the API about ${sha.slice(0, 8)}: ${error.stderr || error.message}\n` +
        `This check needs \`gh\` authenticated with pull-requests: read.`,
    )
    process.exit(1)
  }
}

function ageMs(sha) {
  return Date.now() - Number(git(['log', '-1', '--format=%ct', sha])) * 1000
}

async function main() {
  if (!commitExists(BASELINE)) {
    console.error(
      `The baseline commit ${BASELINE.slice(0, 8)} is not in this checkout, so nothing\n` +
        `can be judged against it. The workflow needs actions/checkout with\n` +
        `fetch-depth: 0; a shallow clone does not reach back far enough.`,
    )
    process.exit(1)
  }

  const commits = commitsToCheck()

  if (commits.length === 0) {
    console.log(`No new commits on ${DEFAULT_BRANCH} to account for.`)
    process.exit(0)
  }

  const result = await auditCommits(commits, {
    pullsFor: associatedPulls,
    describe: (sha) => ({
      subject: git(['log', '-1', '--format=%s', sha]),
      author: git(['log', '-1', '--format=%an <%ae>', sha]),
      date: git(['log', '-1', '--format=%cI', sha]),
    }),
    predatesBaseline,
    attemptsFor: (sha) => (ageMs(sha) < LAG_WINDOW_MS ? RETRY_ATTEMPTS : 1),
    wait: () => sleep(RETRY_DELAY_MS),
  })

  if (result.violations.length > 0) {
    console.error(violationReport(result))
    process.exit(1)
  }

  console.log(accountedReport(result))
}

// Imported by test/guards/broken-on-purpose.test.ts, which feeds the rule above
// a commit with nothing behind it. Importing this file must therefore judge
// nothing and run no commands, which is what this line is for.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main()
}
