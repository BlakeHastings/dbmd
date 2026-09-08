// Fail when something in this repository names a command or a flag that does
// not exist, and when a command that exists is not documented in `README.md`.
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
// repeated on every run, over five kinds of reference:
//
//   `dbmd <command>`        against the CLI's registered commands
//   `dbmd <command> --flag`  against that command's own options table
//   `npm run <script>`      against `package.json`
//   `node scripts/<file>`   against the filesystem
//   `scripts/<file>`        against the filesystem
//
// The second one arrived last and closed a hole the first four left wide open:
// a flag was never read at all, so `dbmd check --deep` passed on three pages.
// "WHY A FLAG IS A REFERENCE TOO" below is the whole of that argument.
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
// WHY A BARE PATH INTO scripts/ IS READ, AND ONLY INTO scripts/
// The fourth shape reads a path where the other three read an invocation, and
// it is here from evidence rather than from symmetry. guard-merge.mjs named a
// sibling test in a comment, as the thing that caught drift between the copies
// of its command reader, and that file exists only in the repository the guard
// is installed from. Nobody was being told to run it, so no runner appeared in
// front of it, so the three shapes above walked past a comment claiming a
// safety net that was not there. ADR 0059 is what came of reading it.
//
// It stops at scripts/, and that boundary was measured rather than guessed. The
// wide version, every backticked repo-relative path, found six references: that
// one defect and five correct sentences, one of which names a file precisely in
// order to say the file is gone. Naming a thing is the honest way to record
// that it was deleted, so a rule demanding every backticked path resolve would
// buy one defect at the price of pushing writers towards vaguer history. A path
// into scripts/ is a claim about something runnable now, which is the claim the
// other three shapes already make, and that is where this stops.
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
// WHY A FLAG IS A REFERENCE TOO
// Everything above resolved a name and stopped at the first space after it. A
// flag written beside that name is the same claim in the same backticks and
// nothing read it, so three pages said `dbmd check --deep` and three passed.
// The sharpest of them is docs/ci.md, which is the workflow this project hands
// a stranger to paste into their own repository: that line would exit 2 in
// their CI and nothing here would have said so.
//
// The summary line this used to print was honest about it. It promised that
// every reference resolves, and a flag was not a reference. Closing the gap is
// what lets that sentence say more, and the sentence at the bottom of this file
// moved with the rule rather than after it.
//
// WHICH LIST OF FLAGS IS THE TRUTH, AND WHY IT IS BOTH
// There are two lists per command and they are written by hand, in the same
// file, a hundred lines apart. The `Options:` block inside the command's `help`
// is what a person reads. The options table it hands `parseArgs` is what the
// program accepts. Reading only the help would fail a correct command line the
// day a flag works and is undocumented, and a guard with false positives gets
// deleted. Reading only the table would let that documentation gap live
// forever, unnoticed, which is the shape of every defect this file already
// exists for.
//
// So the table is the authority on what a command takes, and the help is
// checked against it. They agree today, all seven commands, which was measured
// before choosing rather than assumed. Two hand-written lists of one fact that
// can silently disagree is the defect in `dbmd query`, in the README count and
// in the version pins, three times over in this one file, and the answer each
// time was to make the disagreement loud. ADR 0089.
//
// It also buys the loud failure a source-reading check has to have. A parse
// that finds nothing reports success, and this repository has a section of
// orchestrating.md about exactly that. If the options table moves out from
// under the regex below, the help still says `--strict` and the command now
// takes nothing, so the two disagree and the build stops. A check that read one
// list would have gone quiet instead.
//
// WHICH TOKENS ON A LINE ARE dbmd'S
// The ones after the command word and before anything that ends the command.
// `npx --yes dbmd check db-model --deep` has two flags on it and only one
// of them is dbmd's: --yes sits in front of the package name and belongs to
// npx, and it falls out for free because the reference shapes already match
// from the runner through the command word, so reading what is left after the
// match is reading what the command was given.
//
// After that it is deliberately conservative, because a token this cannot
// classify is left alone rather than reported. A bare `--` ends the flags, the
// way it does for `takeGlobalFlags`. A shell operator ends the command line, so
// `dbmd check 2>/dev/null` stops at the redirect. The value of a string option
// is skipped using the option's own declared type, so `--engine postgres` reads
// as one flag and `--port -1` does not report a flag called -1. What is read is
// `--name`, `--name=value` on the name half, and a one-letter short, with
// surrounding brackets and trailing punctuation trimmed so that a synopsis
// written `dbmd check [directory] [--strict]` is read as the claim it is.
//
// Prose is not a command line, and the answer is the one this file already
// gave: a flag is read only where a command was read, which is a code span or a
// fenced line that a dbmd invocation begins. The tree is full of sentences with
// `--strict` in backticks on their own and none of them is a command line, so
// none of them is scanned. The three real cases are a fenced `$ dbmd check
// examples/shop --deep`, a YAML `- run: npx --yes dbmd check db-model
// --deep`, and a fenced `dbmd check --deep`, and all three are a command with a
// flag after it.
//
// A flag is only checked where the command resolves. `dbmd fmt --deep` has one
// finding in it and it is `dbmd fmt`; naming a second one about the flags of a
// command that does not exist is noise in front of the answer.
//
// WHY THE GLOBAL FLAGS ARE READ FROM main.ts
// `--json`, `--no-color`, `--help` and `-h` are valid after every command and
// appear in no command's own list, because `src/cli/main.ts` takes them out of
// the argument list before the command ever sees them. A copy of those four
// here would be a fourth hand-written list of one fact, which is the thing this
// file is about, so they are read from the two places in that file that
// implement them. `--version` is deliberately not among them: it is read only
// as the first token, so "dbmd check --version" is not a thing, and writing it
// here in quotes rather than in backticks is this file obeying its own new
// rule on the first line that could have broken it.
//
// WHY A VERSION AFTER dbmd@ IS READ, AND WHAT IT IS READ AGAINST
// docs/ci.md hands a reader a workflow to copy and pins the version in it,
// because npx dbmd@latest in somebody else's CI is a supply chain decision made
// by accident. ADR 0028 settled that and it is not in question here. What was
// missing is that the pin is a copy of the number in package.json, there were
// four of them, and nothing made any of them agree with it. They all said the
// same number because that is what the package was, so there was nothing
// inconsistent to grep for, which is the shape of dbmd query above.
//
// The rule is one sentence: a version after dbmd@ names the version in
// package.json. It reads the version and not the shape around it, because the
// four are written three ways. Two are inside a YAML block a reader copies. One
// is a sentence about that block with no command after it at all, so a rule
// built out of the command shapes above would read three of the four. One is in
// README.md about a different command entirely.
//
// A dist-tag is not a version and is not read. npx dbmd@latest is written in
// this tree exactly once, in the paragraph of docs/ci.md that exists to say not
// to, and there is nothing in package.json for a moving tag to equal. The cost
// is a real hole and it is worth knowing about: this would not notice @latest
// arriving in the recipe. Telling that apart from the sentence warning against
// it needs a marker, and one page writing one word is not yet worth one.
//
// This says nothing about whether the version is on the registry, and it
// cannot. The package was unpublished when this was written, so a check that
// asked npm would have been red on the owner's first push. npm view dbmd
// versions is the authority on what exists and both pages already send a reader
// there. What this holds is that the pages name the version this repository is
// rather than the version it used to be. ADR 0080.
//
// A version in prose is left alone, because only a pin is a claim about what to
// install. "0.1.0 is the number chosen for the first release" stays true after
// the second release, and a rule that read every number would demand that
// sentence be falsified.
//
// WHY DECISION RECORDS ARE NOT SCANNED
// A record says what was true when it was decided, and this repository never
// edits one. Failing a build over a record naming something since renamed would
// be asking an author to falsify history. `docs/architecture/decisions/` is
// excluded, deliberately and in one place, rather than quietly.
//
// THE OTHER DIRECTION, AND WHY IT IS NOT A SECOND SCRIPT
// Everything above fails a name that has no command. Nothing failed a command
// that has no name, and that went wrong twice in one day. `dbmd import` shipped
// and left `README.md` saying the import path was unfinished. `dbmd query`
// shipped and left a heading reading "The five commands" over five entries
// while the CLI had six, and a sentence still calling the thing it had just
// built open work. Both passed every check in the gate, and both were found by
// an agent who had come to do something else.
//
// So the registry is read once, here, and asked both questions. A second script
// would work out the command list a second way, and two lists of one fact that
// can disagree is the whole defect this file is about.
//
// WHY THE HEADING STOPPED COUNTING
// The count in "The seven commands" is the half that actually broke, and a
// check that reads a heading and counts the entries under it is a check whose
// job a rewrite removes. The heading is "The commands" now, and it cannot go
// stale. What is left is the half worth checking mechanically rather than
// rewriting away: every command has an entry, and the entry is what a reader
// was sent there for.
//
// WHY `README.md` AND NOTHING ELSE
// It is the only file that promises to document them all, one bolded entry per
// command in the order a person meets them. `AGENTS.md` names them in a
// sentence and `docs/ci.md` names two of them on purpose, and requiring an
// entry in either would be asking for prose nobody wants. `AGENTS.md` carries a
// count as well, and it has been right through five commands arriving, because
// its count and its list are one sentence. The README heading counted entries
// two hundred lines below it. Distance is what went stale. ADR 0043.
//
// The hypothetical marker needs no special case here. A command that exists is
// not hypothetical, and the marker rule below already fails on the day one
// becomes real, so the two never meet.
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
 * The CLI's commands, read from the registry rather than listed here, each one
 * against the file that declares it.
 *
 * A second copy of the list in this file would be one more fact that can
 * silently disagree with the truth, which is the whole defect this script is
 * about. `src/cli/main.ts` names the `Command` values it dispatches on, each
 * one lives in its own module, and the word a user types is that module's
 * `name`. Reading the source rather than the build is what lets this run before
 * `npm run build`, beside the other checks.
 *
 * The module travels with the name because the flags are in it, and looking it
 * up a second way further down would be the same duplication one level in.
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

  const named = new Map()
  for (const identifier of identifiers) {
    const imported = new RegExp(
      `import\\s*\\{\\s*${identifier}\\s*\\}\\s*from\\s*'\\./([\\w.-]+)\\.js'`,
    )
    const module = imported.exec(main)
    if (!module) {
      throw new Error(`src/cli/main.ts dispatches on ${identifier} but does not import it`)
    }
    const file = `src/cli/${module[1]}.ts`
    const declared = new RegExp(`export const ${identifier}: Command = \\{\\s*name: '([^']+)'`)
    const name = declared.exec(read(file))
    if (!name) throw new Error(`${file} declares no name for ${identifier}`)
    named.set(name[1], file)
  }
  return named
}

