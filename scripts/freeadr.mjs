// Which decision record number is actually free, counting every open branch.
//
// `scripts/check-adr-numbers.mjs` answers this for the default branch and is a
// gate. It cannot see two open pull requests both claiming one number, because
// neither has landed. That is the gap this closes, and it is the gap that let
// 0092 go out twice in one night.
//
// It is not a gate and is not wired into `npm run check`. A gate answers at
// merge time and this question is asked before a brief is written, which is the
// only moment at which the answer can still prevent anything.
//
// **Three places a number can be taken, and it reads all three.** The default
// branch, every open pull request, and every agent worktree, because a record an
// agent has created and not pushed is a file on this machine and nothing else
// knows about it. What it cannot read is the fourth place, which is a promise
// you made in a brief before the agent wrote anything, and the closing lines say
// so rather than leaving the reader to find out the way I did.
//
//   node scripts/freeadr.mjs [repo]
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'

const repo = process.argv[2] ?? process.cwd()
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
const gh = (...args) => execFileSync('gh', args, { cwd: repo, encoding: 'utf8' })

const numbers = (text) => [...text.matchAll(/(?:^|\/)(\d{4})-/gm)].map((m) => Number(m[1]))

const onMain = numbers(git('ls-tree', '--name-only', 'origin/main', 'docs/architecture/decisions/'))
console.log(`on origin/main : ${onMain.length} records, highest ${Math.max(...onMain)}`)

const branches = JSON.parse(gh('pr', 'list', '--state', 'open', '--json', 'number,headRefName'))
const claimed = new Map()
for (const { number, headRefName } of branches) {
  try {
    git('fetch', '-q', 'origin', headRefName)
  } catch {
    console.log(`  #${number} ${headRefName}: could not fetch`)
    continue
  }
  const changed = git('diff', '--name-only', `origin/main...origin/${headRefName}`, '--', 'docs/architecture/decisions/')
  const added = numbers(changed).filter((n) => !onMain.includes(n))
  const amended = numbers(changed).filter((n) => onMain.includes(n))
  console.log(
    `  #${number} ${headRefName.padEnd(52)} adds [${added.join(' ')}] amends [${amended.join(' ')}]`,
  )
  for (const n of added) claimed.set(n, [...(claimed.get(n) ?? []), number])
}

const collisions = [...claimed.entries()].filter(([, prs]) => prs.length > 1)
for (const [n, prs] of collisions) {
  console.log(`\nCOLLISION: ${String(n).padStart(4, '0')} is claimed by ${prs.map((p) => '#' + p).join(' and ')}`)
}

// A number an agent has written down but not yet pushed is taken and no pull
// request knows it. Every agent works in a worktree under `.claude/worktrees`,
// and a record it has created is a file there, committed or not, so ask.
const worktrees = `${git('rev-parse', '--path-format=absolute', '--git-common-dir')
  .trim()
  .replace(/[/\\]\.git$/, '')}/.claude/worktrees`

const inFlight = new Map()
for (const name of existsSync(worktrees) ? readdirSync(worktrees) : []) {
  const dir = `${worktrees}/${name}`
  let rows
  try {
    // Both committed and not: `git status` for what is being written now, and
    // the diff against `main` for what has been committed and not pushed.
    rows = [
      ...execFileSync('git', ['status', '--short', '--untracked-files=all'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .split('\n')
        .map((l) => l.slice(3)),
      ...execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).split('\n'),
    ]
  } catch {
    continue
  }
  for (const n of numbers(rows.filter((r) => r.includes('architecture/decisions/')).join('\n'))) {
    if (onMain.includes(n)) continue
    inFlight.set(n, name.replace(/^agent-/, ''))
  }
}

for (const [n, agent] of [...inFlight].sort()) {
  console.log(`  worktree ${agent}: has written ${String(n).padStart(4, '0')} and not pushed it`)
}

const taken = new Set([...onMain, ...claimed.keys(), ...inFlight.keys()])
let next = Math.max(...onMain) + 1
const free = []
while (free.length < 3) {
  if (!taken.has(next)) free.push(String(next).padStart(4, '0'))
  next++
}
console.log(`\nfree to hand out: ${free.join(', ')}`)

// **The one claim this cannot see is the one you made yourself.** It reads the
// default branch, every open pull request and every agent worktree, and a number
// promised in a dispatch message to an agent that has not yet written a file is
// in none of those. That is how 0098 went to two agents twenty minutes apart,
// with this script correctly reporting it free in between. So the last line is
// not a lookup: keep your own list of what you have handed out this session, and
// read it before you read this.
console.log('It cannot see a number you promised in a brief before the agent wrote a file.')
console.log('Check what you have already handed out this session first.')

process.exitCode = collisions.length === 0 ? 0 : 1
