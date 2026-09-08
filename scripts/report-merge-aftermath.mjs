// Say out loud that a merge left `main` red, in the place the person who merged
// is already subscribed to.
//
// WHAT THIS DETECTS
// `merge-pr.mjs` refuses a pull request whose checks are red, stale or behind.
// That is prevention and it works. Nothing looked at the *result*, and the
// result is the one thing a bypass cannot avoid producing: the run that starts
// on the default branch a few seconds after the merge, against a combination
// that has only now come into existence.
//
// Measured on 2026-09-07, asking the API for a total rather than counting a
// page: `check` had 145 finished runs on `main` and seven of them were red.
// Every one was a merge that reported green on the branch and went red on
// `main` minutes later. Nobody noticed any of the seven, including the person
// who filed the item about it: the seventh is the post-merge run of the pull
// request whose entire subject was that nobody looks at a post-merge run.
//
// WHY IT IS NOT A GATE, AND MUST NOT BECOME ONE
// The run starts *after* the merge. Waiting for it would turn every merge into
// a several-minute stall in exchange for a verdict that arrives too late to act
// on: the commit is already on `main` and the only remedies are forward. So
// this reports and never blocks, which is `check-main-provenance.mjs`'s shape
// applied to a different property. Do not wire it into `merge-pr.mjs`.
//
// WHY A COMMENT AND NOT A LOG LINE
// A red run on `main` was already written down. It is on the Actions page, in
// colour, with a timestamp, and that is exactly the report that failed twice in
// one afternoon. The difference between a report and a signal is who does the
// travelling, so this posts on the pull request the commit came from, where the
// author is subscribed by default and GitHub does the delivering. Nobody has to
// remember to look, which is the only property that was actually missing.
//
// WHY IT WATCHES EVERY WORKFLOW THAT RUNS ON THE BRANCH
// Three workflows run on `main`: `check`, `model` and `provenance`. Only the
// first has ever failed there in volume, which is not a reason to look at only
// the first, and `provenance` has in fact failed there once. The list below is
// not a list: it is read out of `.github/workflows/`, so a fourth workflow that
// starts pushing to `main` is watched on the day it is added rather than on the
// day somebody remembers this file.
//
// WHY A RUN THAT HAS NOT APPEARED IS NOT A FAILURE
// `check-main-provenance.mjs` fails transiently right after a merge because it
// asks the API a question the API has not caught up with yet. The same lag is
// here, in two places: a commit's runs may not be listed for some seconds, and
// a commit's pull request association arrives a moment after the merge rather
// than during it. Both are answered by waiting and then by saying what is not
// known, never by reporting an absence as a red build. A signal that cries wolf
// once a month is a signal people learn to close.
//
// HOW THIS IS TESTED
// ADR 0057 said nothing in `npm run check` covered this, because the body was
// API calls and a test of a mock is a test of the mock. ADR 0058 landed the
// next day and made that reason false: it split `check-main-provenance.mjs`
// into a decision whose facts are arguments and a `main()` that holds the
// network. Nobody came back here. ADR 0082 is that visit.
//
// So everything above the banner below is a judgement with no network in it:
// which workflows run on the branch, which conclusions are green and which are
// red, whether a run is worth reporting, what the comment says, which pull
// request a commit landed through, and whether that comment has been posted
// already. `test/guards/broken-on-purpose.test.ts` breaks each of those on
// purpose. Everything below the banner is `gh`, the exit codes and the POST.
//
// The POST is still deliberately unfired, and that is not the same gap. Testing
// a decision function is asking this file a question; posting is writing in
// somebody's inbox, and seeding the channel with a test alarm about an old run
// is precisely the cry-wolf failure this design exists to avoid. ADR 0057 said
// so and it still stands.
//
//   node scripts/report-merge-aftermath.mjs                  # main's head, now
//   node scripts/report-merge-aftermath.mjs <sha>            # a named commit
//   node scripts/report-merge-aftermath.mjs --run <id>       # judge one finished run
//   node scripts/report-merge-aftermath.mjs --run <id> --post  # and deliver it
//
// Without `--post` nothing is written anywhere, so the first three forms are
// safe to run against production at any time and the fourth prints the comment
// it would have posted. `.github/workflows/aftermath.yml` is the caller that
// passes `--post`.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// SETUP: the branch a merge lands on. Everything here is about that branch and
// about nothing else; a red run on a feature branch is the author's own problem
// and is already in front of them.
const DEFAULT_BRANCH = 'main'

