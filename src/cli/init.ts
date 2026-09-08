/**
 * `dbmd init`: a model directory, with an example model in it.
 *
 * The files come out of `writeModel`, from the value in `example.ts`, rather
 * than out of a template. ADR 0012 has the argument; the short version is that
 * this repository has one thing that knows how a model file is spelled and a
 * scaffold is not allowed to be a second one.
 */

import { readdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { WriteFailed, writeModel } from '../model/write.js'
import { EXIT_FAILURE, UsageError, usageProblem, type Command } from './command.js'
import { exampleModel } from './example.js'
import { sortedBy, type Output, type Report } from './output.js'

/** Where a model lives when nobody says otherwise. The README says so too. */
const DEFAULT_DIRECTORY = 'db-model'

/** `docs/format.md`, which is the page a hand-author needs and cannot guess. */
const FORMAT_REFERENCE = 'https://github.com/BlakeHastings/dbmd/blob/main/docs/format.md'

export const initCommand: Command = {
  name: 'init',
  summary: 'create a model directory, with an example model in it',
  help: `Usage: dbmd init [directory]

Create a model directory and write an example model into it: two tables, a
sticky note, and the prose that says why they are the way they are. All of it
is meant to be read once and then replaced.

  directory   where to create it, defaulting to ${DEFAULT_DIRECTORY}

It refuses a directory that already exists and is not empty, because the files
it writes are named after common tables and overwriting somebody's model is not
a thing to do by accident. It refuses a path that is not a directory for the
same reason, and says so differently, because emptying a file does not make it
a directory init may write a model into.
`,
  run: runInit,
}

async function runInit(argv: readonly string[], out: Output): Promise<number> {
  const directory = parseInitArgs(argv)

  const found = await vacancy(directory)
  if (found === 'not-a-directory') return out.report(await notADirectory(directory, out))
  if (found === 'occupied') {
    return out.report({
      code: EXIT_FAILURE,
      text:
        `${out.style.bad('dbmd:')} ${directory} already exists and is not empty, ` +
        `so init has left it alone.\n` +
        `Empty it, move it aside, or give init a different directory.\n`,
      json: {
        directory,
        error: {
          code: 'directory-not-empty',
          message: `${directory} already exists and is not empty`,
        },
      },
    })
  }

  let written: readonly string[]
  try {
    ;({ written } = await writeModel(directory, exampleModel()))
  } catch (error) {
    // The same refusal `vacancy` reaches, from the other platform's answer.
    //
    // `dbmd init plain.md/sub` is one command line with two behaviours: Linux
    // answers `readdir` with ENOTDIR and is refused above, and Windows 11 on
    // Node 24 answers ENOENT, so `vacancy` reads the path as free and the file
    // in the way is not met until the writer's first `mkdir`. Measured on both,
    // in #226 and again here. Until this branch existed the second of those
    // reached the developer as the entry point's last-resort line: an absolute
    // path with backslashes in it, which ADR 0006 rule 4 forbids, naming
    // `plain.md`, which is not the path they typed, under the generic code
    // "failed", which a caller cannot branch on.
    //
    // It is the same refusal rather than a second one because the same command
    // line must not answer with two different `error.code`s depending on which
    // kernel ran it, and because #226 worded this one to be true of a path that
    // does not exist with a file above it: `vacancy`'s own note says so.
    //
    // ENOTDIR and nothing wider. Every other way a write fails, a permission
    // denied or a full disk, is a fact about the machine and stays the entry
    // point's to report. And ENOTDIR here can only be about the directory init
    // was given, never about a file inside it, because the refusal above has
    // already established that this path is either empty or absent.
    //
    // Through `cause`, because the writer renames every refusal onto the model
    // file it was on and hands the original over untouched underneath it (ADR
    // 0083). The errno is on the cause; the wrapper's own message is a copy of
    // the cause's message and carries no `code` at all.
    if (errorCode(error instanceof WriteFailed ? error.cause : error) !== 'ENOTDIR') throw error
    return out.report(await notADirectory(directory, out))
  }

  const files = sortedBy(written)
  // The format reference rather than the README, because the next thing this
  // user does is write a file by hand, and the Prettier line is here rather
  // than in a file this command writes: a `.prettierignore` belongs at the root
  // of their repository, which is outside the one directory init was given, and
  // Prettier does not read a nested one.
  return out.report({
    code: 0,
    text:
      `Created ${out.style.strong(directory)}, ${files.length} files:\n` +
      files.map((path) => `  ${out.style.faint(path)}\n`).join('') +
      `\nRead _model.md first. It says what the rest of them are for.\n` +
      `\nThe format is written down at ${FORMAT_REFERENCE}\n` +
      `If this repository runs Prettier, add ${directory}/ to its .prettierignore.\n` +
      `Prettier rewrites the prose in these files, and the prose is the point.\n`,
    json: { directory, files, format: FORMAT_REFERENCE },
  })
}

/**
 * The refusal for a path init cannot make a directory of.
 *
 * No "empty it" here, and that is the whole point of the branch. Emptying a
 * file leaves a file, so the advice the other refusal gives is advice a
 * developer can follow and then meet the same refusal, which is what happened
 * before this branch existed.
 *
 * **The first clause names the path that was typed and the advice names the
 * file.** Those are the same thing for `dbmd init plain.md` and they are not
 * for `dbmd init plain.md/sub`, where nothing exists at the path at all and the
 * file in the way is `plain.md`, one component up. Saying "move it aside" about
 * `plain.md/sub` is an instruction that cannot be carried out, which is the
 * defect this branch was created to fix arriving inside the fix for it. So the
 * sentence stays as it was where the two coincide, and names the file where
 * they do not.
 *
 * Both are spelled the way the developer wrote them, relative if that is what
 * they typed, because that is what they can recognise and because ADR 0006
 * rule 4 keeps absolute paths and backslashes out of what this CLI prints.
 */
async function notADirectory(directory: string, out: Output): Promise<Report> {
  const inTheWay = await componentInTheWay(directory)
  // Nothing extra where the path is the file, and nothing extra where the walk
  // could not tell: the developer gets the sentence they got before, which is
  // followable in the first case and is at least not misleading in the second.
  const advice =
    inTheWay === undefined || inTheWay === directory
      ? `Move it aside, or give init a different directory.\n`
      : `${out.style.strong(inTheWay)}, further up the path, is the file in the way. ` +
        `Move it aside, or give init a different directory.\n`
  return {
    code: EXIT_FAILURE,
    text:
      `${out.style.bad('dbmd:')} ${directory} is not a directory, ` +
      `so init has left it alone.\n` +
      advice,
    json: {
      directory,
      error: { code: 'not-a-directory', message: `${directory} is not a directory` },
    },
  }
}

/**
 * The first thing on the way up the path that exists and is not a directory, or
 * `undefined` when nothing on the way up says so.
 *
 * It walks rather than reasons, because only the filesystem knows which
 * component is the file: `dbmd init a/b/c` can be refused for `a` or for `a/b`
 * and the string says nothing about which. It walks with `dirname`, so every
 * name it can return is a prefix of what the developer typed, character for
 * character. Resolving the path first would hand back something they did not
 * write, which is the half of ADR 0006 rule 4 that is about being recognisable
 * rather than about separators.
 *
 * **It runs on the refusal and nowhere else.** That is what makes the cost a
 * non-question: a handful of `stat` calls on a path this command has already
 * decided to fail on, and not one on the run that works. The alternative
 * considered was leaving the advice vague and true, "something in the path is
 * not a directory", which is roughly what `dbmd check` says one command away;
 * it was rejected because a developer can act on a name and cannot act on
 * "something".
 *
 * `undefined` where it cannot tell. A `stat` refused part way up is the real
 * case, and so is the path changing under it between the write and this walk.
 * Neither is worth a guess: the caller then says what it said before.
 */
async function componentInTheWay(directory: string): Promise<string | undefined> {
  let path = directory
  for (;;) {
    try {
      if (!(await stat(path)).isDirectory()) return path
    } catch (error) {
      const code = errorCode(error)
      // ENOENT is nothing at this level, ENOTDIR is a file above this level,
      // and both mean keep going up. Anything else is an answer this walk
      // cannot read, so it stops rather than reporting the next thing it finds.
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return undefined
    }
    const parent = dirname(path)
    // `dirname` is its own fixed point at the root and at ".", which is what
    // ends this loop on both an absolute path and a relative one.
    if (parent === path) return undefined
    path = parent
  }
}

/**
 * One optional positional and no flags at all.
 *
 * `parseArgs` with `strict` is what rejects an unknown flag, which is a thing
 * the CLI has to do and not a thing worth a dependency: the whole surface is
 * a handful of commands and flags.
 */
function parseInitArgs(argv: readonly string[]): string {
  const options = {} as const
  let positionals: string[]
  try {
    ;({ positionals } = parseArgs({
      args: [...argv],
      options,
      allowPositionals: true,
      strict: true,
    }))
  } catch (error) {
    throw new UsageError(
      `${usageProblem(error, argv, options)}. "dbmd init" takes an optional directory ` +
        `and no flags; run "dbmd init --help".`,
    )
  }

  if (positionals.length > 1) {
    throw new UsageError(
      `"dbmd init" takes at most one directory, and got ${positionals.length}: ` +
        `${positionals.join(' ')}.`,
    )
  }
  return positionals[0] ?? DEFAULT_DIRECTORY
}

/**
 * The three answers, because two of them need different words.
 *
 * `vacant` is nothing there at all or an empty directory, and init writes.
 * `occupied` is a directory with entries in it. `not-a-directory` is `ENOTDIR`,
 * which is what `dbmd init README.md` gets: a path init cannot make a directory
 * of, whatever is or is not written in it.
 *
 * These used to be one boolean, and the single refusal it fell into was worded
 * for `occupied`. So a file was told it was a non-empty directory, an empty file
 * was told it was not empty, and the fix it named, emptying it, provably does
 * not work: truncating a file leaves a file and the refusal repeats.
 *
 * **The refusal for `not-a-directory` does not claim the path exists**, and that
 * is deliberate rather than coy. `ENOTDIR` also arrives for `README.md/model`,
 * where nothing exists at the path and a plain file is in the way further up,
 * and "is not a directory" is true of both while "already exists" is true of
 * only one. Measured: Linux answers `ENOTDIR` for the nested form, Windows 11
 * with Node 24 answers `ENOENT`, so the two platforms do not even agree on which
 * branch it takes. On Windows it lands in `vacant` and the file above it is not
 * met until the writer's first `mkdir`, which `runInit` catches and reports as
 * this same refusal, so the answer is one answer whatever the kernel says.
 *
 * Anything else, a permission error most likely, is thrown: it is a fact about
 * the machine rather than about the model, and the entry point reports it.
 */
type Vacancy = 'vacant' | 'occupied' | 'not-a-directory'

async function vacancy(directory: string): Promise<Vacancy> {
  try {
    return (await readdir(directory)).length === 0 ? 'vacant' : 'occupied'
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT') return 'vacant'
    if (code === 'ENOTDIR') return 'not-a-directory'
    throw error
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}
