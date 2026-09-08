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
//   node scripts/freeadr.mjs [repo]
import { execFileSync } from 'node:child_process'

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

const taken = new Set([...onMain, ...claimed.keys()])
let next = Math.max(...onMain) + 1
const free = []
while (free.length < 3) {
  if (!taken.has(next)) free.push(String(next).padStart(4, '0'))
  next++
}
console.log(`\nfree to hand out: ${free.join(', ')}`)
process.exitCode = collisions.length === 0 ? 0 : 1
