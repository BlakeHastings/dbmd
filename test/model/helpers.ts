import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { readModel } from '../../src/model/read.js'
import type { ReadResult } from '../../src/model/types.js'

/**
 * Read a model built from literal file contents in a throwaway directory.
 *
 * Contents are written as given, byte for byte, which is the point: a fixture
 * committed to this repository is normalised to LF on the way in, so a file
 * whose line endings are the thing under test has to be made here instead.
 */
export async function withModel(
  files: Record<string, string>,
  options: { readonly modelFile?: boolean } = {},
): Promise<ReadResult> {
  const dir = await mkdtemp(join(tmpdir(), 'dbmd-model-'))
  // A `_model.md` is seeded unless the test is about not having one, so that
  // its absence does not add a warning to every unrelated assertion.
  const seeded =
    options.modelFile === false || '_model.md' in files
      ? files
      : { '_model.md': '---\nkind: model\nname: test\n---\n', ...files }
  try {
    for (const [relative, content] of Object.entries(seeded)) {
      const target = join(dir, relative)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
    }
    return await readModel(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** The committed fixture directory, which is a whole plausible model. */
export const fixtureModel = fileURLToPath(new URL('../fixtures/model', import.meta.url))
