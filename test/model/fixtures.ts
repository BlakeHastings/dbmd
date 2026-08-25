import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

/** A ten-table model written by the writer, so every file in it is canonical. */
export const canonicalModel = fileURLToPath(new URL('../fixtures/canonical', import.meta.url))

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

/** Every file under `dir`, keyed by its slash-separated relative path. */
export async function snapshot(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const walk = async (current: string): Promise<void> => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else files.set(relative(dir, absolute).split(sep).join('/'), await readFile(absolute, 'utf8'))
    }
  }
  await walk(dir)
  return files
}
