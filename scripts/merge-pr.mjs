// The only sanctioned way to land a PR on the default branch.
//
// WHAT THIS PREVENTS
// GitHub cannot enforce required checks here: branch protection needs a paid
// plan on a private repo. Without enforcement, "check the run first" is a
// habit, and habits lapse exactly when things are busy. This does the check
// mechanically and refuses otherwise.
//
// It also refuses a branch whose green is stale. A rollup is a fact about the
// branch as it was; the question at merge time is whether those checks are
// green on the MERGE RESULT, which is the same distinction reviewing.md makes
// for human reviewers. One repository learned this the loud way: the wrapper
// printed "All 2 required checks green. Squash merging..." and GitHub answered
// "2 of 2 required status checks are expected. (HTTP 405)" — the checks had run
// against the branch's original base and main had moved. Where a ruleset
// requires up-to-date branches, that ruleset catches it. Here nothing else
// does: the merge succeeds and the untested combination is what ships.
//
// Always squash: one issue becomes one commit on main, so `git log --oneline`
// stays a readable list of changes rather than a wall of "fix lint" noise, and
// reverting a change means reverting one commit.
//
// WHAT IT SAYS NOW THAT IT DID NOT
// Merging is one command with a clean success line. The rebase it forces on
// every other open branch surfaces minutes later in somebody else's report,
// looking like ordinary timing, so the cost is invisible at the moment somebody
// chooses to pay it. It is knowable, though: this script already asks the API
// about one pull request, and every other open one is a branch this merge is
// about to put behind its base, which is the exact state the stale refusal
// below rejects. So it names them first.
//
// It does not prompt and it does not refuse on that. Merging while others are
// open is often the right call and the alternative is a queue that never
// drains; what was missing is that the cost was paid by somebody not in the
// room. The listing is wrapped whole, because a merge that works today must not
// start depending on a second API call.
//
// HOW THIS IS TESTED
// Every refusal below is a function whose facts are arguments, and the network
// lives in `main()`, which runs only when this file is the entry point. That
// split is what makes the four refusals ordinary unit tests rather than
// something reachable only with a real pull request in a particular state.
// ADR 0058, closing the condition ADR 0034 recorded.
//
//   node scripts/merge-pr.mjs 42
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// SETUP: the exact `name:` of each required CI job, as GitHub reports it in
// the check rollup. Take them from a real run, not from the workflow file:
//   gh pr view <n> --json statusCheckRollup --jq '.statusCheckRollup[].name'
// A name that never appears is treated as "never ran" and refuses the merge.
// That is the safe direction, but a typo here looks like a broken script.
const REQUIRED = ['check']

// SETUP: refuse a branch that is behind its base. On by default, and it has to
// be: without branch protection GitHub reports such a branch as mergeable and
// merges it happily, so this line is the only thing standing between a stale
// green and main. The cost is real and worth knowing in advance — every merge
// puts every other open PR behind, so three open PRs become a rebase chain.
// Turn it off only if you would rather ship a combination nothing has run.
const REFUSE_WHEN_BEHIND = true

// GitHub computes mergeability asynchronously, so mergeStateStatus reads
// UNKNOWN for some seconds after any push and then settles. Refusing on
// UNKNOWN would make this refuse at random, and a wrapper that refuses at
// random gets worked around — which costs more than the gap it closes. So it
// waits this long for an answer, and then says what it does not know rather
// than guessing either way.
const MERGE_STATE_ATTEMPTS = 6
const MERGE_STATE_WAIT_MS = 2500

// ---------------------------------------------------------------------------
// The decision. Nothing below this line talks to the network: every fact it
// needs arrives as an argument, which is the whole of ADR 0058.
// ---------------------------------------------------------------------------

/**
 * Whether this pull request may be merged, and what to say either way.
 *
 * `pr` is what `gh pr view --json` answered. `behind` is how many commits the
 * head is behind its base, or `null` when that could not be compared. The
 * return is `{ merge, why, notes, warnings }`: `why` is the refusal, and the
 * other two are lines a merge prints on its way through.
 */
