// Which files is a running agent holding right now, and which agent.
//
// Written after telling an agent that a decision record was free while another
// agent had forty-five uncommitted lines in it. That is the fourth time in one
// session I have told an agent something about a record without checking, and
// the other three were decision-record numbers, which now have `freeadr.mjs`.
// This is the same answer for files.
//
// Every agent works in a worktree under `.claude/worktrees/agent-<id>`, and
// `git status` in one of those is the exact list of what that agent holds. So
// the information was always one command away from every brief I wrote.
//
// Two things it has to get right, both found by running it:
//
// 1. **A leftover directory is not a worktree.** 31 of the 51 directories here
//    are no longer registered, so `git status` in one of them walks up to the
//    main checkout and reports the owner's uncommitted README.md as if 31
//    agents were holding it. Ask each directory whether it is its own top
//    level before believing anything it says.
// 2. **A finished agent's worktree still holds its files.** Only the ids you
//    pass in are live, so pass them. With none, it reports every registered
//    worktree and says that is what it did.
//
// Usage:
//   node held.mjs --live <id>,<id>          what those agents hold
//   node held.mjs --live <id> -- <path>...  are these held, exit 1 if any is
//   node held.mjs                           every registered worktree
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync, realpathSync } from 'node:fs'

// The main checkout, wherever this is run from. A worktree's own top level is
// the worktree, so ask for the common one rather than the current one.
const root = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
  encoding: 'utf8',
}).trim()
const worktrees = `${root.replace(/[/\\]\.git$/, '')}/.claude/worktrees`

const argv = process.argv.slice(2)
const liveAt = argv.indexOf('--live')
const incomingAt = argv.indexOf('--incoming')
const dashdash = argv.indexOf('--')

/**
 * Refuse and say so, rather than throwing a stack trace at somebody who typed a
 * flag slightly wrong.
 */
function refuse(...lines) {
  for (const line of lines) console.error(line)
  console.error('')
  console.error('  node scripts/held.mjs                     what open branches hold')
  console.error('  node scripts/held.mjs --live <id>,<id>     what those agents hold')
  console.error('  node scripts/held.mjs --incoming <ref>     what a rebase brings into <ref>')
  console.error('  node scripts/held.mjs [--live <ids>] -- <path>...   are these held')
  process.exit(2)
}

// **An unknown flag is not a filename.** An agent ran `--incoming` from a tree
// cut before that flag existed, and the parser read it as a path and answered
// `free --incoming`, in green, silently. That is the same defect
// `check-commands.mjs` exists to catch for the CLI, in the tool the orchestrator
// uses to write briefs, so it is worth the eight lines.
const KNOWN = new Set(['--live', '--incoming', '--'])
const beforePaths = dashdash < 0 ? argv : argv.slice(0, dashdash)
for (const [i, arg] of beforePaths.entries()) {
  if (!arg.startsWith('--') || KNOWN.has(arg)) continue
  if (i > 0 && (beforePaths[i - 1] === '--live' || beforePaths[i - 1] === '--incoming')) continue
  refuse(`held.mjs: unknown option "${arg}".`)
}

if (liveAt >= 0 && (argv[liveAt + 1] === undefined || argv[liveAt + 1].startsWith('--'))) {
  refuse('held.mjs: --live wants a comma-separated list of agent ids.')
}
if (incomingAt >= 0 && (argv[incomingAt + 1] === undefined || argv[incomingAt + 1] === '--')) {
  refuse(
    'held.mjs: --incoming wants a branch or a sha.',
    'It answers what a rebase would bring into that ref, so there is nothing to answer without one.',
  )
}

const live =
  liveAt < 0
    ? undefined
    : new Set(
        argv[liveAt + 1]
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id !== ''),
      )
const asked = dashdash < 0 ? (liveAt < 0 && incomingAt < 0 ? argv : []) : argv.slice(dashdash + 1)

