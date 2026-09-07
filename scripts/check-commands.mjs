// Fail when something in this repository names a command that does not exist.
//
// WHAT THIS PREVENTS
// `dbmd query` was named by four error messages in `src/import/contract.ts`, by
// the opening line of `docs/import-format.md`, by ADR 0007 and by `AGENTS.md`.
// It did not exist. The CLI rejected it as an unknown command, and the tool's
// headline feature could not be run end to end.
//
// It survived because every reference agreed with every other one. There was
// nothing inconsistent to notice, so noticing needed somebody to type the
// command, and everybody who wrote about it had read the same page rather than
// run it. It was found weeks late and by accident.
//
// A hand sweep on 2026-09-07 found it was the only one. This is that sweep,
// repeated on every run, over three kinds of reference:
//
//   `dbmd <command>`        against the CLI's registered commands
//   `npm run <script>`      against `package.json`
//   `node scripts/<file>`   against the filesystem
//
// WHY IT READS BACKTICKS AND NOT PROSE
// The obvious check parses prose for anything shaped like a command, and the
// obvious check does not work: the hand sweep matched dbmd describes, dbmd
// reads and dbmd can. Telling a command from a verb by looking at the verb is a
// losing game. Those three are written here without backticks, which is the
// convention doing its own explaining: they are prose, so they are not claims,
// so this file does not fail on its own header.
//
// So this is inverted. It does not ask "is this prose about a command"; it asks
// "is this thing the author marked as code a command that exists". A backtick
// is a claim the author already makes on purpose, everywhere in this tree, and
// there was nothing false in it: every backticked `dbmd <word>` on `main` is a
// real command or a marked hypothetical. Prose is left alone entirely, which is
// why this costs a writer nothing until they mean a command.
//
// WHY A HYPOTHETICAL NEEDS A MARKER
// "A future `dbmd fmt` will want this" is correct and must not fail a build.
// The marker is written by the author, beside the sentence:
//
//   <!-- hypothetical: dbmd fmt -->
//
// Inferring it instead, from nearby words like "future" or "would", was
// rejected: it guesses at intent, and the day it guesses wrong it either fails
// a correct page or waves through the defect this exists to catch. ADR 0036.
//
// WHY DECISION RECORDS ARE NOT SCANNED
// A record says what was true when it was decided, and this repository never
// edits one. Failing a build over a record naming something since renamed would
// be asking an author to falsify history. `docs/architecture/decisions/` is
// excluded, deliberately and in one place, rather than quietly.
//
//   node scripts/check-commands.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// What exists
// ---------------------------------------------------------------------------

/**
 * The CLI's commands, read from the registry rather than listed here.
 *
 * A second copy of the list in this file would be one more fact that can
 * silently disagree with the truth, which is the whole defect this script is
 * about. `src/cli/main.ts` names the `Command` values it dispatches on, each
 * one lives in its own module, and the word a user types is that module's
 * `name`. Reading the source rather than the build is what lets this run before
 * `npm run build`, beside the other checks.
 */
function cliCommands() {
  const main = read('src/cli/main.ts')
  const registry = /const COMMANDS: readonly Command\[\] = \[([^\]]*)\]/.exec(main)
  if (!registry) throw new Error('src/cli/main.ts has no COMMANDS array to read')

  const identifiers = registry[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (identifiers.length === 0) throw new Error('the COMMANDS array in src/cli/main.ts is empty')
  for (const identifier of identifiers) {
    if (!/^[A-Za-z_$][\w$]*$/.test(identifier)) {
      throw new Error(`the COMMANDS array in src/cli/main.ts holds "${identifier}", not a name`)
    }
  }

  const names = new Set()
  for (const identifier of identifiers) {
    const imported = new RegExp(
      `import\\s*\\{\\s*${identifier}\\s*\\}\\s*from\\s*'\\./([\\w.-]+)\\.js'`,
    )
    const module = imported.exec(main)
    if (!module) {
      throw new Error(`src/cli/main.ts dispatches on ${identifier} but does not import it`)
    }
    const declared = new RegExp(`export const ${identifier}: Command = \\{\\s*name: '([^']+)'`)
    const name = declared.exec(read(`src/cli/${module[1]}.ts`))
    if (!name) throw new Error(`src/cli/${module[1]}.ts declares no name for ${identifier}`)
    names.add(name[1])
  }
  return names
}

/** The scripts `npm run` will find. */
function npmScripts() {
  return new Set(Object.keys(JSON.parse(read('package.json')).scripts ?? {}))
}

function read(relative) {
  return readFileSync(join(ROOT, relative), 'utf8')
}

