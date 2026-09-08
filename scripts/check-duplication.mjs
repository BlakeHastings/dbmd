// Fail when a tracked markdown file holds a long run of its own lines twice.
//
// WHAT THIS PREVENTS
// `docs/process/verified.md` is this repository's evidence log. On 2026-09-08 it
// was found holding its own body three times over, from a pull request two days
// earlier whose description said it was a sweep and whose diff was `+3688`. The
// file sat at 5885 lines, of which roughly two thirds were a duplicate of the
// third, and nobody noticed for two days.
//
// Nothing in the review or the gate looked at it, and neither was careless. A
// duplicated markdown file is not code. It has no tests to fail, it typechecks
// by not being typed, and Prettier formats a repeated paragraph exactly as
// happily as a unique one. The only signal was a diff too large to read, which
// is the signal a sweep of an evidence log is supposed to produce.
//
// WHY A RUN AND NOT A LINE
// The naive check fails on the first page it meets. Markdown repeats short lines
// constantly: blank lines, list markers, `## Context`, a table's separator row.
// "No line appears twice" would fire on every file in this tree and be deleted
// within the hour.
//
// What is distinctive about this failure is not that a line repeats but that a
// long block of consecutive lines repeats, verbatim, in one file. Eighteen
// hundred of them, twice over. So this finds the longest run of consecutive
// lines that appears at two disjoint places in one file, and refuses beyond a
// threshold. A repeated sentence is invisible to it. A pasted section is not.
//
// WHERE THE THRESHOLD COMES FROM
// Measured across all 156 tracked markdown files on 2026-09-08, longest first:
//
//   1824  docs/process/verified.md   the defect, at lines 2 and 1830
//     12  docs/format.md             two `dbmd refs --json` objects, identical
//                                    shape and identical values, inside one
//                                    payload block the tool printed
//      6  docs/ci.md                 the checkout-and-setup-node preamble two
//                                    workflow jobs share
//      5  README.md
//      4  docs/import-format.md
//      3  and everything below it
//
// So the largest legitimate repeated run in this repository is 12 lines, and the
// gap between that and the thing this exists to catch is two orders of
// magnitude. Any threshold in it would work. `LIMIT` is 40: about three times
// the largest run measured, which leaves room for a third workflow job or a
// longer `--json` payload to arrive without anybody having to touch this number,
// and still forty five times smaller than the duplication it is here for.
//
// The summary line reports the longest run it found, so the margin is on every
// green run rather than only in this comment. Somebody raising `LIMIT` can read
// the last run and see whether they are making room for legitimate repetition or
// neutering the check.
//
// WHAT THIS DOES NOT CATCH
// It errs, deliberately, toward missing duplication rather than firing on
// repetition somebody meant.
//
//   Anything under 40 lines. A repeated paragraph, a repeated table row, a
//   heading written twice: all invisible, on purpose. This is not a prose
//   linter.
//
//   Duplication across two files. A page pasted into a second page is not a
//   finding here, and pages in this tree quote each other on purpose: the
//   decision records cite each other at length and `README.md` shares sentences
//   with `docs/`. The incident was inside one file and so is the check.
//
//   Anything not verbatim. One word changed in the middle of a pasted block
//   splits the run in two. A duplicate with an edit every thirty lines passes
//   this check completely. That is inherent to comparing lines, and the failure
//   mode it misses is a person editing a duplicate rather than a tool making
//   one, which is not what happened here.
//
//   Anything that is not `.md`. A duplicated TypeScript module, a JSON fixture
//   written twice, a workflow with the same job twice: none of them are read.
//
//   Whether the content is right. It says a file does not hold a long block of
//   itself twice. It says nothing about whether the block is true.
//
// WHY NOTHING IS EXCLUDED
// `scripts/check-commands.mjs` excludes three prefixes and each earns it. This
// scans everything tracked with a `.md` extension, and the candidates were
// considered rather than skipped:
//
//   `docs/architecture/decisions/` stays in. Those records quote each other
//   deliberately, which is the reason `check-commands.mjs` excludes them, and it
//   is not a reason here, because quoting another file is cross-file repetition
//   and this reads one file at a time. Within a single record the longest
//   repeated run in the whole directory is 3 lines. An ADR is long prose, which
//   is exactly the shape that gets pasted twice, so excluding them would give up
//   87 of the 156 files this has to cover.
//
//   `test/fixtures/` stays in. Those models are deliberately malformed, and
//   "holds forty identical lines twice" is not one of the malformations any of
//   them is testing. The longest run in the directory is 3.
//
//   `test/guards/` needs no entry. Its fixtures are wrong on purpose, which
//   would earn one, but they live inside string literals in a `.ts` file and
//   this reads `.md` only.
//
//   node scripts/check-duplication.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * How many consecutive lines a file may hold twice before this refuses.
 *
 * Read the comment above before changing it. The number is derived from a
 * measurement of this tree, and the summary line prints the current margin on
 * every green run so the measurement can be repeated by looking at it.
 */