export function decideMerge({
  pr,
  behind,
  required = REQUIRED,
  refuseWhenBehind = REFUSE_WHEN_BEHIND,
  waitedSeconds = 0,
}) {
  const refuse = (why) => ({ merge: false, why, notes: [], warnings: [] })

  if (pr.state !== 'OPEN') return refuse(`state is ${pr.state}, not OPEN.`)
  if (pr.isDraft) return refuse('it is a draft.')
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') {
    return refuse(`it conflicts with ${pr.baseRefName}. Send it back to rebase and re-verify.`)
  }

  // Latest conclusion per check name; a rerun should not be judged on its first result.
  const latest = new Map()
  for (const check of pr.statusCheckRollup ?? []) {
    const name = check.name ?? check.context
    if (!name) continue
    const state = check.conclusion || check.state || 'PENDING'
    latest.set(name, state)
  }

  const problems = []
  for (const name of required) {
    const state = latest.get(name)
    if (state === undefined) problems.push(`${name}: never ran`)
    else if (state !== 'SUCCESS' && state !== 'NEUTRAL') problems.push(`${name}: ${state}`)
  }

  if (problems.length > 0) {
    return refuse(
      `required checks are not green:\n    ${problems.join('\n    ')}\n\n` +
        `  Fix the run, do not merge around it. If a check is wrong, change the check\n` +
        `  in its own PR and say so.`,
    )
  }

  // Green, but green against what? Everything above is a fact about the branch.
  // This is the question about the merge result.
  const behindPhrase = behind === null ? '' : ` by ${behind} commit(s)`

  const staleRefusal = () =>
    refuse(
      `the ${required.length} required check(s) are green, but the branch is behind\n` +
        `  ${pr.baseRefName}${behindPhrase}, so that green is stale. It was produced against the\n` +
        `  branch point, not against what would land.\n\n` +
        `  Send it back. The agent that owns the branch rebases it and re-verifies; you\n` +
        `  do not rebase it for them. Resolving someone's conflict makes you the author\n` +
        `  of a change you are about to review — parallelism.md, "Rebases are theirs,\n` +
        `  not yours". If that agent is gone, brief a fresh one whose job is rebase and\n` +
        `  re-verify rather than build.`,
    )

  // BEHIND is what GitHub reports when the base requires up-to-date branches: the
  // merge would fail with HTTP 405 and "N of N required status checks are
  // expected", so refusing here turns that into a sentence that names the fix.
  if (pr.mergeStateStatus === 'BEHIND') return staleRefusal()
  if (refuseWhenBehind && behind !== null && behind > 0) return staleRefusal()

  if (pr.mergeStateStatus === 'BLOCKED') {
    // BLOCKED is GitHub's answer for several different rules at once, so this
    // says what it can rule out and points at the one place that names the rule.
    // Printing "rebase" here for every cause would send agents to do work that
    // fixes nothing, which is how a wrapper stops being believed.
    const clues = []
    if (pr.reviewDecision === 'REVIEW_REQUIRED') {
      clues.push('reviewDecision is REVIEW_REQUIRED: an approving review is missing.')
    }
    if (pr.reviewDecision === 'CHANGES_REQUESTED') {
      clues.push('reviewDecision is CHANGES_REQUESTED: a reviewer is holding it.')
    }
    if (behind !== null && behind > 0) {
      clues.push(`It is also ${behind} commit(s) behind ${pr.baseRefName}, which may be the cause.`)
    } else if (behind === 0) {
      clues.push(`It is not behind ${pr.baseRefName}, so staleness is not the cause.`)
    }
    return refuse(
      `GitHub reports the merge state as BLOCKED, which is its answer for several\n` +
        `  different rules at once.\n\n` +
        `  If you have just pushed, that is the likely one: the rollup this script read\n` +
        `  lags a push by seconds, so the ${required.length} check(s) above can be the ` +
        `previous head's\n  green while the new run has not started. Wait for it and try again.\n` +
        (clues.length > 0 ? `\n  ${clues.join('\n  ')}\n` : '') +
        `\n  Otherwise BLOCKED covers required reviews, unresolved review threads, code\n` +
        `  owner rules, other required contexts and repository policy. Open the PR page:\n` +
        `  the merge box names the rule. Do not send it back to rebase without checking\n` +
        `  which one — BLOCKED is not BEHIND.`,
    )
  }

  const notes = []
  const warnings = []

  if (pr.mergeStateStatus === 'UNSTABLE') {
    notes.push(
      `Merge state is UNSTABLE: something outside the required set is red or still\n` +
        `running. The required check(s) are the contract, and they are green, so this\n` +
        `proceeds.`,
    )
  }

  if (pr.mergeStateStatus === 'UNKNOWN') {
    // Saying what is unverified, rather than refusing on a value that means
    // "GitHub has not answered yet".
    warnings.push(`Merge state is still UNKNOWN after ${waitedSeconds}s of waiting.`)
    warnings.push(`Unverified: whether ${pr.baseRefName} has moved under this branch since the`)
    warnings.push('checks ran, which is what the green above would then be stale against.')
    if (behind === null) {
      warnings.push(`Could not compare ${pr.headRefName} against ${pr.baseRefName} either.`)
    } else if (behind > 0) {
      warnings.push(
        `The commit comparison does say the head is ${behind} commit(s) behind ` +
          `${pr.baseRefName}.\nWhat lands is a combination nothing has run.`,
      )
    } else {
      warnings.push(`The commit comparison says the head is not behind ${pr.baseRefName}, which is`)
      warnings.push('the case that usually goes wrong.')
    }
    warnings.push('Proceeding on the check rollup alone.')
  }

  return { merge: true, why: null, notes, warnings }
}