/** Both streams, because reading only stdout has produced a false reading here. */
function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// --incoming: what a rebase is about to bring into this branch's own files.
//
// Twice in one session I told an agent "none of the incoming commits touches
// your files" without running anything, and the second time an agent checked
// and I was wrong. It is one command and I was answering from memory of what I
// had merged, which is the same failure as quoting a count from arithmetic.
//
// A clean apply is not the answer to this question either. Two commits can edit
// one file in different places, merge without a conflict, and leave a test
// asserting against a page that has moved. What the agent needs to be told is
// which incoming commits touch its files, so it can re-verify those rather than
// trusting git's silence.
//
// **An empty answer here is not a clearance.** This compares path names, and a
// coupling does not have to be one. An agent rebasing over a commit that added
// `test/docs/skill.test.ts` found that the new test runs `dbmd refs` and asserts
// what it narrates, while its own branch was editing `src/cli/refs.ts`. No
// intersection of paths contains that. It read what the test does, established
// that its own edit was inside the help text no run of that block reads, and
// only then called it safe. So the overlap list is where to start reading, and a
// branch with nothing on it has been narrowed rather than cleared.
if (incomingAt >= 0) {
  const branch = argv[incomingAt + 1]
  if (branch === undefined) throw new Error('--incoming needs a branch or sha')

  const lines = (args) =>
    git(args)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')

  const base = git(['merge-base', branch, 'origin/main']).trim()
  const mine = new Set(lines(['diff', '--name-only', `${base}..${branch}`]))
  const commits = lines(['rev-list', `${base}..origin/main`])

  console.log(
    `${branch} touches ${mine.size} file(s). ${commits.length} commit(s) are ahead of it on origin/main.\n`,
  )

  let overlapping = 0
  for (const sha of commits.reverse()) {
    const touched = lines(['show', '--name-only', '--format=', sha]).filter((f) => mine.has(f))
    const subject = git(['show', '--format=%s', '--no-patch', sha]).trim()
    if (touched.length === 0) {
      console.log(`       ${sha.slice(0, 7)}  ${subject}`)
      continue
    }
    overlapping++
    console.log(`TOUCH  ${sha.slice(0, 7)}  ${subject}`)
    for (const file of touched) console.log(`         ${file}`)
  }

  console.log(
    overlapping === 0
      ? '\nNone of them touches a file this branch touches. That is where to start reading\n' +
        'rather than a clearance: a coupling does not have to be a shared path.'
      : `\n${overlapping} of them touch a file this branch touches. A clean apply is not evidence` +
          '\nthat the claims in those files still hold. Re-run what asserts against them.',
  )
  process.exit(0)
}

/** A directory that is its own git top level, or undefined for a leftover. */
function isWorktree(dir) {
  try {
    return realpathSync(git(['rev-parse', '--show-toplevel'], dir).trim()) === realpathSync(dir)
  } catch {
    return false
  }
}

/**
 * The head branch of every open pull request, or `undefined` where `gh` could
 * not be asked.
 *
 * **This is the only reliable way to tell a finished worktree from a working
 * one, and it took two wrong answers to get here.** Every merge in this
 * repository is a squash, so a landed branch's tip is not an ancestor of `main`
 * and `origin/main...HEAD` keeps showing its whole diff. Comparing each file
 * against `main` does not save it either: a later branch touching the same file
 * makes the merged one's version differ again, which is exactly what happened
 * on `test/guards/broken-on-purpose.test.ts`. What actually distinguishes them
 * is whether anybody is still asking for the branch to land.
 */
