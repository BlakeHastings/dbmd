// Fail when two decision records claim the same number.
//
// WHAT THIS PREVENTS
// ADR numbers are handed out by the orchestrator, and the rule that makes that
// necessary is that "the next free number on your branch" is usually already
// claimed on somebody else's. Parallel agents each take 0007 and both are right
// from where they are standing. Nothing about a merge notices.
//
// So this runs in `npm run check`, which means it runs on the merge commit in
// CI as well as on the branch. A collision that does not exist on your branch
// yet still turns the pull request red, which is the only moment either author
// can still cheaply renumber.
//
// It also fails a file whose name does not carry a number at all, because a
// record that cannot be ordered is a record nobody can hand out the next one
// after.
//
//   node scripts/check-adr-numbers.mjs
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'architecture', 'decisions')
const NAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .sort()

const problems = []
const byNumber = new Map()

for (const file of files) {
  const match = NAME.exec(file)
  if (!match) {
    problems.push(
      `${file}: not NNNN-kebab-title.md, so it has no number to order or hand out after`,
    )
    continue
  }
  const number = match[1]
  const existing = byNumber.get(number)
  if (existing) {
    problems.push(`${number} is claimed twice: ${existing} and ${file}`)
  } else {
    byNumber.set(number, file)
  }
}

if (problems.length > 0) {
  console.error('Decision record numbering is broken:\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(
    '\nRenumber one of them. Numbers are never reused and never renumbered once\n' +
      'merged, so the one to move is whichever is not yet on the default branch.',
  )
  process.exit(1)
}

console.log(`${byNumber.size} decision record${byNumber.size === 1 ? '' : 's'}, no number claimed twice.`)