const WORKFLOW_DIR = join(repoRoot, '.github', 'workflows')

// A finished run's conclusion, sorted into the three answers that matter. The
// middle group is the one usually got wrong: a cancelled run is not a green
// run, it is a commit nobody verified, and reporting it as fine is how an
// unverified `main` becomes invisible.
export const GREEN = new Set(['success', 'skipped', 'neutral'])
export const RED = new Set(['failure', 'timed_out', 'startup_failure'])
// Anything else that is not in either set is reported as "no verdict".

// The pull request association shows up a moment after the merge, not always
// during it, which is the same lag `check-main-provenance.mjs` documents. This
// waits it out rather than posting a comment that says it could not find the
// pull request that plainly exists.
const PULL_ATTEMPTS = 5
const PULL_DELAY_MS = 6000

// ---------------------------------------------------------------------------
// The judgements, and the words they print. Nothing below this line reads a
// file or runs `gh`: every fact arrives as an argument, so a test reaches the
// rules by importing this file and handing them values. ADR 0082, applying the
// pattern ADR 0058 set for `check-main-provenance.mjs`.
// ---------------------------------------------------------------------------

/**
 * Whether an inline `branches:` value is something other than a list of branch
 * names, and therefore something this cannot answer about.
 *
 * A YAML alias and a GitHub expression are the two shapes that occur, and both
 * stand for names that are somewhere else. Comparing either against the branch
 * name is comparing against text that was never a branch name, so the answer is
 * "do not know" rather than "no".
 */
const notALiteralList = (value) => value.includes('*') || value.includes('${{')

/**
 * Every workflow whose `on:` block puts it on the default branch for a push.
 *
 * Read from the files rather than listed as a constant, for the reason
 * `check-commands.mjs` reads the CLI registry rather than repeating it: a
 * second copy of a list is a fact that can go quietly out of step with the
 * first, and here the cost of being out of step is a workflow nobody watches.
 *
 * The parse is deliberately generous. A `push:` trigger with no `branches:`
 * filter runs on every branch and therefore on this one, so it is included; a
 * `branches:` line this cannot read is included as well. Being wrong towards
 * watching too much costs a line of output. Being wrong the other way is the
 * defect.
 *
 * That second sentence was a claim rather than a behaviour until ADR 0082. The
 * list form honoured it, because an unreadable list yields no items and falls
 * through; the inline form did not, because `branches: *the-usual` simply does
 * not contain the word `main` and was dropped silently. `notALiteralList`
 * below is the difference, and the test that found it is the first thing ever
 * to ask this function a question.
 *
 * `files` is `[{ file, text }]` rather than a directory, which is the whole of
 * what makes this testable: the fixture is the YAML, not a tree on disk.
 */