/**
 * The options table a command hands `parseArgs`, as a map of flag to type.
 *
 * This is the authority on what a command accepts, because it is the thing the
 * program runs. See the header for why the help block is read as well and what
 * that second read is worth.
 *
 * A command that never calls `parseArgs` takes no flags, which is a real shape
 * and not a shape that has moved. A command that calls it and has no table this
 * can read is the failure ADR 0034 is about, and it stops the build here rather
 * than reporting that every flag in the repository is fine.
 */
function commandFlags(file) {
  const source = read(file)
  const flags = new Map()
  if (!source.includes('parseArgs(')) return flags

  const table = /const options = (\{[\s\S]*?\}) as const/.exec(source)
  if (!table) {
    throw new Error(
      `${file} calls parseArgs and has no "const options = { ... } as const" to read it from`,
    )
  }
  for (const [, name, type] of table[1].matchAll(
    /(?:^|[{,\s])'?([a-z][\w-]*)'?\s*:\s*\{\s*type:\s*'(string|boolean)'/g,
  )) {
    flags.set(`--${name}`, type)
  }
  // The table is read by shape, so a key spelled some way this does not know is
  // a flag that would silently stop being checked. Counting the declarations
  // the other way round says so instead.
  const declared = [...table[1].matchAll(/type:\s*'(?:string|boolean)'/g)].length
  if (declared !== flags.size) {
    throw new Error(
      `${file} declares ${declared} options and only ${flags.size} of them could be named`,
    )
  }
  return flags
}

/**
 * The flags the command's own `--help` lists, which is what a person reads.
 *
 * The block is the one `Options:` in the `help` template, and it runs to the
 * blank line under it, the way all seven are written. A command with no flags
 * has no block, which is `dbmd init`.
 *
 * A flag counts where it begins its own line, under the indent, which is where
 * all seventeen of them are. A flag named inside the sentence that describes
 * another one is that sentence's business, and reading those would make an
 * entry that mentions --strict in passing look like a second entry.
 */
function helpFlags(file) {
  const source = read(file)
  const block = /\nOptions:\n((?:[^\n]*\n)*?)\n/.exec(source)
  if (!block) return new Set()
  return new Set([...block[1].matchAll(/^\s+(--[a-z][a-z0-9-]*)/gm)].map((match) => match[1]))
}

/**
 * The flags every command takes because no command sees them: `src/cli/main.ts`
 * strips them before dispatching.
 *
 * Read from the two places in that file that implement them rather than copied
 * here. `takeGlobalFlags` compares tokens to decide what to pull out, and
 * `dispatch` asks what is left whether it wants help. Both are asserted to find
 * something, because a copy of this list that quietly emptied would make every
 * `dbmd check --json` in the tree a finding, which is the false-positive
 * failure that gets a guard deleted rather than fixed.
 */
function globalFlags() {
  const main = read('src/cli/main.ts')
  const stripped = [...main.matchAll(/token === '(--[a-z][a-z0-9-]*)'/g)].map((match) => match[1])
  const asked = [...main.matchAll(/rest\.includes\('(-{1,2}[a-zA-Z][a-z0-9-]*)'\)/g)].map(
    (match) => match[1],
  )
  if (stripped.length === 0) {
    throw new Error('src/cli/main.ts strips no global flag this could read')
  }
  if (asked.length === 0) {
    throw new Error('src/cli/main.ts reads no help flag out of what it hands a command')
  }
  return new Set([...stripped, ...asked])
}

/** The scripts `npm run` will find. */
function npmScripts() {
  return new Set(Object.keys(JSON.parse(read('package.json')).scripts ?? {}))
}

/**
 * The version this package is, which every pin has to name. See the header.
 *
 * A manifest with no version to compare against is an error rather than a skip.
 * A check that quietly has nothing to do is indistinguishable from one that
 * works, which is the whole subject of ADR 0034, and this one costs nothing.
 */
function packageVersion() {
  const { version } = JSON.parse(read('package.json'))
  if (typeof version !== 'string' || version === '') {
    throw new Error('package.json has no version, so a pin has nothing to name')
  }
  return version
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
 * Two shapes are `anchored`, each for its own ambiguity, and every shape that
 * names a runner is read wherever it appears: nobody writes `npm run` or
 * `npx dbmd` by accident.
 *
 * The bare word, because `dbmd` is also the name of this project, so example
 * output inside a fenced block says "this build of dbmd reads version 1".
 * Requiring the bare form to begin the code settles it without guessing at the
 * word after it.
 *
 * The bare path, because a template literal is a code span by the rule below,
 * and this repository's failure messages are paragraphs of prose written
 * inside one. `check-main-provenance.mjs` ends a sentence with "Add the case to
 * scripts/guard-merge.mjs." and the unanchored sweep read the full stop as part
 * of the filename and called it missing. That is the only false positive either
 * form produced across the tree, and requiring the path to begin the code
 * removes it without a second rule about punctuation: a path that starts a code
 * span is being pointed at, and a path in the middle of one is usually being
 * talked about.
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
  {
    kind: 'script file',
    pattern: /(scripts\/[\w.-]+)/g,
    anchored: true,
    named: (path) => path,
  },
]

/**
 * A pin, which is the version and not the command after it.
 *
 * Separate from the shapes above because it is a different question. Those ask
 * whether a name resolves to something that exists; this asks whether a number
 * is the number. The two `dbmd@` shapes above throw the version away and read
 * the word after it, and one of the four pins in this tree has no word after it
 * at all.
 *
 * The character class is the one those shapes use, plus `+` for build
 * metadata. Trailing punctuation falls outside it, so a fenced line ending a
 * sentence after a pin does not have the full stop read as part of the version.
 */
const PIN = /dbmd@([\w.^~+-]+)/g

/**
 * What a moving target looks like: letters, and no number to compare.
 *
 * `latest`, `next`, `beta`. See the header for why one is in this tree and
 * why it is skipped rather than failed.
 */
const DIST_TAG = /^[a-z][a-z0-9-]*$/

/**
 * The marker, which is the word and the reference and nothing else, so that a
 * markdown author writes `<!-- hypothetical: dbmd fmt -->` and a TypeScript
 * author writes `// hypothetical: dbmd fmt` and both are the same convention.
 * The reference itself ends the match, so whatever closes the comment is not
 * this pattern's business.
 *
 * A flag can be marked too, `hypothetical: dbmd check --deep`, because a page
 * describing a flag that is coming is the same sentence as a page describing a
 * command that is coming and a shape with no escape hatch is a shape people
 * work around. The `-->` that closes a markdown comment is not a flag, so an
 * existing marker reads exactly as it did.
 */
const MARKER =
  /hypothetical:\s*(dbmd\s+[a-z][a-z0-9-]*(?:\s+--[a-z][a-z0-9-]*)?|npm\s+run\s+[a-z][a-z0-9:_-]*|node\s+scripts\/[\w.-]+|scripts\/[\w.-]+)/g

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
function codeIn(file, text) {
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
    for (const segment of segments) found.push({ segment, line: index + 1 })
  })
  return found
}

