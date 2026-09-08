// Fail when a record says it acted on another record's `Revisit when` list and
// that other record does not name it back.
//
// WHAT THIS PREVENTS
// A sweep of all 331 revisit conditions on 2026-09-08 found five that had fired
// with nothing on the record saying so. Three of the five were the same shape:
// a later record answered an earlier one's condition, said so in its own text,
// and the earlier record never gained a line pointing at the answer. So the
// earlier record's list still read as open work, and the next sweep read it as
// open work again. That is the cost: not a broken link, but a condition that
// keeps being re-judged as unfinished after it is finished.
//
// ONE-WAY CITATION IS NORMAL AND IS NOT WHAT THIS IS ABOUT
// A record is history. It cites what came before it, and an earlier record has
// no reason to grow a link every time a later one leans on it. Measured on
// `main` at c5e95a5, counting only the lineage a record declares in the lines
// above its first `##` heading: 27 declarations, of which 20 are never named
// back, and the sweep judged 19 of the 20 harmless. This check is deliberately
// blind to all 19.
//
// That count and the three cases below are different questions about the same
// directory and the numbers do not line up, which is worth saying because it
// looks like an error. Only one of the three, 0092 declaring 0083, is inside the
// 27; 0076 names 0069 in its Context and 0082 has no preamble at all. And the
// gap runs the other way: the one harmful pair inside the 27 is 0092 to 0083,
// which is exactly the case this check cannot see.
//
// HOW NARROW THIS IS, AND IT IS VERY NARROW
// It reads one line at a time and asks two questions: does the line use the
// words "revisit entry" or "revisit condition", and does it name another record
// on the same line. Both, and the named record has to name this one somewhere.
//
// That catches a record which says in those words that it is acting on another
// record's list. It does not catch a record that answers a condition without
// using those words, and that is most of them. Of the three findings above it
// sees one:
//
//   0076 -> 0069  "This answers ADR 0069's first revisit entry"     seen
//   0092 -> 0083  "Answers a condition ADR 0083 wrote down for itself"  not seen
//   0082 -> 0058  "ADR 0058's own list came closer and still missed"    not seen
//
// The summary line says this on every green run, for the reason
// `check-duplication.mjs` prints its current margin: a check whose reach nobody
// can see is a check people credit for more than it does.
//
// WHAT WAS MEASURED AND REJECTED
// All three numbers below were measured against `main` at c5e95a5, before the
// sections that answer the five conditions were appended. On that tree this
// rule sees 5 occurrences and reports 1, which is the 0076 line above.
//
// Widening the phrase set to include "revisit when" takes it to 8 and 2, and the
// second finding is wrong: ADR 0063's own list points at ADR 0006's list as
// context for a decision that has not been taken, which is not a claim to have
// answered anything, so ADR 0006 owes it no link.
//
// Widening the scope from a line to a paragraph takes it to 17 and 12. Almost
// all of the 12 are a record's own `Revisit when` bullet naming other records as
// context. Same defect as the one above, one order of magnitude louder.
//
// So: a line, and those two phrases. It is a small net in a place where a small
// net catches something.
//
// A fenced block and a blockquote are skipped, and ADR 0096 is why: the first
// run of this file over a tree holding that record refused it, because it quotes
// all three of the sentences above. A record quoting somebody else's sentence is
// not making a claim of its own. Skipping those two costs nothing on today's
// tree, where every occurrence is ordinary prose.
//
// WHY THIS SCANS `docs/architecture/decisions/` WHEN `check-commands.mjs` WILL NOT
// The two guards make opposite choices about one directory and both are right,
// because they ask opposite questions of it. `check-commands.mjs` fails a page
// that names something which no longer exists, and a record says what was true
// when it was decided, so pointing that check here would fail a build until an
// author edited history. This check never asks a record to change a word it
// wrote. It asks the *other* record to append a line saying it was answered,
// which is what `docs/architecture/decisions/README.md` already tells everybody
// to do: superseded records stay, and the correction is appended.
//
//   node scripts/check-adr-backlinks.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'architecture', 'decisions')
const NAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/

