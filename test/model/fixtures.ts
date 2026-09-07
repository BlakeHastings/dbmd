import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

/** A ten-table model written by the writer, so every file in it is canonical. */
export const canonicalModel = fileURLToPath(new URL('../fixtures/canonical', import.meta.url))

/** The demo model, hand-written by a person from ADR 0003 and nothing else. */
export const exampleShop = fileURLToPath(new URL('../../examples/shop', import.meta.url))

/** The same sort of model, hand-written badly. Every file parses; none is canonical. */
export const untidyModel = fileURLToPath(new URL('../fixtures/untidy', import.meta.url))

/**
 * Copy a committed fixture into a throwaway directory and run against the copy.
 *
 * The writer's whole subject is what it does to files on disk, so the tests
 * have to be allowed to write, and a test that wrote into `test/fixtures/`
 * would leave the next test reading the previous one's output.
 */
export async function withCopy<T>(fixture: string, use: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'dbmd-write-'))
  try {
    await cp(fixture, dir, { recursive: true })
    return await use(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Every file under `dir` that is part of the model, keyed by its
 * slash-separated relative path.
 *
 * Names beginning with `.` are skipped, because `docs/format.md` says they are
 * not part of a model directory and `readModel` skips them too. Without that
 * the listing answers a different question from the reader's, and a test that
 * asks "which files did this touch" gets told about a file the tool has
 * promised to ignore.
 *
 * That is not hypothetical. `writeModel` saves atomically by writing
 * `.<name>.<uuid>.tmp` beside the target and renaming over it, so a listing
 * taken while the studio is flushing can land in the window between the two.
 * dbmd-36 is that flake, seen once in CI. Waiting for the writer would be the
 * wrong repair: the race is real and a sleep hides it while making the next one
 * harder to see. The assertion was asking the wrong question, and this is the
 * question it meant.
 *
 * Everything else is kept, including files that are not `*.md`. This is a
 * listing of the directory, not of the model, and a test that writes a stray
 * `notes.txt` should be told about it.
 */
export async function snapshot(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const walk = async (current: string): Promise<void> => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (entry.name.startsWith('.')) continue
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else files.set(relative(dir, absolute).split(sep).join('/'), await readFile(absolute, 'utf8'))
    }
  }
  await walk(dir)
  return files
}

/**
 * The names under `dir` that `snapshot` deliberately does not return.
 *
 * The one thing a test can want from a model directory that is not about the
 * model: proof that the writer left nothing behind. `snapshot` cannot answer
 * that, by construction, and a test that asked it would be told everything is
 * fine because the rubbish is exactly the shape it filters out.
 */
export async function hiddenEntries(dir: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name)
      if (entry.name.startsWith('.')) found.push(relative(dir, absolute).split(sep).join('/'))
      else if (entry.isDirectory()) await walk(absolute)
    }
  }
  await walk(dir)
  return found.sort()
}