const LIMIT = 40

/**
 * The longest run of consecutive lines that appears twice, disjointly, in one
 * file.
 *
 * Positions are grouped by line first, so only pairs that agree on their first
 * line are ever extended. Two prunings keep that from degenerating on a file
 * full of blank lines:
 *
 * A pair whose preceding lines also match is skipped, because the pair one line
 * earlier is in this same sweep and describes a run at least one line longer.
 * Only the start of a maximal run is extended.
 *
 * A run is capped at the gap between the two occurrences, so the two blocks
 * reported never overlap. Forty one identical lines in a row are a run of forty
 * followed by a run of forty starting one line later, and reporting that as
 * "forty lines, twice" is true but says the wrong thing about where to look.
 */
function longestRepeatedRun(lines) {
  const positionsOf = new Map()
  for (let i = 0; i < lines.length; i++) {
    const seen = positionsOf.get(lines[i])
    if (seen) seen.push(i)
    else positionsOf.set(lines[i], [i])
  }

  let longest = 0
  let first = 0
  let second = 0
  for (const positions of positionsOf.values()) {
    if (positions.length < 2) continue
    for (let a = 0; a < positions.length; a++) {
      const i = positions[a]
      for (let b = a + 1; b < positions.length; b++) {
        const j = positions[b]
        if (i > 0 && lines[i - 1] === lines[j - 1]) continue
        const limit = Math.min(j - i, lines.length - j)
        let run = 0
        while (run < limit && lines[i + run] === lines[j + run]) run++
        if (run > longest) {
          longest = run
          first = i
          second = j
        }
      }
    }
  }
  return { longest, first: first + 1, second: second + 1 }
}

const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((file) => extname(file).toLowerCase() === '.md')

const runs = []
for (const file of files) {
  let text
  try {
    text = readFileSync(join(ROOT, file), 'utf8')
  } catch {
    // Tracked but not present: a partial checkout, or a file being deleted in
    // this very commit. Not this check's business either way.
    continue
  }
  runs.push({ file, ...longestRepeatedRun(text.split(/\r?\n/)) })
}

runs.sort((a, b) => b.longest - a.longest)
const offenders = runs.filter((run) => run.longest >= LIMIT)

if (offenders.length > 0) {
  console.error(
    `${offenders.length} tracked markdown file${offenders.length === 1 ? '' : 's'} ${offenders.length === 1 ? 'holds' : 'hold'} a long run of ${offenders.length === 1 ? 'its' : 'their'} own lines twice:\n`,
  )
  for (const { file, longest, first, second } of offenders) {
    console.error(`  ${file}`)
    console.error(`    ${longest} consecutive lines appear at line ${first} and again at line ${second}`)
  }
  console.error(`
A block that long does not repeat itself by coincidence. It is a section that
was pasted, or a file that was written over itself by a sweep that appended
where it meant to replace. \`docs/process/verified.md\` held its own body three
times over for two days in September 2026, from a pull request whose diff was
+3688 and whose description said it was a sweep, and nothing in the review or
the gate was looking.

To see it yourself, where <n> is the first line number above:

  sed -n '<n>,+40p' <file>

and compare it with the same forty lines at the second number. If the two are
the same text, delete one of them. If they only look the same, the repetition
is real and deliberate, and the fix is to say so: raise LIMIT in
scripts/check-duplication.mjs with the measurement attached, the way the comment
at the top of that file does, so the next person can tell whether the number is
making room or giving up.

This reads one file at a time and only \`.md\`, so it says nothing about a page
pasted into a second page, and one edited word inside a pasted block hides the
whole of it. It is deliberately blind to anything under ${LIMIT} lines.
`)
  process.exit(1)
}

const worst = runs[0]
console.log(
  `${files.length} markdown files scanned, none repeating ${LIMIT} or more consecutive lines of itself. ` +
    (worst && worst.longest > 0
      ? `The longest run one file holds twice is ${worst.longest} line${worst.longest === 1 ? '' : 's'}, in ${worst.file} at lines ${worst.first} and ${worst.second}.`
      : `No file repeats a single line of itself.`),
)