export function watchedIn(files, defaultBranch = DEFAULT_BRANCH) {
  const watched = []

  for (const { file, text } of files) {
    // The `on:` block: from a top-level `on:` to the next top-level key.
    const start = /^on:\s*$/m.exec(text)
    if (!start) continue
    const rest = text.slice(start.index + start[0].length)
    const end = /^[A-Za-z_]/m.exec(rest)
    const trigger = end ? rest.slice(0, end.index) : rest

    const push = /^\s{2}push:\s*$/m.exec(trigger)
    if (!push) continue
    const afterPush = trigger.slice(push.index + push[0].length)
    const nextKey = /^\s{2}[A-Za-z_]/m.exec(afterPush)
    const pushBlock = nextKey ? afterPush.slice(0, nextKey.index) : afterPush

    // A push trigger that names tags and not branches is a release, not a merge.
    if (/^\s+tags:/m.test(pushBlock) && !/^\s+branches:/m.test(pushBlock)) continue

    const branches = /^\s+branches:\s*(.*)$/m.exec(pushBlock)
    if (branches && branches[1].trim() !== '') {
      // The inline form, `branches: [main]`, unless it is not a list of names
      // at all, in which case there is nothing to compare and the generous
      // answer is to watch.
      if (!notALiteralList(branches[1]) && !branches[1].includes(defaultBranch)) continue
    } else if (branches) {
      // The list form, one `- main` per line, up to the next key.
      const list = pushBlock.slice(branches.index + branches[0].length)
      const items = [...list.matchAll(/^\s+-\s*(.+)$/gm)].map((m) => m[1].trim())
      if (items.length > 0 && !items.some((item) => item.replace(/['"]/g, '') === defaultBranch)) {
        continue
      }
    }

    const name = /^name:\s*(.+)$/m.exec(text)
    watched.push({ file, name: name ? name[1].trim().replace(/['"]/g, '') : file })
  }

  return watched
}

/**
 * What a run that found nothing to watch says.
 *
 * Watching nothing is the defect this script exists to close, one level up, so
 * it is a refusal rather than an empty report.
 */
export function nothingWatchedReport(defaultBranch = DEFAULT_BRANCH) {
  return (
    `No workflow in .github/workflows/ appears to run on a push to ${defaultBranch}.\n` +
    `That is either true, in which case nothing here has anything to watch, or this\n` +
    `file's parse has stopped understanding the workflows. Check by eye before\n` +
    `believing it: a watcher that silently watches nothing is the defect this\n` +
    `script exists to close, one level up.`
  )
}

export function verdictOf(run) {
  if (run.status !== 'completed') return { kind: 'running', word: run.status }
  if (GREEN.has(run.conclusion)) return { kind: 'green', word: run.conclusion }
  if (RED.has(run.conclusion)) return { kind: 'red', word: run.conclusion }
  return { kind: 'unverified', word: run.conclusion ?? 'no conclusion' }
}

/** The jobs that failed. A comment naming them beats one that does not. */
export function failedJobNames(jobs) {
  return (jobs ?? []).filter((job) => RED.has(job.conclusion)).map((job) => job.name)
}

function minutesBetween(a, b) {
  const ms = Date.parse(b) - Date.parse(a)
  if (!Number.isFinite(ms)) return null
  return Math.max(0, Math.round(ms / 60000))
}

/** Hidden, and the reason a re-run does not post the same comment twice. */
export const marker = (run) => `<!-- merge-aftermath: run ${run.id} attempt ${run.run_attempt} -->`

/**
 * The comment. It is read in an email notification more often than on the page,
 * so it opens with the whole finding and puts the run's address on its own line.
 */
export function commentBody(run, verdict, jobs, defaultBranch = DEFAULT_BRANCH) {
  const sha = run.head_sha.slice(0, 8)
  const landed = run.head_commit?.timestamp
  const gap = landed ? minutesBetween(landed, run.updated_at) : null
  const named = jobs ?? []
  const naming =
    named.length > 0 ? `\n\nThe job that failed: ${named.map((j) => `\`${j}\``).join(', ')}.` : ''

  const headline =
    verdict.kind === 'red'
      ? `**\`${defaultBranch}\` went red when this merged.**`
      : `**\`${defaultBranch}\` reached no verdict when this merged.**`

  const what =
    verdict.kind === 'red'
      ? `\`${run.name}\` failed on \`${sha}\`, the commit this pull request put on \`${defaultBranch}\`.`
      : `\`${run.name}\` finished \`${verdict.word}\` on \`${sha}\`, the commit this pull request put on \`${defaultBranch}\`, so nothing has verified it.`

  return (
    `${marker(run)}\n` +
    `${headline}\n\n` +
    `${what}\n\n` +
    `${run.html_url} (attempt ${run.run_attempt})` +
    (gap === null ? '' : `\n\nThat is ${gap} minute${gap === 1 ? '' : 's'} after the commit landed.`) +
    naming +
    `\n\nThe checks were green when this merged, and that green was about the branch. ` +
    `This is the merge result, which is a combination that did not exist until the ` +
    `merge made it, and which nothing was watching until now.\n\n` +
    `Nothing is blocked and nothing has been reverted. What is wanted is a decision: ` +
    `open the run, work out whether it is this change or a flake, and either fix it ` +
    `forward through a pull request or re-run it. Until one of those happens ` +
    `\`${defaultBranch}\` is red, and the next pull request built on it inherits that.\n\n` +
    `Posted by \`scripts/report-merge-aftermath.mjs\`.`
  )
}

/**
 * Whether one finished run is worth a comment, and the line the log gets either
 * way.
 *
 * The three silences are as load bearing as the report. A run on another
 * branch, a run this workflow did not start from a push, and a run with no
 * verdict yet are all things that are not a red `main`, and reporting any of
 * them is how a signal earns its first ignored notification.
 */
export function runFinding(run, defaultBranch = DEFAULT_BRANCH) {
  if (run.head_branch !== defaultBranch) {
    return {
      report: false,
      line: `Run ${run.id} is on ${run.head_branch}, not ${defaultBranch}. Nothing to report.`,
    }
  }
  if (run.event !== 'push') {
    return {
      report: false,
      line: `Run ${run.id} was triggered by ${run.event} rather than a push. Nothing to report.`,
    }
  }

  const verdict = verdictOf(run)
  const sha = run.head_sha.slice(0, 8)

  if (verdict.kind === 'running') {
    return {
      report: false,
      verdict,
      line: `Run ${run.id} is ${verdict.word} on ${sha}. No verdict yet, so nothing to report.`,
    }
  }
  if (verdict.kind === 'green') {
    return {
      report: false,
      verdict,
      line: `${run.name} finished ${verdict.word} on ${sha}. ${defaultBranch} is fine.`,
    }
  }

  return {
    report: true,
    verdict,
    line: `${run.name} finished ${verdict.word} on ${sha} (${run.html_url}).`,
  }
}

/**
 * The pull requests that explain how a commit got onto the default branch:
 * merged, and targeting that branch.
 *
 * The same narrowing `check-main-provenance.mjs` makes and for the same reason:
 * an open pull request, or one aimed elsewhere, associates a commit without
 * landing it, so it is not the channel the author is subscribed to for this
 * merge.
 */
export function landedPullOf(pulls, defaultBranch = DEFAULT_BRANCH) {
  return (pulls ?? []).find((pull) => pull.merged_at && pull.base?.ref === defaultBranch) ?? null
}

/**
 * The pull request the commit arrived through, waited for rather than demanded.
 *
 * `pullsFor(sha)` is the API and `wait()` is the waiting, both as arguments, so
 * a test can exercise the retry without spending thirty seconds on it. An
 * absence after every attempt is an answer and not a failure: it is the
 * direct-push case, which `provenance` is already red about.
 */
export async function findLandedPull(sha, io) {
  const {
    pullsFor,
    wait = async () => {},
    attempts = PULL_ATTEMPTS,
    defaultBranch = DEFAULT_BRANCH,
  } = io

  const total = Math.max(1, attempts)
  for (let attempt = 1; attempt <= total; attempt += 1) {
    const landed = landedPullOf(await pullsFor(sha), defaultBranch)
    if (landed) return landed
    if (attempt < total) await wait()
  }
  return null
}

/**
 * Whether this exact run and attempt has already been reported on the pull
 * request.
 *
 * A second failure of a re-run is news and gets its own comment; the same
 * attempt reported twice is noise, and noise is how a signal stops being read.
 * A listing that could not be read is not evidence that nothing was said, but
 * it is also not a reason to stay silent about a red `main`, so it answers no.
 */
export function saidAlready(comments, run) {
  if (!Array.isArray(comments)) return false
  return comments.some((comment) => (comment.body ?? '').includes(marker(run)))
}

/**
 * The per-workflow lines for one commit, and how many of them are not green.
 *
 * `entries` is `[{ workflow, runs }]`, newest run first, which is how the API
 * lists them and is the current answer rather than the first one given: a
 * re-run replaces its predecessor in place.
 */
export function summariseRuns(entries) {
  const lines = []
  let red = 0

  for (const { workflow, runs } of entries) {
    if (!runs || runs.length === 0) {
      lines.push(`  ${workflow.name.padEnd(12)} no run yet, which is not the same as a red one`)
      continue
    }
    const run = runs[0]
    const verdict = verdictOf(run)
    if (verdict.kind === 'red' || verdict.kind === 'unverified') red += 1
    lines.push(`  ${workflow.name.padEnd(12)} ${verdict.word}   ${run.html_url}`)
  }

  return { lines, red }
}

/**
 * How often the default branch has finished red, and why that number is a floor.
 *
 * Two traps are avoided here on purpose, and both were sprung while this item
 * was being filed. The count comes from `total_count` on a filtered query and
 * never from the length of a page, because a listing is a window: `--limit 100`
 * against 145 runs answers 100 and says nothing at all about the other 45, and
 * that is how "four failures" got reported when there were seven. And the total
 * it returns is still only a floor, because `gh run rerun` updates a run in
 * place: a failure that was later re-run green is no longer a failure anywhere
 * the API can be asked.
 *
 * `counts` is `[{ name, failed }]`, one per watched workflow.
 */
export function floorReport(counts, defaultBranch = DEFAULT_BRANCH) {
  const total = counts.reduce((sum, entry) => sum + entry.failed, 0)
  const named = counts.map((entry) => `${entry.name} ${entry.failed}`).join(', ')
  return (
    `Runs that finished red on ${defaultBranch}, all time: ${total} (${named}).\n` +
    `That is a floor and not a rate. A re-run updates a run in place, so every\n` +
    `failure that was later re-run green has stopped being counted anywhere.`
  )
}

/**
 * Which of the two modes an invocation asks for, or the refusal.
 *
 * `--post` is the only argument that writes anything, and the rule about it is
 * a judgement rather than a parse: there is one comment to write and it is
 * about one finished run, so `--post` on a commit summary is a request this
 * cannot honour and must not silently ignore.
 */
export function parseArgs(argv) {
  const post = argv.includes('--post')
  const at = argv.indexOf('--run')

  if (at !== -1) {
    const runId = argv[at + 1]
    if (!runId || !/^\d+$/.test(runId)) {
      return { error: 'Usage: node scripts/report-merge-aftermath.mjs --run <id> [--post]' }
    }
    return { mode: 'run', runId, post }
  }

  if (post) {
    return {
      error:
        '--post only means something with --run. There is one comment to write and it is\n' +
        'about one finished run, not about a commit.',
    }
  }

  return { mode: 'commit', sha: argv.find((arg) => !arg.startsWith('--')), post: false }
}

// ---------------------------------------------------------------------------
// The network, the disk and the exit codes. Everything below runs only when
// this file is the entry point, so importing the rules above shells out to
// nothing and posts nothing.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function gh(args, options = {}) {
  try {
    return execFileSync('gh', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      input: options.input ?? '',
    })
  } catch (error) {
    const detail = error.stderr || error.message
    if (options.soft) return null
    console.error(`gh ${args.join(' ')}\n  failed: ${detail}`)
    console.error(`This needs \`gh\` authenticated with actions: read and pull-requests: write.`)
    process.exit(1)
  }
}

const ghJson = (args, options) => {
  const out = gh(args, options)
  return out === null ? null : JSON.parse(out)
}

function watchedWorkflows() {
  const files = readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((file) => ({ file, text: readFileSync(join(WORKFLOW_DIR, file), 'utf8') }))

  const watched = watchedIn(files)
  if (watched.length === 0) {
    console.error(nothingWatchedReport())
    process.exit(1)
  }
  return watched
}

function failedJobs(runId) {
  const jobs = ghJson(['api', `repos/{owner}/{repo}/actions/runs/${runId}/jobs?per_page=100`], {
    soft: true,
  })
  return failedJobNames(jobs?.jobs)
}

function landedPull(sha) {
  return findLandedPull(sha, {
    pullsFor: (commit) =>
      ghJson(['api', `repos/{owner}/{repo}/commits/${commit}/pulls`], { soft: true }),
    wait: () => sleep(PULL_DELAY_MS),
  })
}

function alreadySaid(pullNumber, run) {
  const comments = ghJson(
    ['api', `repos/{owner}/{repo}/issues/${pullNumber}/comments?per_page=100`],
    { soft: true },
  )
  return saidAlready(comments, run)
}

async function deliver(run, body) {
  const pull = await landedPull(run.head_sha)
  if (!pull) {
    console.error(
      `\nNothing to post to: no merged pull request into ${DEFAULT_BRANCH} is associated\n` +
        `with ${run.head_sha.slice(0, 8)} after ${(PULL_ATTEMPTS * PULL_DELAY_MS) / 1000}s of asking.\n\n` +
        `A commit on ${DEFAULT_BRANCH} with no pull request behind it is a separate\n` +
        `finding, and provenance.yml is already red about it. The report above is the\n` +
        `whole of what this had to say; it is in this log and nowhere else.`,
    )
    return false
  }

  if (alreadySaid(pull.number, run)) {
    console.log(`#${pull.number} already carries this run's comment. Not posting it twice.`)
    return true
  }

  const posted = gh(
    ['api', `repos/{owner}/{repo}/issues/${pull.number}/comments`, '--method', 'POST', '--input', '-'],
    { input: JSON.stringify({ body }), soft: true },
  )
  if (posted === null) {
    console.error(
      `Could not comment on #${pull.number}. The workflow needs pull-requests: write.\n` +
        `The report above is in this log and nowhere else.`,
    )
    return false
  }
  console.log(`Reported on #${pull.number}: ${pull.html_url}`)
  return true
}

async function judgeRun(runId, post) {
  const run = ghJson(['api', `repos/{owner}/{repo}/actions/runs/${runId}`])

  const finding = runFinding(run)
  console.log(finding.line)
  if (!finding.report) return 0

  const jobs = finding.verdict.kind === 'red' ? failedJobs(run.id) : []
  const body = commentBody(run, finding.verdict, jobs)

  console.log('')
  console.log(body)
  console.log('')

  if (!post) {
    console.log('Not posted: run again with --post to deliver this.')
    return 1
  }

  await deliver(run, body)
  // Delivered or not, the finding stands and this run's own colour should say
  // so. A green job beside a red one is the pattern that produced this item.
  return 1
}

/**
 * What `main` looks like right now, across every workflow that runs on it.
 *
 * This is the mode where "the run has not appeared yet" is most likely and most
 * misleading, because it is what a person runs in the minute after a merge.
 */
async function judgeCommit(sha) {
  // The branch as GitHub has it rather than as this checkout has it. A local
  // `main` that has not been fetched is a different commit, and answering about
  // it would be answering a question nobody asked.
  const commit = ghJson(['api', `repos/{owner}/{repo}/commits/${sha ?? DEFAULT_BRANCH}`])
  const at = commit.sha

  console.log(`${DEFAULT_BRANCH} at ${at.slice(0, 8)}: ${commit.commit.message.split('\n')[0]}`)
  console.log('')

  const watched = watchedWorkflows()
  const entries = watched.map((workflow) => {
    const listing = ghJson([
      'api',
      `repos/{owner}/{repo}/actions/workflows/${workflow.file}/runs?head_sha=${at}&per_page=20`,
    ])
    return { workflow, runs: listing.workflow_runs ?? [] }
  })

  const summary = summariseRuns(entries)
  for (const line of summary.lines) console.log(line)

  console.log('')
  console.log(
    floorReport(
      watched.map((workflow) => {
        const failed = ghJson([
          'api',
          `repos/{owner}/{repo}/actions/workflows/${workflow.file}/runs` +
            `?branch=${DEFAULT_BRANCH}&status=failure&per_page=1`,
        ])
        return { name: workflow.name, failed: failed.total_count }
      }),
    ),
  )
  return summary.red > 0 ? 1 : 0
}

async function main() {
  const asked = parseArgs(process.argv.slice(2))
  if (asked.error) {
    console.error(asked.error)
    process.exit(1)
  }

  const code =
    asked.mode === 'run' ? await judgeRun(asked.runId, asked.post) : await judgeCommit(asked.sha)

  process.exit(code)
}

// Imported by test/guards/broken-on-purpose.test.ts, which feeds the judgements
// above fabricated runs, workflows and comments. Importing this file must
// therefore ask nothing, post nothing and exit nothing, which is what this line
// is for. ADR 0058 for the pattern, ADR 0082 for why it arrived here late.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main()
}