// ---------------------------------------------------------------------------
// What is named
// ---------------------------------------------------------------------------

/**
 * Files whose backticks mean code. Markdown, and the source whose comments and
 * error messages tell somebody what to run: four of the seven places that named
 * `dbmd query` were error strings in `src/import/contract.ts`, so a check that
 * read only the documentation would have missed most of it.
 */
const SCANNED = new Set(['.md', '.ts', '.mjs'])

/**
 * Excluded, each for a reason rather than because it was noisy.
 *
 * `docs/architecture/decisions/` is history and is never edited; see the header.
 *
 * `.beads/` is the backlog, where naming a command that does not exist yet is
 * what an item is for.
 *
 * `test/guards/` is the one directory whose contents are wrong on purpose. It
 * holds this check's own fixtures: a page naming a command that does not exist,
 * an npm script that is not in the manifest, a marker for a command that is.
 * Each of those is a case this refuses, so scanning them is asking the check to
 * fail on the evidence that it works. `guard-merge.mjs` shipped with the same
 * false positive and it fired within seconds. Writing about the thing is not
 * doing the thing.
 */
const EXCLUDED = ['docs/architecture/decisions/', '.beads/', 'test/guards/']

function scannedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((file) => SCANNED.has(extname(file)))
    .filter((file) => !EXCLUDED.some((prefix) => file.startsWith(prefix)))
}

/**
 * The reference shapes, and what each one resolves against.
 *
 * `npx dbmd`, `npx --yes dbmd@0.1.0` and `node dist/cli.js` are the same claim
 * about the same command list written three other ways, and all three are in
 * this tree. A check that understood only the bare word would pass a README
 * telling a first-time user to run something that is not there.
 *
 * Only the bare word is `anchored`, and that is the one ambiguity worth
 * spending a rule on: `dbmd` is also the name of this project, so "of dbmd
 * reads version 1" appears inside a fenced block of example output. Requiring
 * the bare form to begin the code settles it without guessing at the word after
 * it. Every other shape names a runner, nobody writes `npm run` or `npx dbmd`
 * by accident, and those are read wherever they appear.
 */
const REFERENCES = [
  {
    kind: 'dbmd command',
    pattern: /dbmd\s+([a-z][a-z0-9-]*)/g,
    anchored: true,
    named: (word) => `dbmd ${word}`,
  },
  {
    kind: 'dbmd command',
    pattern: /npx\s+(?:-{1,2}[\w-]+\s+)*dbmd(?:@[\w.^~-]+)?\s+([a-z][a-z0-9-]*)/g,
    anchored: false,
    named: (word) => `dbmd ${word}`,
  },
  {
    kind: 'dbmd command',
    pattern: /dbmd@[\w.^~-]+\s+([a-z][a-z0-9-]*)/g,
    anchored: false,
    named: (word) => `dbmd ${word}`,
  },
  {
    kind: 'dbmd command',
    pattern: /node\s+dist\/cli\.js\s+([a-z][a-z0-9-]*)/g,
    anchored: false,
    named: (word) => `dbmd ${word}`,
  },
  {
    kind: 'npm script',
    pattern: /npm\s+run\s+([a-z][a-z0-9:_-]*)/g,
    anchored: false,
    named: (word) => `npm run ${word}`,
  },
  {
    kind: 'script file',
    pattern: /node\s+(scripts\/[\w.-]+)/g,
    anchored: false,
    named: (path) => `node ${path}`,
  },
]

/**
 * The marker, which is the word and the reference and nothing else, so that a
 * markdown author writes `<!-- hypothetical: dbmd fmt -->` and a TypeScript
 * author writes `// hypothetical: dbmd fmt` and both are the same convention.
 * The reference itself ends the match, so whatever closes the comment is not
 * this pattern's business.
 */
const MARKER =
  /hypothetical:\s*(dbmd\s+[a-z][a-z0-9-]*|npm\s+run\s+[a-z][a-z0-9:_-]*|node\s+scripts\/[\w.-]+)/g

/** A shell prompt, which is punctuation in front of the command and not code. */
const PROMPT = /^\s*(?:[$>]\s+)?/

/**
 * Every reference in one file, with the line it is on.
 *
 * A reference counts where code begins: straight after a backtick that opens an
 * inline span, or at the start of a line inside a fenced block, where the line
 * is code already. A fenced block is not always a shell, and this repository
 * has one holding a `.prettierignore` whose comment begins "# dbmd model files"
 * and one holding example output that says "this build of dbmd reads version
 * 1". Neither is a command and neither begins a line of code.
 */