function referencesIn(file, text) {
  const found = []
  for (const { segment, line } of codeIn(file, text)) {
    for (const { kind, pattern, anchored, named } of REFERENCES) {
      for (const match of segment.matchAll(pattern)) {
        if (anchored && match.index !== 0) continue
        const reference = { kind, named: named(match[1]), line }
        // What the command was given is what is left of the code after the
        // match, which is why `npx --yes` never reaches this: the shapes match
        // from the runner through the command word.
        found.push(
          kind === 'dbmd command'
            ? { ...reference, flags: flagsAfter(segment.slice(match.index + match[0].length), match[1]) }
            : reference,
        )
      }
    }
  }
  return found
}

/** A flag, as written: `--name`, `--name=value` read on the name half, or a short. */
const FLAG = /^(--[a-z][a-z0-9-]*|-[a-zA-Z])(?:=.*)?$/

/**
 * What stops a command line, so that what follows is not read as its flags.
 *
 * A pipe, a redirect, a separator, a substitution. `dbmd check 2>/dev/null` is
 * in this repository's own root help, and the token after the redirect is a
 * path rather than an argument.
 */
const ENDS_THE_COMMAND = /[|;&<>]|\$\(/

/**
 * The flags written after a command on one command line, in order.
 *
 * Conservative on purpose: a token this cannot classify is skipped rather than
 * reported, because a guard with false positives gets deleted rather than
 * fixed. See the header for what each rule here is for.
 *
 * The value of a string option is skipped using that option's own declared
 * type, which is what keeps `dbmd studio --port -1` from reporting a flag
 * called -1. An unknown flag has no type to read, so nothing after it is
 * skipped: it is about to be reported anyway, and a positional is not a flag.
 */
function flagsAfter(rest, command) {
  const takes = flagsOf.get(command) ?? new Map()
  const found = []
  let valueExpected = false

  for (const raw of rest.split(/\s+/)) {
    if (raw === '') continue
    // A bare `--` ends the flags, the same way it does in `takeGlobalFlags`.
    if (raw === '--' || ENDS_THE_COMMAND.test(raw)) break
    if (valueExpected) {
      valueExpected = false
      continue
    }
    // A synopsis writes `[--strict]` and a sentence ends `--json.`, and both
    // are the same claim as the bare token.
    const token = raw.replace(/^[[("']+/, '').replace(/[\])"',.]+$/, '')
    const flag = FLAG.exec(token)
    if (!flag) continue
    found.push(flag[1])
    valueExpected = !token.includes('=') && takes.get(flag[1]) === 'string'
  }
  return found
}

/**
 * Every version pinned in one file, once per line it is pinned on.
 *
 * A line inside a fence is read both as code and as its spans, the same way a
 * reference is, so the same pin can be found twice. Where it is wrong is a
 * line, so a line is what is reported.
 */
function pinsIn(file, text) {
  const found = new Map()
  for (const { segment, line } of codeIn(file, text)) {
    for (const [, version] of segment.matchAll(PIN)) {
      if (DIST_TAG.test(version)) continue
      const at = `${line} ${version}`
      if (!found.has(at)) found.set(at, { version, line })
    }
  }
  return [...found.values()]
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
// What is documented
// ---------------------------------------------------------------------------

/** The one file that promises an entry for every command. See the header. */
const DOCUMENTATION = 'README.md'

/**
 * What documenting a command looks like there: a paragraph opening with the
 * command in bold code, which is how all seven are already written.
 *
 *   **`dbmd refs <table> [directory]`** answers "what points at this table".
 *
 * Only the word after `dbmd` is read. The arguments and the flags beside it are
 * the entry's own business and change without this noticing, which is the line
 * between checking that a command is documented and reviewing how well.
 *
 * An entry always opens a paragraph, so it always begins a line, whatever
 * Prettier does to the rest of the sentence.
 */
const ENTRY = /^\*\*`dbmd ([a-z][a-z0-9-]*)/gm

function documentedCommands() {
  return new Set([...read(DOCUMENTATION).matchAll(ENTRY)].map((match) => match[1]))
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

const commands = cliCommands()
const scripts = npmScripts()
const version = packageVersion()
const globals = globalFlags()

/** Every command's own flags, against the flag each one is declared to be. */
const flagsOf = new Map([...commands].map(([name, file]) => [name, commandFlags(file)]))

/**
 * Where the two hand-written lists of one command's flags disagree.
 *
 * The table is what the program accepts and the help is what a person reads,
 * and this is the whole of what the second read buys: a flag that works and is
 * undocumented, a flag documented and removed, and a rename that moved one of
 * them. It is also the loud failure a source-reading check owes: a table this
 * stopped being able to find leaves the help saying --strict over a command
 * that now takes nothing. See the header, and ADR 0089.
 */
const disagreements = []
for (const [name, file] of commands) {
  const table = flagsOf.get(name)
  const helped = helpFlags(file)
  for (const flag of table.keys()) {
    if (!helped.has(flag)) disagreements.push({ file, name, flag, missing: 'help' })
  }
  for (const flag of helped) {
    if (!table.has(flag)) disagreements.push({ file, name, flag, missing: 'table' })
  }
}

function kindOf(named) {
  if (named.startsWith('npm run ')) return 'npm script'
  if (named.startsWith('node ') || named.startsWith('scripts/')) return 'script file'
  return 'dbmd command'
}

function resolves(named) {
  const kind = kindOf(named)
  if (kind === 'npm script') return scripts.has(named.slice('npm run '.length))
  if (kind === 'script file') {
    // The runner is optional. A path with node in front of it and the same
    // path on its own are one claim about one file, and both resolve against
    // the filesystem. The two example spellings this comment wanted are left
    // out of it: they name a file that does not exist, which is the thing this
    // refuses, and it refused them within seconds of the shape being added.
    const path = named.startsWith('node ') ? named.slice('node '.length) : named
    return existsSync(join(ROOT, path))
  }
  // A marker can name a flag, `dbmd check --deep`, and then both halves have to
  // be real before it is stale. Without this the marker for a flag would still
  // be excusing a page on the day the flag shipped, which is the day the
  // sentence around it needs rereading.
  const [command, flag] = named.slice('dbmd '.length).split(' ')
  if (!commands.has(command)) return false
  if (flag === undefined) return true
  return globals.has(flag) || flagsOf.get(command)?.has(flag) === true
}

function describe(kind) {
  if (kind === 'npm script') return 'a script in package.json'
  if (kind === 'script file') return 'a file in scripts/'
  return `a dbmd command. There are ${[...commands.keys()].join(', ')}`
}

/** What a command does take, for the reader of a failure about one that it does not. */
function takes(command) {
  const own = [...(flagsOf.get(command) ?? new Map()).keys()]
  const after = [...globals].join(', ')
  return own.length === 0
    ? `"dbmd ${command}" takes no flags of its own, and ${after} are accepted after every command`
    : `"dbmd ${command}" takes ${own.join(', ')}, and ${after} are accepted after every command`
}

const files = scannedFiles()
const problems = []
const mispinned = []
let pinned = 0
let checked = 0

for (const file of files) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  const markers = markersIn(text)
  const excused = new Set()
  const reported = new Set()

  for (const { kind, named, line, flags } of referencesIn(file, text)) {
    if (!resolves(named)) {
      // A line inside a fence is read both as code and as its spans, and the
      // shapes overlap, so the same reference can be found more than once.
      // Where it is wrong is a line, not an offset, so one report per line is
      // the whole of what a reader needs.
      if (reported.has(`${line} ${named}`)) continue
      reported.add(`${line} ${named}`)
      if (markers.has(named)) {
        excused.add(named)
        continue
      }
      problems.push({ file, line, text: `\`${named}\` is not ${describe(kind)}` })
      continue
    }

    // Flags are read only where the command resolved. `dbmd fmt --deep` has one
    // finding in it and it is the command; a second one about the flags of
    // something that does not exist is noise in front of the answer.
    const command = named.slice('dbmd '.length)
    for (const flag of flags ?? []) {
      if (reported.has(`${line} ${named} ${flag}`)) continue
      reported.add(`${line} ${named} ${flag}`)
      checked++
      if (globals.has(flag) || flagsOf.get(command)?.has(flag) === true) continue
      if (markers.has(`${named} ${flag}`)) {
        excused.add(`${named} ${flag}`)
        continue
      }
      problems.push({
        file,
        line,
        text: `\`${flag}\` is not a flag of \`${named}\`. ${takes(command)}`,
      })
    }
  }

  for (const { version: pin, line } of pinsIn(file, text)) {
    pinned++
    if (pin !== version) mispinned.push({ file, line, pin })
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

const documented = documentedCommands()
const undocumented = [...commands.keys()].filter((command) => !documented.has(command))

let failed = false

if (problems.length > 0) {
  failed = true
  console.error(
    `${problems.length} reference${problems.length === 1 ? '' : 's'} to something that does not exist:\n`,
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

A flag beside the command is the same claim. \`dbmd check --deep\` was written on
three pages, one of them the CI recipe this project hands a stranger to paste
into their own repository, and it would have exited 2 in their CI. ADR 0089.

If you meant something that does not exist yet, say so where you wrote it, on
its own line or at the end of one:

    <!-- hypothetical: dbmd fmt -->
    <!-- hypothetical: dbmd check --deep -->

The marker holds for the file it is written in and has to name the reference
exactly. It fails once the thing exists, so the sentence around it gets read
again on the day it stops being hypothetical. ADR 0036.

**A marker names one reference, not the command line you ran.** That is a
command, or a command and one flag, and nothing after it. A marker written with
a directory or a second flag in it marks the command and the first flag only,
which usually already exists, so you get told that marker is stale while the
thing you meant is still unmarked. Write one marker per thing that does not
exist.
`)
}

if (mispinned.length > 0) {
  failed = true
  console.error(
    `${mispinned.length} pinned version${mispinned.length === 1 ? '' : 's'} ${mispinned.length === 1 ? 'names' : 'name'} something this package is not:\n`,
  )
  for (const { file, line, pin } of mispinned) {
    console.error(`  ${file}:${line}`)
    console.error(`    pins ${pin} and package.json says ${version}`)
  }
  console.error(`
A pinned version is a copy of the number in package.json, and there are five of
them across two pages and this script. They agreed for one reason only, which is
that nobody had released anything yet; the release that moves package.json
leaves every page telling a reader to install the version before it, and the
page that told them to pin is the page that went stale.

Move them with the version. Nothing here says the version is on the registry,
because nothing in this repository can: \`npm view dbmd versions\` is the answer to
that and both pages already send a reader to it. ADR 0080.
`)
}

if (undocumented.length > 0) {
  failed = true
  console.error(
    `${undocumented.length} command${undocumented.length === 1 ? '' : 's'} exist${undocumented.length === 1 ? 's' : ''} and ${DOCUMENTATION} does not document ${undocumented.length === 1 ? 'it' : 'them'}:\n`,
  )
  for (const command of undocumented) console.error(`  dbmd ${command}`)
  console.error(`
${DOCUMENTATION} is the one file that promises an entry for every command, and
it has been wrong twice: \`dbmd import\` shipped over a page still saying the
import path was unfinished, and \`dbmd query\` shipped under a heading counting
five. Nothing noticed either, because a page that is merely out of date is
consistent with itself.

An entry opens a paragraph with the command in bold code, under "The commands",
in the order a person meets them:

    **\`dbmd refs <table> [directory]\`** answers "what points at this table".

Say what it does, what its flags are, and show real output, the way the entries
beside it do. The heading does not count them, on purpose: a number two hundred
lines above the thing it counts is what went stale. ADR 0043.
`)
}

if (disagreements.length > 0) {
  failed = true
  console.error(
    `${disagreements.length} flag${disagreements.length === 1 ? '' : 's'} ${disagreements.length === 1 ? 'is' : 'are'} on one of a command's two lists and not the other:\n`,
  )
  for (const { file, name, flag, missing } of disagreements) {
    console.error(`  ${file}`)
    console.error(
      missing === 'help'
        ? `    "dbmd ${name}" accepts ${flag} and its --help does not list it`
        : `    "dbmd ${name}" lists ${flag} in its --help and does not accept it`,
    )
  }
  console.error(`
A command writes its flags down twice, in the same file: once in the Options
block a person reads, and once in the options table it hands parseArgs. The
table is what the program does, so it is what a flag written anywhere in this
tree is resolved against, and this is the check that stops the two drifting.

It is also what makes this script fail loudly rather than quietly. The table is
read out of the source as text, and a table this can no longer find would leave
every flag in the repository unchecked and every page passing. The help block
is the independent witness that says so. ADR 0089.
`)
}

if (failed) process.exit(1)

// What this is allowed to claim moved with the rule. It used to promise that
// every reference resolves, which was true and was the whole of the hole: a
// flag was not a reference, so three pages naming one that does not exist were
// covered by that sentence and by nothing else. The flag count is here for the
// same reason the pin count is: a sweep that quietly stopped finding anything
// prints the same success line as one that swept.
console.log(
  `${files.length} files scanned, every \`dbmd\`, \`npm run\` and \`scripts/\` reference resolves, ` +
    `so ${checked === 1 ? 'does the 1 flag' : `do the ${checked} flags`} written beside a \`dbmd\` command, ` +
    `${pinned} pinned version${pinned === 1 ? '' : 's'} ${pinned === 1 ? 'names' : 'name'} ${version}, ` +
    `and ${DOCUMENTATION} documents all ${commands.size} commands.`,
)