function openBranches() {
  try {
    return new Set(
      JSON.parse(
        execFileSync('gh', ['pr', 'list', '--state', 'open', '--json', 'headRefName'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      ).map((pr) => pr.headRefName),
    )
  } catch {
    return undefined
  }
}

/** The branch a worktree is on, or `undefined` when it is detached. */
function branchOf(dir) {
  try {
    const name = git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim()
    return name === 'HEAD' ? undefined : name
  } catch {
    return undefined
  }
}

const open = openBranches()

const byFile = new Map()
const read = []
const skipped = { notAWorktree: 0, notLive: 0 }
let finished = 0

for (const name of existsSync(worktrees) ? readdirSync(worktrees) : []) {
  const id = name.replace(/^agent-/, '')
  if (live !== undefined && !live.has(id)) {
    skipped.notLive++
    continue
  }
  const dir = `${worktrees}/${name}`
  if (!isWorktree(dir)) {
    skipped.notAWorktree++
    continue
  }
  read.push(id)

  const hold = (path, status) =>
    byFile.set(path, [...(byFile.get(path) ?? []), { agent: id, status }])

  // Uncommitted: what the agent has open right now.
  for (const line of git(['status', '--short', '--untracked-files=all'], dir).split('\n')) {
    if (line.trim() === '') continue
    hold(line.slice(3).trim(), line.slice(0, 2).trim())
  }

  // Committed on the branch and not on main: what it will touch when it lands.
  //
  // The first version reported only the first of these, and an agent that has
  // committed its work looks exactly like one that has not started. Both were
  // true here at once, and the difference matters to a brief: a file already
  // committed on somebody's branch is a conflict just the same.
  //
  // **A merged branch is not a holder, and nothing in the worktree can tell.**
  // An agent found this reported as a three-way COLLISION on one file whose
  // three holders were three merged pull requests. So a worktree's committed
  // rows count only when somebody is still asking for that branch to land, or
  // when you named it live. Everything else is finished and contributes only
  // what it has open right now, which is nothing.
  const branch = branchOf(dir)
  const stillWanted =
    (live !== undefined && live.has(id)) ||
    open === undefined ||
    (branch !== undefined && open.has(branch))

  if (!stillWanted) {
    finished++
    continue
  }

  try {
    for (const path of git(['diff', '--name-only', 'origin/main...HEAD'], dir).split('\n')) {
      const file = path.trim()
      if (file === '') continue
      const already = byFile.get(file)
      if (already?.some((h) => h.agent === id)) continue
      hold(file, 'committed')
    }
  } catch {
    // A detached worktree with no merge base is not an agent branch. Say
    // nothing rather than guessing: its uncommitted rows are already counted.
  }
}

if (asked.length > 0) {
  let anyHeld = false
  for (const path of asked) {
    const holders = byFile.get(path)
    if (holders === undefined) {
      console.log(`free   ${path}`)
      continue
    }
    anyHeld = true
    for (const holder of holders) console.log(`HELD   ${path}  by ${holder.agent} (${holder.status})`)
  }
  console.log(`\nread ${read.length} worktree(s): ${read.join(', ') || 'none'}`)
  process.exit(anyHeld ? 1 : 0)
}

const scope =
  live === undefined
    ? 'every worktree whose branch still has an open pull request'
    : 'the live agents you named'
console.log(`${byFile.size} file(s) held across ${read.length} worktree(s), reading ${scope}.`)
if (skipped.notAWorktree > 0) {
  console.log(`${skipped.notAWorktree} leftover director(ies) skipped: not their own git top level.`)
}
if (finished > 0) {
  console.log(
    `${finished} worktree(s) whose branch has no open pull request counted as finished.`,
  )
}
if (open === undefined) {
  console.log('`gh` could not be asked which branches are open, so every worktree was counted.')
}
console.log('')

for (const path of [...byFile.keys()].sort()) {
  const holders = byFile.get(path)
  console.log(`${holders.length > 1 ? 'COLLISION' : '  held   '} ${path}`)
  for (const holder of holders) console.log(`            by ${holder.agent} (${holder.status})`)
}

const collisions = [...byFile.values()].filter((h) => h.length > 1).length
console.log(
  `\n${collisions} file(s) held by more than one worktree.` +
    (collisions > 0 ? ' Those are a rebase somebody is going to pay for.' : ''),
)