function referencesIn(file, text) {
  const markdown = extname(file) === '.md'
  const found = []
  let fenced = false

  text.split(/\r?\n/).forEach((line, index) => {
    if (markdown && /^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced
      return
    }
    const segments = codeSpans(line)
    if (fenced) segments.push(line.replace(PROMPT, ''))
    for (const segment of segments) {
      for (const { kind, pattern, anchored, named } of REFERENCES) {
        for (const match of segment.matchAll(pattern)) {
          if (anchored && match.index !== 0) continue
          found.push({ kind, named: named(match[1]), line: index + 1 })
        }
      }
    }
  })
  return found
}

/**
 * What the backticks on this line delimit.
 *
 * Every backtick both closes the span before it and opens the one after it,
 * which is not what markdown means and is what makes this work on a template
 * literal as well as on a paragraph. In `src/import/contract.ts` the four
 * references that started this live inside a template literal, written `\``,
 * and pairing the outer backticks would put every one of them between spans
 * rather than in one. Reading each backtick as a delimiter puts each reference
 * at the start of its own segment, which is exactly where it is.
 */
function codeSpans(line) {
  const spans = []
  let start = -1
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '`') continue
    if (start !== -1) spans.push(line.slice(start, i))
    start = i + 1
  }
  if (start !== -1) spans.push(line.slice(start))
  return spans
}

/** What this file declares does not exist yet, and the line it said so on. */
function markersIn(text) {
  const declared = new Map()
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(MARKER)) {
      const named = match[1].replace(/\s+/g, ' ')
      if (!declared.has(named)) declared.set(named, index + 1)
    }
  })
  return declared
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

const commands = cliCommands()
const scripts = npmScripts()

function kindOf(named) {
  if (named.startsWith('npm run ')) return 'npm script'
  if (named.startsWith('node ')) return 'script file'
  return 'dbmd command'
}

function resolves(named) {
  const kind = kindOf(named)
  if (kind === 'npm script') return scripts.has(named.slice('npm run '.length))
  if (kind === 'script file') return existsSync(join(ROOT, named.slice('node '.length)))
  return commands.has(named.slice('dbmd '.length))
}

function describe(kind) {
  if (kind === 'npm script') return 'a script in package.json'
  if (kind === 'script file') return 'a file in scripts/'
  return `a dbmd command. There are ${[...commands].join(', ')}`
}

const files = scannedFiles()
const problems = []

for (const file of files) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  const markers = markersIn(text)
  const excused = new Set()
  const reported = new Set()

  for (const { kind, named, line } of referencesIn(file, text)) {
    if (resolves(named)) continue
    // A line inside a fence is read both as code and as its spans, and the
    // shapes overlap, so the same reference can be found more than once. Where
    // it is wrong is a line, not an offset, so one report per line is the
    // whole of what a reader needs.
    if (reported.has(`${line} ${named}`)) continue
    reported.add(`${line} ${named}`)
    if (markers.has(named)) {
      excused.add(named)
      continue
    }
    problems.push({ file, line, text: `\`${named}\` is not ${describe(kind)}` })
  }

  // A marker is checked too, so that it cannot outlive what it excused. Both
  // halves matter: one fails on the day the command is written, which is the
  // day the sentence around it needs rereading, and the other fails when the
  // sentence goes and the marker stays.
  for (const [named, line] of markers) {
    if (resolves(named)) {
      problems.push({
        file,
        line,
        text: `the marker for \`${named}\` is stale: it exists now, so delete the marker`,
      })
    } else if (!excused.has(named)) {
      problems.push({
        file,
        line,
        text: `the marker for \`${named}\` excuses nothing in this file`,
      })
    }
  }
}

if (problems.length > 0) {
  console.error(
    `${problems.length} reference${problems.length === 1 ? '' : 's'} to a command that does not exist:\n`,
  )
  for (const { file, line, text } of problems) {
    console.error(`  ${file}:${line}`)
    console.error(`    ${text}`)
  }
  console.error(`
A name inside backticks is read as a real one, because that is what a backtick
claims. \`dbmd query\` was named by four error messages, a documentation page, a
decision record and AGENTS.md before it existed, and every one of them agreed
with every other, so there was nothing inconsistent to notice.

If you meant something that does not exist yet, say so where you wrote it, on
its own line or at the end of one:

    <!-- hypothetical: dbmd fmt -->

The marker holds for the file it is written in and has to name the reference
exactly. It fails once the thing exists, so the sentence around it gets read
again on the day it stops being hypothetical. ADR 0036.
`)
  process.exit(1)
}

console.log(
  `${files.length} files scanned, every \`dbmd\`, \`npm run\` and \`scripts/\` reference resolves.`,
)