/**
 * What this merge costs the branches whose agents are not in the room.
 *
 * `others` is the raw open list, and every entry aimed at the same base is a
 * branch this merge puts behind it — the exact state `decideMerge` refuses
 * above as "green, but produced against the branch point". Returns `null` only
 * when nothing was answered. "Nothing else is open" is a sentence rather than
 * silence, because a reader cannot tell silence from a question never asked.
 */
export function stalenessNotice({ pr, others }) {
  if (others === null || others === undefined) return null

  const affected = others.filter(
    (other) => other.number !== pr.number && other.baseRefName === pr.baseRefName,
  )
  if (affected.length === 0) {
    return `No other pull request is open against ${pr.baseRefName}, so this merge makes nothing stale.`
  }

  const width = Math.max(...affected.map((other) => String(other.number).length))
  return [
    affected.length === 1
      ? `Merging #${pr.number} will make 1 other branch stale:`
      : `Merging #${pr.number} will make ${affected.length} other branches stale:`,
    ...affected.map((other) => `  #${String(other.number).padEnd(width)}  ${other.headRefName}`),
    affected.length === 1
      ? 'It needs a rebase and a re-verify before it can land.'
      : 'Each needs a rebase and a re-verify before it can land.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// The network, and the exit codes. Everything below runs only when this file is
// the entry point, so importing the two functions above merges nothing.
// ---------------------------------------------------------------------------

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function readPr(prNumber) {
  try {
    return JSON.parse(
      gh([
        'pr',
        'view',
        prNumber,
        '--json',
        'number,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,' +
          'baseRefName,headRefName,statusCheckRollup',
      ]),
    )
  } catch (error) {
    console.error(`Could not read PR #${prNumber}: ${error.stderr || error.message}`)
    process.exit(1)
  }
}

// Deterministic where mergeStateStatus is not. The compare API answers "is the
// head behind its base" from commits, immediately, whatever GitHub has or has
// not finished computing. It makes the messages above specific, and it is the
// one thing worth saying while mergeability is still UNKNOWN.
function commitsBehindBase(pr) {
  try {
    const behind = gh([
      'api',
      `repos/{owner}/{repo}/compare/${pr.baseRefName}...${pr.headRefName}`,
      '--jq',
      '.behind_by',
    ]).trim()
    return Number.isNaN(Number(behind)) ? null : Number(behind)
  } catch {
    // A fork's head branch does not exist in this repository, so the compare
    // is a 404 rather than an answer. Callers degrade to a vaguer message.
    return null
  }
}

// The second API call, wrapped whole. A failure here returns null and the merge
// goes on without the line: this is information, not a gate, and a merge that
// worked yesterday does not start depending on it.
function otherOpenPulls() {
  try {
    return JSON.parse(
      gh([
        'pr',
        'list',
        '--state',
        'open',
        '--limit',
        '100',
        '--json',
        'number,headRefName,baseRefName',
      ]),
    )
  } catch {
    return null
  }
}

async function main() {
  const prNumber = process.argv[2]
  if (!prNumber || !/^\d+$/.test(prNumber)) {
    console.error('Usage: node scripts/merge-pr.mjs <pr-number>')
    process.exit(1)
  }

  let pr = readPr(prNumber)
  let polls = 0
  if (pr.mergeStateStatus === 'UNKNOWN') {
    console.log(`GitHub has not finished computing mergeability for PR #${prNumber}. Waiting...`)
  }
  while (pr.mergeStateStatus === 'UNKNOWN' && polls < MERGE_STATE_ATTEMPTS) {
    polls += 1
    await sleep(MERGE_STATE_WAIT_MS)
    pr = readPr(prNumber)
  }

  const decision = decideMerge({
    pr,
    behind: commitsBehindBase(pr),
    waitedSeconds: (polls * MERGE_STATE_WAIT_MS) / 1000,
  })

  if (!decision.merge) {
    console.error(`Refusing to merge PR #${prNumber} (${pr.title}):\n  ${decision.why}`)
    process.exit(1)
  }

  console.log(`PR #${prNumber}: ${pr.title}`)
  for (const note of decision.notes) console.log(note)
  for (const warning of decision.warnings) console.warn(warning)

  const notice = stalenessNotice({ pr, others: otherOpenPulls() })
  if (notice === null) {
    console.log(
      'Could not list the other open pull requests, so this cannot say which branches\n' +
        'the merge makes stale. That listing is not a gate; merging anyway.',
    )
  } else {
    console.log(notice)
  }

  console.log(`All ${REQUIRED.length} required checks green. Squash merging...`)

  try {
    // The REST endpoint rather than `gh pr merge`, which the guard blocks by name.
    gh([
      'api',
      '--method',
      'PUT',
      `repos/{owner}/{repo}/pulls/${prNumber}/merge`,
      '-f',
      'merge_method=squash',
    ])
  } catch (error) {
    const message = error.stderr || error.message
    console.error(`Merge failed: ${message}`)
    if (/required status checks are expected/i.test(message)) {
      // The 405 this script exists to explain. It reaches here only when
      // mergeStateStatus was UNKNOWN above, so the translation is worth printing.
      console.error(
        `\nThat is the stale-branch case: ${pr.baseRefName} requires the checks to have run\n` +
          `on an up-to-date branch, and these ran on the branch point. Send it back to\n` +
          `the owning agent to rebase and re-verify.`,
      )
    }
    process.exit(1)
  }

  try {
    gh(['api', '--method', 'DELETE', `repos/{owner}/{repo}/git/refs/heads/${pr.headRefName}`])
    console.log(`Merged into ${pr.baseRefName} and deleted branch ${pr.headRefName}.`)
  } catch {
    console.log(`Merged. Branch ${pr.headRefName} could not be deleted; remove it manually.`)
  }
}

// Imported by test/guards/broken-on-purpose.test.ts, which calls the two
// exported functions with fabricated answers. Importing this file must
// therefore merge nothing, which is what this line is for.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main()
}