/**
 * The words that make a sentence a claim about somebody else's list.
 *
 * "Revisit when" is the heading and is left out on purpose; see the header.
 */
const CLAIM = /revisit (?:entry|entries|condition|conditions)/i

/**
 * A record reference, as this repository writes them: `ADR 0069`, a bare `0069`,
 * or the number inside a link like `[ADR 0069](0069-a-count-....md)`.
 *
 * A four digit number that is not a record on disk is not a reference, which is
 * what keeps years and measurements out of the results without a list of
 * exceptions to maintain.
 */
const REFERENCE = /\b(?:ADR\s+)?(\d{4})\b/g

const records = new Map()
const badly = []

for (const file of readdirSync(DIR).sort()) {
  if (!file.endsWith('.md') || file === 'README.md') continue
  const match = NAME.exec(file)
  // `check-adr-numbers.mjs` owns the naming rule and says so loudly. Skipping
  // here rather than failing keeps one message for one problem.
  if (!match) {
    badly.push(file)
    continue
  }
  records.set(match[1], { file, text: readFileSync(join(DIR, file), 'utf8') })
}

/** Whether `record` names `number` anywhere in its text. */
function names(record, number) {
  return new RegExp(`\\b${number}\\b`).test(record.text)
}

const findings = []
let claims = 0

for (const [number, record] of records) {
  const lines = record.text.split(/\r?\n/)
  let fenced = false
  lines.forEach((line, index) => {
    // A fenced block and a blockquote are somebody else's words: a record
    // quoting the entry it is answering, or the sentence a command printed.
    // This check's first finished run refused ADR 0096, which quotes all three
    // of the sentences it was built from, and it was right on the rule as
    // written and wrong on the question being asked. A quotation is not a claim.
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      return
    }
    if (fenced || /^\s*>/.test(line)) return
    if (!CLAIM.test(line)) return
    const named = new Set(
      [...line.matchAll(REFERENCE)].map((m) => m[1]).filter((n) => n !== number && records.has(n)),
    )
    for (const target of named) {
      claims += 1
      const other = records.get(target)
      if (names(other, number)) continue
      findings.push({ number, record, line: index + 1, text: line.trim(), target, other })
    }
  })
}

if (findings.length > 0) {
  console.error(
    `${findings.length} record${findings.length === 1 ? '' : 's'} act${findings.length === 1 ? 's' : ''} on another record's revisit list without being named back:\n`,
  )
  for (const finding of findings) {
    console.error(`  ${finding.record.file}:${finding.line}`)
    console.error(`    ${finding.text}`)
    console.error(
      `    ${finding.other.file} never names ${finding.number}, so its condition still reads as open.\n`,
    )
  }
  console.error(
    'Append a section to the record that was answered, saying the condition fired,\n' +
      'what fired it, and what that means for the decision. Append rather than edit:\n' +
      'docs/architecture/decisions/README.md is why, and the sections already in\n' +
      'records 0013, 0015 and 0071 are the shape to copy. Do not restate the\n' +
      "answering record's argument; a pointer and what it means is the whole job.\n\n" +
      'If the sentence above is not a claim to have answered that condition, the\n' +
      'sentence is what to change. This check reads one line at a time and skips\n' +
      'fenced blocks and blockquotes, so a quotation belongs in a fence and a\n' +
      'reference that only mentions another list belongs on a line of its own.',
  )
  process.exit(1)
}

if (badly.length > 0) {
  console.error(`Not read, because the name carries no number: ${badly.join(', ')}`)
  console.error('node scripts/check-adr-numbers.mjs is the check that owns this.')
  process.exit(1)
}

console.log(
  `${records.size} decision records read, ${claims} sentence${claims === 1 ? '' : 's'} ` +
    `claim${claims === 1 ? 's' : ''} to act on another record's revisit list, and every one is named back. ` +
    'It reads one line at a time for the words "revisit entry" and "revisit condition", ' +
    'so a record that answers a condition without saying so in those words is invisible to it, ' +
    'and most of them do not say so.',
)
