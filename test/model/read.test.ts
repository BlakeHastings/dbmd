import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { compareDiagnostics, locationText } from '../../src/diagnostics.js'
import { readModel } from '../../src/model/read.js'
import type { Diagnostic, ReadResult } from '../../src/model/types.js'
import { validate } from '../../src/model/validate.js'
import { fixtureModel, withModel } from './helpers.js'

/**
 * The file location, asserted rather than assumed: `at.in` is what says a
 * diagnostic points at a file, and since ADR 0086 the model reader raises
 * directory locations too, so this can fail rather than merely narrow.
 */
function location(diagnostic: Diagnostic | undefined): { path: string; line?: number } {
  if (diagnostic?.at.in !== 'file') throw new Error('not a file location')
  return diagnostic.at
}

/** The directory location, asserted the same way and for the same reason. */
function directoryLocation(diagnostic: Diagnostic | undefined): { path: string } {
  if (diagnostic?.at.in !== 'directory') throw new Error('not a directory location')
  return diagnostic.at
}

/** Diagnostics as one line each, which is how a reviewer reads them. */
function lines(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => `${locationText(d.at)} ${d.severity} ${d.code}: ${d.message}`)
}

describe('the body is one opaque string', () => {
  test('a fenced block containing three dashes is not mistaken for a delimiter', async () => {
    const { model } = await readModel(fixtureModel)
    const customers = model.tables.find((table) => table.name === 'customers')
    const onDisk = await readFile(join(fixtureModel, 'tables', 'customers.md'), 'utf8')

    // Asserted rather than optional-chained: a fixture that stopped loading
    // would make every assertion below pass on undefined and say nothing.
    assert(customers !== undefined, 'the customers fixture did not load')
    expect(customers.body).toContain('```sql')
    expect(customers.body).toContain('\n---\n')
    // The body is the tail of the file from the character after the closing
    // delimiter's line break, worked out here independently of the reader.
    const fileLines = onDisk.split('\n')
    const closing = fileLines.indexOf('---', 1)
    expect(customers.body).toBe(fileLines.slice(closing + 1).join('\n'))
  })

  test('CRLF reaches and leaves the reader unchanged', async () => {
    const body =
      '\r\nOne row per customer order.\r\n\r\n```sql\r\nSELECT 1;\r\n---\r\n```\r\nLast line.\r\n'
    const frontmatter = ['---', 'kind: table', 'table: orders', 'columns: []', '---', ''].join(
      '\r\n',
    )

    const { model, diagnostics } = await withModel({ 'tables/orders.md': frontmatter + body })

    expect(diagnostics).toEqual([])
    expect(model.tables[0]?.body).toBe(body)
    // The reason this matters: a body that came back LF-normalised would make
    // the next save rewrite every line of the file, and a whole-file diff is
    // exactly what this format exists to avoid.
    expect(model.tables[0]?.body.includes('\n\n')).toBe(false)
  })

  test('a body with no trailing newline keeps not having one', async () => {
    const { model } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\n---\nNo newline at the end',
    })

    expect(model.tables[0]?.body).toBe('No newline at the end')
  })

  test('a file that ends at the closing delimiter has an empty body', async () => {
    const { model } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\n---\n',
    })

    expect(model.tables[0]?.body).toBe('')
  })
})

describe('absent, empty and unterminated frontmatter are three different things', () => {
  test('no delimiter at all', async () => {
    const { model, diagnostics } = await withModel({
      'tables/notes-really.md': 'Just prose, in a directory of tables.\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/notes-really.md error frontmatter-absent: no frontmatter: the file does not start with a `---` line',
    ])
    // No table is invented from the file name: a phantom box on the canvas and
    // in every export is worse than a missing one.
    expect(model.tables).toEqual([])
  })

  test('an opening delimiter that is never closed', async () => {
    const { diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md error frontmatter-unterminated: the frontmatter opens with `---` and is never closed by a `---` line',
    ])
  })

  test('delimiters with nothing between them', async () => {
    const { diagnostics } = await withModel({ 'tables/orders.md': '---\n---\nProse.\n' })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md error frontmatter-empty: the frontmatter is empty, so the file declares nothing',
    ])
  })

  test('frontmatter that is a list rather than a mapping', async () => {
    const { diagnostics } = await withModel({ 'tables/orders.md': '---\n- orders\n---\n' })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:2 error frontmatter-not-a-map: the frontmatter must be a mapping of keys to values',
    ])
  })

  test('broken YAML is one diagnostic with the line the parser stopped on', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ncolumns:\n  - name: id\n   type: uuid\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:5 error frontmatter-invalid: Sequence item without - indicator',
    ])
    expect(model.tables).toEqual([])
  })
})

describe('the directory decides the kind', () => {
  test('a kind that disagrees with its directory is a diagnostic and does not load', async () => {
    const { model, diagnostics } = await withModel({
      'notes/misfiled.md': '---\nkind: table\ntable: misfiled\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'notes/misfiled.md:2 error kind-mismatch: `kind: table` in a directory of notes; the directory decides, so this file is not loaded',
    ])
    expect(model.notes).toEqual([])
    expect(model.tables).toEqual([])
  })

  test('a missing kind is a diagnostic, and the directory still decides', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\ntable: orders\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md error kind-missing: no `kind:` key; the directory says this is a table',
    ])
    expect(model.tables[0]?.name).toBe('orders')
  })

  test('a directory that is not a kind is ignored, loudly', async () => {
    const { diagnostics } = await withModel({
      'sketches/idea.md': '---\nkind: table\n---\n',
      'tables/orders.md': '---\nkind: table\ntable: orders\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'sketches warning unknown-kind-directory: `sketches/` is not a kind of object dbmd knows; its files are ignored',
    ])
  })
})

describe('the object files that are there and are not objects', () => {
  // ADR 0090. `Model.tables` says which tables this model has, and until this
  // existed every reader of it said "there is no tables/orders.md" instead,
  // which is a different sentence and is false through the whole of a rename.

  test('a file the reader refused is on the model, beside the diagnostic about it', async () => {
    const { model } = await withModel({
      'tables/orders.md': '---\nkind: note\n---\n',
      'notes/why.md': 'no frontmatter at all\n',
    })

    // Sorted by path, as every other list on a model is.
    expect(model.refused).toEqual([
      { kind: 'note', name: 'why', path: 'notes/why.md' },
      { kind: 'table', name: 'orders', path: 'tables/orders.md' },
    ])
  })

  test('a directory wearing an object file name is one of them', async () => {
    const { model } = await withModel({ 'tables/orders.md/README.txt': 'not a table\n' })

    // The sharpest case: the run says the path is a directory, and used to say
    // in the next breath that nothing is at it.
    expect(model.refused).toEqual([{ kind: 'table', name: 'orders', path: 'tables/orders.md' }])
  })

  test('a file that loaded is not one of them, however much the reader said about it', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\ntable: orders\n---\n',
    })

    // `kind-missing` is an error and the table is in the model all the same,
    // which is the line this list is drawn on: it holds what produced no
    // object, not what produced a diagnostic.
    expect(diagnostics.map((d) => d.code)).toEqual(['kind-missing'])
    expect(model.refused).toEqual([])
  })

  test('a model with nothing wrong with it has an empty list', async () => {
    const { model } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\n---\n',
    })

    expect(model.refused).toEqual([])
  })

  // Every way a `tables/*.md` fails to become a table, one per line, so that a
  // new one added without an error beside it is a red build rather than a
  // silence. `file-unreadable` is the seventh and is not here: it needs a
  // permission or a dangling link, which `test/model/unreadable.test.ts` builds
  // and asserts is an error, at both of the reader's filesystem calls.
  const refusals: readonly (readonly [string, Record<string, string>])[] = [
    ['no frontmatter', { 'tables/orders.md': 'just prose\n' }],
    ['frontmatter never closed', { 'tables/orders.md': '---\nkind: table\n' }],
    ['frontmatter with nothing in it', { 'tables/orders.md': '---\n---\n' }],
    ['YAML that will not parse', { 'tables/orders.md': '---\nkind: table\n\tpk: true\n---\n' }],
    ['frontmatter that is a list', { 'tables/orders.md': '---\n- kind: table\n---\n' }],
    ['a kind the directory disagrees with', { 'tables/orders.md': '---\nkind: note\n---\n' }],
    ['a directory wearing the name', { 'tables/orders.md/README.txt': 'not a table\n' }],
  ]

  test.each(refusals)(
    'a table refused for %s is refused with an error beside it, never a warning alone',
    async (_why, files) => {
      const { model, diagnostics } = await withModel(files)

      // The claim ADR 0090 rests its `group-empty` cost on: a model with a
      // refused object exits 1 anyway, so the warning that stands down is
      // deferred behind an error rather than lost from a passing run.
      expect(model.refused).toHaveLength(1)
      expect(diagnostics.some((d) => d.severity === 'error')).toBe(true)
    },
  )

  test('and an incomplete table carries one too, which is the other half of that claim', async () => {
    // `complete` is `!raised.some(d => d.severity === 'error')`, so this holds
    // by construction. It is asserted because `emptyGroups` stands down for an
    // incomplete table as well as for a refused file, and the two halves have
    // to be true together for the cost to be a deferral rather than a loss.
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\ncolumns:\n  - name: id\n---\n',
    })

    expect(model.tables[0]?.complete).toBe(false)
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })
})

describe('a kind name that is not a directory', () => {
  test('a kind name that is a plain file is an error, not silence', async () => {
    // The state this is about: `dbmd check` used to print `0 tables, no
    // problems` and exit 0 here, which is the least useful true sentence
    // available to it. ADR 0038.
    const { model, diagnostics } = await withModel({ tables: 'not a directory\n' })

    expect(lines(diagnostics)).toEqual([
      "tables error kind-not-a-directory: `tables` is a file rather than a directory, so the model's tables were not read; a `tables/` symlink checked out where symlinks are unsupported looks exactly like this",
    ])
    expect(model.tables).toEqual([])
  })

  test('the message names the kind that was not read, for each of the three', async () => {
    const { diagnostics } = await withModel({
      groups: 'x\n',
      notes: 'x\n',
      tables: 'x\n',
    })

    expect(lines(diagnostics)).toEqual([
      "groups error kind-not-a-directory: `groups` is a file rather than a directory, so the model's groups were not read; a `groups/` symlink checked out where symlinks are unsupported looks exactly like this",
      "notes error kind-not-a-directory: `notes` is a file rather than a directory, so the model's notes were not read; a `notes/` symlink checked out where symlinks are unsupported looks exactly like this",
      "tables error kind-not-a-directory: `tables` is a file rather than a directory, so the model's tables were not read; a `tables/` symlink checked out where symlinks are unsupported looks exactly like this",
    ])
  })

  test('a model with no kind directories at all stays silent', async () => {
    // The case that makes this a judgement rather than a rule: an empty model
    // is a legal model, `dbmd init` writes one, and an imported model has no
    // `notes/` or `groups/`. Absent is not the same as wrong.
    const { model, diagnostics } = await withModel({})

    expect(diagnostics).toEqual([])
    expect(model.tables).toEqual([])
    expect(model.notes).toEqual([])
    expect(model.groups).toEqual([])
  })

  test("a file whose name is not a kind is still nobody's business", async () => {
    // The complaint is about the three reserved names and nothing else. A
    // `README`, a `.gitignore` or a stray `sketches` file at the model root is
    // not a malformed model, and warning about every file here would be the
    // warning nobody reads.
    const { diagnostics } = await withModel({
      '.gitignore': '*.tmp\n',
      README: 'The billing model.\n',
      sketches: 'x\n',
    })

    expect(diagnostics).toEqual([])
  })
})

/**
 * A model directory whose `tables` is a link to a directory somewhere else.
 *
 * Made with `symlink` rather than through `withModel`'s literal files, because
 * what is under test is what the entry *is* rather than what it says.
 *
 * The type is `junction`, which Windows needs and every other platform ignores.
 * A plain directory symlink on Windows wants a privilege an ordinary account
 * does not have, so `symlink(target, path, 'dir')` fails there with `EPERM` and
 * this test would only ever run on CI. A junction needs no privilege, and a
 * `Dirent` for one answers `isDirectory()` false and `isSymbolicLink()` true
 * exactly as a POSIX symlink to a directory does, which is the property the
 * test is about.
 */
async function withLinkedTables(
  options: { readonly dangling?: boolean } = {},
): Promise<ReadResult> {
  const root = await mkdtemp(join(tmpdir(), 'dbmd-linked-'))
  try {
    const model = join(root, 'model')
    const elsewhere = join(root, 'elsewhere')
    await mkdir(model)
    await mkdir(elsewhere)
    await writeFile(join(model, '_model.md'), '---\nkind: model\nname: test\n---\n')
    await writeFile(
      join(elsewhere, 'orders.md'),
      '---\nkind: table\ntable: orders\ncolumns: []\n---\n',
    )
    await symlink(elsewhere, join(model, 'tables'), 'junction')
    if (options.dangling === true) await rm(elsewhere, { recursive: true, force: true })
    return await readModel(model)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('a kind directory reached through a link', () => {
  test('a linked kind directory is read', async () => {
    // The regression that made the guard indefensible rather than merely
    // unhelpful: this used to report a model with no tables and no problems,
    // while the tables sat on disk one link away. ADR 0038.
    const { model, diagnostics } = await withLinkedTables()

    expect(diagnostics).toEqual([])
    expect(model.tables.map((table) => table.name)).toEqual(['orders'])
  })

  test('a link that points at nothing is a read failure and says so', async () => {
    // `file-unreadable` and not `kind-not-a-directory`: a call was made and it
    // failed, which is exactly what that code means. Nothing was listed and
    // rejected, so nothing was decided about the shape of the model.
    const { diagnostics } = await withLinkedTables({ dangling: true })

    expect(diagnostics.map((d) => d.code)).toEqual(['file-unreadable'])
    expect(diagnostics[0]?.message).toContain('ENOENT')
  })
})

/**
 * A model whose `tables/` is real and holds whatever `make` puts in it.
 *
 * Built by hand rather than through `withModel` for the same reason
 * `withLinkedTables` is: what is under test is what an entry *is*, and
 * `withModel` can only write file contents. `elsewhere/` is a directory beside
 * the model for a link to point at.
 */
interface ModelPaths {
  /** The model root, for a test that needs a kind directory other than `tables`. */
  readonly model: string
  readonly tables: string
  /** A directory beside the model, for a link to point at. */
  readonly elsewhere: string
  /** The temporary root, whose children are the two above. */
  readonly root: string
}

async function withTables(make: (paths: ModelPaths) => Promise<void>): Promise<ReadResult> {
  const root = await mkdtemp(join(tmpdir(), 'dbmd-object-'))
  try {
    const model = join(root, 'model')
    const tables = join(model, 'tables')
    const elsewhere = join(root, 'elsewhere')
    await mkdir(tables, { recursive: true })
    await mkdir(elsewhere)
    await writeFile(join(model, '_model.md'), '---\nkind: model\nname: test\n---\n')
    await make({ model, tables, elsewhere, root })
    return await readModel(model)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const TABLE_FILE = '---\nkind: table\ntable: orders\ncolumns: []\n---\n'

/**
 * Whether this machine can make a symlink to a *file*.
 *
 * A junction is the privilege-free link on Windows and it links directories
 * only: `symlink(aFile, link, 'junction')` is accepted and produces a link that
 * resolves to nothing, so it cannot stand in for this. `symlink(aFile, link,
 * 'file')` needs `SeCreateSymbolicLink`, which an ordinary Windows account does
 * not have and Developer Mode grants, so it fails with `EPERM` on the machine
 * this was written on and succeeds on the Linux runner and on POSIX generally.
 *
 * Measured rather than derived from `process.platform`, because the answer is
 * about the account and not about the operating system.
 *
 * The one test below that needs it is therefore skipped here and runs in CI,
 * which is not good enough on its own: `linked-file.test.ts` pins the same
 * decision everywhere, with the `Dirent` a POSIX symlink produces measured and
 * then supplied.
 */
async function canSymlinkFiles(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'dbmd-symlink-probe-'))
  try {
    await writeFile(join(dir, 'target'), 'x')
    await symlink(join(dir, 'target'), join(dir, 'link'), 'file')
    return true
  } catch {
    return false
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const fileSymlinks = await canSymlinkFiles()

describe('an object file reached through a link', () => {
  test.runIf(fileSymlinks)('a symlinked table file is read', async () => {
    // The defect dbmd-95n names. `markdownFiles` filtered on `entry.isFile()`,
    // which is false for a symlink whatever it points at, so this model came
    // back with no tables and no diagnostics at all.
    const { model, diagnostics } = await withTables(async ({ tables, elsewhere }) => {
      await writeFile(join(elsewhere, 'orders.md'), TABLE_FILE)
      await symlink(join(elsewhere, 'orders.md'), join(tables, 'orders.md'), 'file')
    })

    expect(diagnostics).toEqual([])
    expect(model.tables.map((table) => table.name)).toEqual(['orders'])
  })

  test('a link that resolves to a directory is an error, not silence', async () => {
    // The question ADR 0038 left open and ADR 0040 answers. A junction is the
    // link this machine can make without a privilege, and it links directories
    // only, so this is the case that is reproducible everywhere: `tables` holds
    // a name that claims to be the table `orders` and can never be one.
    const { model, diagnostics } = await withTables(async ({ tables, elsewhere }) => {
      await symlink(elsewhere, join(tables, 'orders.md'), 'junction')
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md error object-not-a-file: `orders.md` is a directory rather than a file, so there is no table `orders`; a link that resolves to a directory looks exactly like this',
    ])
    expect(model.tables).toEqual([])
  })

  test('a plain directory of that name gets the same sentence as a link to one', async () => {
    // Deliberately identical, and this is the assertion that says so. A rule
    // that answered differently depending on whether a directory was reached
    // through a link would be ADR 0038's mistake in a new place: it would be
    // asking what the entry is rather than what opening it does.
    const linked = await withTables(async ({ tables, elsewhere }) => {
      await symlink(elsewhere, join(tables, 'orders.md'), 'junction')
    })
    const plain = await withTables(async ({ tables }) => {
      await mkdir(join(tables, 'orders.md'))
    })

    expect(lines(plain.diagnostics)).toEqual(lines(linked.diagnostics))
  })

  test('the message names the kind the directory was in', async () => {
    const { diagnostics } = await withTables(async ({ model, elsewhere }) => {
      await mkdir(join(model, 'notes'))
      await symlink(elsewhere, join(model, 'notes', 'why.md'), 'junction')
    })

    expect(lines(diagnostics)).toEqual([
      'notes/why.md error object-not-a-file: `why.md` is a directory rather than a file, so there is no note `why`; a link that resolves to a directory looks exactly like this',
    ])
  })

  test('a link that points at nothing is a read failure, not a shape decision', async () => {
    // `file-unreadable`, the same boundary ADR 0038 drew one level up: the
    // entry was listed and then would not open, which is what that code has
    // always meant. Nothing was decided about what the name is.
    const { diagnostics } = await withTables(async ({ tables, root }) => {
      await symlink(join(root, 'nowhere'), join(tables, 'orders.md'), 'junction')
    })

    expect(diagnostics.map((d) => d.code)).toEqual(['file-unreadable'])
    expect(diagnostics[0]?.message).toContain('ENOENT')
  })

  test("an empty directory whose name is not `.md` is still nobody's business", async () => {
    // The smaller silence, left alone on purpose. `archive` claims to be no
    // object, so neither a real one nor a junctioned one is worth a sentence,
    // exactly as a junctioned `sketches/` at the model root is not. What ADR
    // 0054 later added is that a `.md` file *under* one of these is a claim, so
    // both directories here are empty and that is now load-bearing rather than
    // incidental: `object-in-subdirectory` below is the other half of this.
    const { model, diagnostics } = await withTables(async ({ tables, elsewhere }) => {
      await writeFile(join(tables, 'orders.md'), TABLE_FILE)
      await symlink(elsewhere, join(tables, 'archive'), 'junction')
      await mkdir(join(tables, 'drafts'))
    })

    expect(diagnostics).toEqual([])
    expect(model.tables.map((table) => table.name)).toEqual(['orders'])
  })

  test('an ordinary model is unchanged, dotfiles and all', async () => {
    // The legal cases, asserted beside the new error rather than trusted: a
    // plain file is read, a dotfile is skipped, and neither costs a diagnostic.
    const { model, diagnostics } = await withTables(async ({ tables }) => {
      await writeFile(join(tables, 'orders.md'), TABLE_FILE)
      await writeFile(join(tables, '.orders.md.swp'), 'x')
      await writeFile(join(tables, 'notes.txt'), 'x')
    })

    expect(diagnostics).toEqual([])
    expect(model.tables.map((table) => table.name)).toEqual(['orders'])
  })
})

/**
 * dbmd-z7v. `examples/shop` with its two notes moved into `notes/archive/`
 * printed `8 tables, 0 notes, 1 group, no problems.` and exited 0: two
 * paragraphs of hand-written prose on disk, absent from the model, and the only
 * signal was a count nobody checks against a memory of what the model held.
 *
 * ADR 0054 is the argument. The claim belongs to the `.md` name rather than to
 * the directory, which is what decides both halves of this: a directory with
 * markdown under it is an error, and one without is silent.
 */
describe('an object file one folder too deep', () => {
  test('prose in a subdirectory of notes is an error, not a count nobody reads', async () => {
    const { model, diagnostics } = await withModel({
      'notes/archive/why-invoices-are-never-deleted.md': '---\nkind: note\n---\nProse.\n',
    })

    expect(lines(diagnostics)).toEqual([
      'notes/archive error object-in-subdirectory: `archive/` is a directory inside `notes/`, and dbmd reads only the files directly in `notes/`, so `notes/archive/why-invoices-are-never-deleted.md` is not a note; move the markdown up into `notes/`',
    ])
    expect(model.notes).toEqual([])
  })

  test('the cause is said beside the consequence, not instead of it', async () => {
    // The tables case, which was never silent: a `ref` at the table that is
    // gone already said there is no `tables/orders.md`, which is true and names
    // the consequence. Both facts are true and both are reported, because the
    // one that says a file was skipped is the one nothing else can say.
    //
    // The validator is run here rather than the reader alone, because the two
    // halves of the sentence come from the two halves of `dbmd check`.
    const { model, diagnostics } = await withModel({
      'tables/billing/orders.md': '---\nkind: table\ntable: orders\ncolumns: []\n---\n',
      'tables/shipments.md':
        '---\nkind: table\ntable: shipments\ncolumns:\n  - name: id\n    type: bigint\n    pk: true\n  - name: order_id\n    type: bigint\n    ref: orders.id\n---\n',
    })

    expect([...diagnostics, ...validate(model)].map((d) => d.code)).toEqual([
      'object-in-subdirectory',
      'ref-table-unknown',
    ])
  })

  test('a group in a subdirectory is named, and so is the table that joined it', async () => {
    const { diagnostics } = await withModel({
      'groups/old/warehouse.md': '---\nkind: group\ngroup: warehouse\n---\n',
      'tables/stock_movements.md':
        '---\nkind: table\ntable: stock_movements\ngroup: warehouse\ncolumns: []\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'groups/old error object-in-subdirectory: `old/` is a directory inside `groups/`, and dbmd reads only the files directly in `groups/`, so `groups/old/warehouse.md` is not a group; move the markdown up into `groups/`',
      'tables/stock_movements.md:4 error group-unknown: `group: warehouse` names no file at groups/warehouse.md',
    ])
  })

  test('one error per directory, however deep the markdown is and however much of it there is', async () => {
    // The decision the message shape rests on. A misplaced `node_modules` holds
    // thousands of `.md` files and one of them is enough to make the point, so
    // the diagnostic names the directory and cites the first claim as evidence.
    // First is by name at each level, files before subdirectories, so the
    // sentence is the same on every platform and in every run.
    const { diagnostics } = await withModel({
      'tables/vendor/zzz/README.md': '# zzz\n',
      'tables/vendor/aaa/README.md': '# aaa\n',
      'tables/vendor/2024/q1/orders.md': '---\nkind: table\ntable: orders\ncolumns: []\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/vendor error object-in-subdirectory: `vendor/` is a directory inside `tables/`, and dbmd reads only the files directly in `tables/`, so `tables/vendor/2024/q1/orders.md` is not a table; move the markdown up into `tables/`',
    ])
  })

  test('a directory with no markdown under it says nothing, and neither does a plain file', async () => {
    // What keeps the error affordable. Nobody keeping screenshots or a
    // `schema.sql` beside their tables loses anything, so nothing is lost and
    // nothing is said, which is `unknown-kind-directory`'s reason for being a
    // warning applied where nothing at all is warranted.
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\ncolumns: []\n---\n',
      'tables/screenshots/erd.png': 'not really a png\n',
      'tables/schema.sql': 'select 1;\n',
      'tables/README': 'The billing model.\n',
    })

    expect(diagnostics).toEqual([])
    expect(model.tables.map((table) => table.name)).toEqual(['orders'])
  })

  test('a dot-directory is skipped, markdown and all, which is the way to keep an archive', async () => {
    // The same rule a dot-file has had here since the beginning, and the reason
    // the error needs no flag: a directory dbmd should keep out of is spelled
    // with a leading dot, and a `.git` somebody has put in `tables/` costs
    // nothing.
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\ncolumns: []\n---\n',
      'tables/.git/refs/heads/README.md': '# not a model\n',
      'notes/.archive/old.md': '---\nkind: note\n---\nRetired prose.\n',
    })

    expect(diagnostics).toEqual([])
    expect(model.notes).toEqual([])
  })

  test('a model with no notes directory at all stays silent', async () => {
    // Absent is not the same as wrong, which ADR 0038 already settled one level
    // up. An imported model has no `notes/` and no `groups/`, and a rule that
    // complained about a directory that is not there would fire on every one.
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\ncolumns: []\n---\n',
    })

    expect(diagnostics).toEqual([])
    expect(model.notes).toEqual([])
  })

  test('a subdirectory reached through a link is followed', async () => {
    // A junction is the privilege-free link on Windows, and the case ADR 0038
    // was written about: the entry answers `isDirectory()` false, so a reader
    // that trusted the `Dirent` would be silent here. What is under test is
    // that following it costs one `stat` and finds the claim on the other side.
    const { diagnostics } = await withTables(async ({ tables, elsewhere }) => {
      await writeFile(join(elsewhere, 'orders.md'), TABLE_FILE)
      await symlink(elsewhere, join(tables, 'archive'), 'junction')
    })

    expect(lines(diagnostics)).toEqual([
      'tables/archive error object-in-subdirectory: `archive/` is a directory inside `tables/`, and dbmd reads only the files directly in `tables/`, so `tables/archive/orders.md` is not a table; move the markdown up into `tables/`',
    ])
  })
})

describe('the file name is the identity', () => {
  test('a table key that disagrees with the file name is a diagnostic', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: order\n---\n',
    })

    expect(diagnostics[0]?.code).toBe('name-mismatch')
    expect(location(diagnostics[0]).line).toBe(3)
    expect(model.tables[0]?.name).toBe('orders')
  })

  test('a table with no table key is a diagnostic and still loads', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\n---\n',
    })

    expect(diagnostics[0]?.code).toBe('name-missing')
    expect(model.tables[0]?.name).toBe('orders')
  })
})

describe('the reverse of ref', () => {
  test('every table has an entry, and the edges are sorted', async () => {
    const { model } = await readModel(fixtureModel)

    expect([...model.referencesTo.keys()]).toEqual([
      'coerced',
      'customers',
      'on',
      'order_items',
      'orders',
      'shipments',
    ])
    expect(model.referencesTo.get('orders')).toEqual([
      { from: { table: 'order_items', column: 'order_id' }, to: { table: 'orders', column: 'id' } },
      { from: { table: 'shipments', column: 'order_id' }, to: { table: 'orders', column: 'id' } },
    ])
    expect(model.referencesTo.get('on')).toEqual([])
  })

  test('a ref that is not table.column is a diagnostic and no edge', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: customer_id
    type: uuid
    ref: customers
---
`,
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:7 error ref-malformed: `ref: customers` is not `table.column`',
    ])
    expect(model.tables[0]?.columns[0]?.ref).toBeUndefined()
  })

  test('the last dot separates the column, so a qualified table name survives', async () => {
    const { model } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: customer_id
    type: uuid
    ref: sales.customers.id
---
`,
    })

    expect(model.tables[0]?.columns[0]?.ref).toEqual({ table: 'sales.customers', column: 'id' })
  })
})

/**
 * The two keys that say what the engine does rather than what it holds.
 *
 * They live on the `Ref` rather than beside it, so a model cannot hold an action
 * that is about nothing, and the vocabulary is closed because the standard's is:
 * ADR 0046 is why that is the one place this format checks a word against a list.
 */
describe('on delete and on update', () => {
  test('both are read onto the ref they are written beside', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: customer_id
    type: uuid
    ref: customers.id
    on delete: restrict
    on update: cascade
  - name: address_id
    type: uuid
    ref: addresses.id
---
`,
    })

    expect(lines(diagnostics)).toEqual([])
    expect(model.tables[0]?.columns[0]?.ref).toEqual({
      table: 'customers',
      column: 'id',
      onDelete: 'restrict',
      onUpdate: 'cascade',
    })
    // Absent rather than `no action`: the file did not say, and a catalogue
    // that says `NO ACTION` is making a different statement.
    expect(model.tables[0]?.columns[1]?.ref).toEqual({ table: 'addresses', column: 'id' })
  })

  test('all five are accepted and nothing else is', async () => {
    for (const action of ['no action', 'restrict', 'cascade', 'set null', 'set default']) {
      const { model, diagnostics } = await withModel({
        'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: customer_id
    type: uuid
    ref: customers.id
    on delete: ${action}
---
`,
      })

      expect(lines(diagnostics)).toEqual([])
      expect(model.tables[0]?.columns[0]?.ref?.onDelete).toBe(action)
    }
  })

  test('a word outside the five is an error naming the five, and no action is kept', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: customer_id
    type: uuid
    ref: customers.id
    on delete: banana
---
`,
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:8 error not-in-vocabulary: `on delete: banana` is not a referential ' +
        'action; write one of `no action`, `restrict`, `cascade`, `set null`, `set default`',
    ])
    expect(model.tables[0]?.columns[0]?.ref).toEqual({ table: 'customers', column: 'id' })
    // An error, so the file holds something the object does not, so the writer
    // may not save over it. A warning here would delete the line on the next save.
    expect(model.tables[0]?.complete).toBe(false)
  })

  test('SQL Server spelling is not a second spelling: `setNull` is not one of the five', async () => {
    const { diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: customer_id
    type: uuid
    ref: customers.id
    on delete: setNull
---
`,
    })

    expect(diagnostics.map((d) => d.code)).toEqual(['not-in-vocabulary'])
  })

  test('a value YAML resolved to something other than a string says so', async () => {
    const { diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: customer_id
    type: uuid
    ref: customers.id
    on delete: true
---
`,
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:8 error field-wrong-type: `on delete` must be a string, but YAML read ' +
        '`true` as a boolean; write one of `no action`, `restrict`, `cascade`, `set null`, ' +
        '`set default`',
    ])
  })

  test('an action with no ref is about nothing, and is an error rather than a dropped line', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: status
    type: text
    on delete: cascade
    on update: banana
---
`,
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:7 error field-missing: `on delete` says what happens to this row when ' +
        'the row it points at is deleted, and this column has no `ref:` for it to be about; ' +
        'add the `ref:`, or delete this key',
      'tables/orders.md:8 error field-missing: `on update` says what happens to this row when ' +
        'the key it points at changes, and this column has no `ref:` for it to be about; ' +
        'add the `ref:`, or delete this key',
    ])
    // The vocabulary is not also complained about: without a ref the value
    // cannot matter, and two sentences about one line is how a check stops
    // being read.
    expect(diagnostics.map((d) => d.code)).not.toContain('not-in-vocabulary')
    expect(model.tables[0]?.complete).toBe(false)
  })

  test('a malformed ref is reported once, and the actions do not add a second complaint', async () => {
    const { diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: customer_id
    type: uuid
    ref: customers
    on delete: cascade
---
`,
    })

    expect(diagnostics.map((d) => d.code)).toEqual(['ref-malformed'])
  })
})

describe('group membership is declared by the member', () => {
  test('a group has its members computed and never stores them', async () => {
    const { model } = await readModel(fixtureModel)

    expect(model.groupMembers.get('billing')).toEqual(['order_items', 'orders'])
    const billing = model.groups.find((group) => group.name === 'billing')
    expect(billing).toEqual({
      kind: 'group',
      name: 'billing',
      path: 'groups/billing.md',
      body: billing?.body,
      complete: true,
      label: 'Billing',
      color: 'violet',
    })
  })

  test('an empty group gets an entry rather than disappearing', async () => {
    const { model } = await withModel({ 'groups/billing.md': '---\nkind: group\n---\n' })

    expect(model.groupMembers.get('billing')).toEqual([])
  })

  test('a group that does not exist is a diagnostic, not a new group', async () => {
    const { model, diagnostics } = await readModel(fixtureModel)

    expect(lines(diagnostics)).toContain(
      'tables/shipments.md:12 error group-unknown: `group: shipping` names no file at groups/shipping.md',
    )
    expect(model.groupMembers.has('shipping')).toBe(false)
    // The table itself still loads, and still says what it meant.
    expect(model.tables.find((table) => table.name === 'shipments')?.group).toBe('shipping')
  })

  test('a group file that is there and did not load is not called a file that is not there', async () => {
    const { model, diagnostics } = await withModel({
      'groups/billing.md': 'Renamed from `invoicing`, and not finished.\n',
      'tables/orders.md': '---\nkind: table\ntable: orders\ngroup: billing\n---\n',
    })

    // The group file is refused, so it is not a group, and `group: billing`
    // is not naming nothing: it is naming the file this run has just printed
    // an error about. One mistake, one complaint. ADR 0090.
    expect(diagnostics.map((d) => d.code)).toEqual(['frontmatter-absent'])
    expect(model.refused).toEqual([{ kind: 'group', name: 'billing', path: 'groups/billing.md' }])
    expect(model.groups).toEqual([])
  })

  test('and a `group:` with nothing at that path still says so, which is the common case', async () => {
    const { diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\ngroup: billing\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:4 error group-unknown: `group: billing` names no file at groups/billing.md',
    ])
  })

  test('a group with a layout is told that its box is computed', async () => {
    const { model, diagnostics } = await withModel({
      'groups/billing.md': '---\nkind: group\nlayout: { x: 1, y: 2 }\n---\n',
    })

    expect(diagnostics[0]?.code).toBe('unknown-key')
    expect(diagnostics[0]?.message).toContain('a group has no coordinates')
    expect(model.groups[0]).not.toHaveProperty('layout')
  })
})

describe('layout', () => {
  test('a note keeps w and h', async () => {
    const { model } = await readModel(fixtureModel)

    expect(model.notes[0]?.layout).toEqual({ x: 120, y: 640, w: 320, h: 200 })
    expect(model.notes[0]?.color).toBe('amber')
  })

  test('a table is told that w and h belong to a note', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\nlayout: { x: 1, y: 2, w: 3 }\n---\n',
    })

    expect(diagnostics[0]?.code).toBe('unknown-key')
    expect(diagnostics[0]?.message).toContain('`w` and `h` belong to a note')
    expect(model.tables[0]?.layout).toEqual({ x: 1, y: 2 })
  })

  test('a layout without coordinates is a diagnostic and no layout', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\nlayout: { y: 2 }\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:4 error field-missing: `layout` needs `x`',
    ])
    expect(model.tables[0]?.layout).toBeUndefined()
  })
})

describe('keys that mean nothing', () => {
  test('an unknown key is a warning that lists the known ones', async () => {
    const { diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    unqiue: true
---
`,
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:7 warning unknown-key: `unqiue` means nothing on a column; known keys are default, name, nullable, on delete, on update, pk, ref, type',
    ])
  })

  test('two spellings of the same name are a duplicate, and the first wins', async () => {
    // YAML itself rejects a literally repeated key, and it rejects `on:` against
    // `"on":` as well, because both of those resolve to the same string. The
    // retired `null` key is the case it cannot see: plain `null` resolves to the
    // null value and `"null"` to a string, so the parser thinks they are two
    // keys and dbmd knows they are one. Both complaints below are worth having
    // and neither replaces the other.
    const { model, diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    null: false
    "null": true
---
`,
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:7 error superseded-key: `null` is now `nullable` and means the same thing: write `nullable: false`',
      'tables/orders.md:8 error duplicate-key: `null` is given twice; the first one is used',
    ])
    expect(model.tables[0]?.columns[0]?.nullable).toBeUndefined()
  })
})

/**
 * dbmd-25. `dbmd check` said `no problems` on a table whose every name was
 * `""`, which is the state the studio's `Add column` button writes on disk the
 * moment it is clicked, so the page and the checker disagreed about the same
 * file and the page was right. ADR 0027 is the argument for the severity.
 */
describe('a name that is there and says nothing', () => {
  test('the model that used to pass with no problems now says so, five times', async () => {
    const { diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: ""
    type: ""
indexes:
  - name: ""
    columns: []
---
`,
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:5 warning empty-value: `name` is empty, so this column has no name; name it, or delete the row',
      "tables/orders.md:6 warning empty-value: `type` is empty, so this column has no type; write the engine's own spelling of one",
      'tables/orders.md:8 warning empty-value: `name` is empty, so this index has no name; name it what the database calls it',
      'tables/orders.md:9 warning empty-value: `columns` is empty, so this index covers no columns; list its keys, or delete the index',
    ])
  })

  test('nothing was lost, which is why it is a warning and not an error', async () => {
    // The whole severity argument in one assertion: an error would make the
    // table incomplete, and an incomplete table is one `writeModel` skips and
    // the studio refuses to edit, which would lock the table the moment
    // somebody clicked `Add column`. The reader kept every character.
    const { model } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: ""
    type: ""
---
`,
    })

    expect(model.tables[0]?.complete).toBe(true)
    expect(model.tables[0]?.columns).toEqual([{ name: '', type: '' }])
  })

  test('whitespace is the same mistake wearing a disguise', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: "  "
    type: "\t"
---
`,
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:5 warning empty-value: `name` is only whitespace, so this column has no name; name it, or delete the row',
      "tables/orders.md:6 warning empty-value: `type` is only whitespace, so this column has no type; write the engine's own spelling of one",
    ])
    expect(model.tables[0]?.columns[0]?.name).toBe('  ')
  })

  test('a table whose file name is whitespace has no name either', async () => {
    const { diagnostics } = await withModel({
      'tables/ .md': '---\nkind: table\ntable: " "\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/ .md warning empty-value: the file name is only whitespace, so this table has no name, and the file name is what a `ref` resolves against; rename the file, and its `table:` key with it',
    ])
  })

  test('an index key that is an empty expression is the same code', async () => {
    const { diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
indexes:
  - name: orders_lower_idx
    columns: [{ expression: "" }]
---
`,
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:6 warning empty-value: `expression` is empty, so this index key is neither a column nor an expression; write the SQL, or name a column',
    ])
  })

  test("a table's own `columns: []` is a table nobody has filled in, and is not warned about", async () => {
    // The distinction the rule turns on: an index with no keys is not an index,
    // and no engine would accept one. A table with no columns is a normal thing
    // to have halfway through a morning, and `primary-key-missing` already
    // stands down for it for the same reason.
    const { diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\ncolumns: []\n---\n',
    })

    expect(lines(diagnostics)).toEqual([])
  })

  test('a list that lost its only key is one complaint, not two', async () => {
    // `columns: [123]` is already an error naming the key it dropped, and
    // adding "this index covers no columns" on top of it would be the second
    // complaint about one mistake that ADR 0017 exists to prevent.
    const { diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
indexes:
  - name: orders_idx
    columns: [123]
---
`,
    })

    expect(diagnostics.map((d) => d.code)).toEqual(['field-wrong-type'])
  })
})

describe('_model.md', () => {
  test('its name, engine and prose are the model-wide facts', async () => {
    const { model } = await readModel(fixtureModel)

    expect(model.name).toBe('shop')
    expect(model.engine).toBe('postgres')
    expect(model.body).toContain('The order side of the shop.')
  })

  test('a missing one is a warning and not a failure', async () => {
    const { model, diagnostics } = await withModel(
      { 'tables/orders.md': '---\nkind: table\ntable: orders\n---\n' },
      { modelFile: false },
    )

    expect(lines(diagnostics)).toEqual([
      '_model.md warning model-file-missing: no _model.md, so the model has no name and no engine; ' +
        'add one with `kind: model`, a `name:` and an `engine:`',
    ])
    expect(model.name).toBeUndefined()
    expect(model.tables).toHaveLength(1)
    // A file location, and the other half of ADR 0086's rule: nothing is at
    // this path, so there is no directory to name and the location is where the
    // fix goes. The directory case below takes the opposite kind.
    expect(location(diagnostics[0]).path).toBe('_model.md')
  })

  test('and an empty directory gets the same sentence, unchanged', async () => {
    // The other half of the counterfactual for the directory case below: with
    // `_model.md` genuinely absent, every clause of this warning is true, so it
    // stays exactly as it was.
    const { diagnostics } = await withModel({}, { modelFile: false })

    expect(lines(diagnostics)).toEqual([
      '_model.md warning model-file-missing: no _model.md, so the model has no name and no engine; ' +
        'add one with `kind: model`, a `name:` and an `engine:`',
    ])
  })

  // The warning above names a fix, and a named fix that has quietly stopped
  // working is worse than no advice at all. This writes exactly the three keys
  // the sentence asks for and nothing else, so the advice is checked rather
  // than remembered. dbmd-s22.
  test('the file that warning asks for is one that reads clean', async () => {
    const { model, diagnostics } = await withModel({
      '_model.md': '---\nkind: model\nname: kettleback\nengine: postgres\n---\n',
    })

    expect(diagnostics).toEqual([])
    expect(model.name).toBe('kettleback')
    expect(model.engine).toBe('postgres')
  })

  // The third state the `else` above used to serve. It is not "no _model.md":
  // the name is taken, and the fix the missing-file warning names cannot be
  // followed, because writing a file over a directory fails with `EISDIR`.
  test('one that is a directory says so, and says the opposite fix', async () => {
    const { model, diagnostics } = await withModel(
      { '_model.md/keep.md': 'anything at all\n' },
      { modelFile: false },
    )

    expect(lines(diagnostics)).toEqual([
      '_model.md warning model-file-not-a-file: `_model.md` is a directory rather than a file, ' +
        'so the model has no name and no engine; move it aside, then write `_model.md` with ' +
        '`kind: model`, a `name:` and an `engine:`',
    ])
    expect(model.name).toBeUndefined()
  })

  test('it points at a directory, which is what is at the path', async () => {
    // The opposite side from `model-file-missing` above, which points at a file
    // because nothing is at the path and a file is what has to end up there.
    // Here a directory is at the path and the message is about it, so a file
    // location would have `dbmd check` count a directory as a file. ADR 0086.
    const { diagnostics } = await withModel(
      { '_model.md/keep.md': 'anything at all\n' },
      { modelFile: false },
    )

    expect(directoryLocation(diagnostics[0]).path).toBe('_model.md')
  })

  test('and it is not also told that there is no _model.md', async () => {
    const { diagnostics } = await withModel(
      { '_model.md/keep.md': 'anything at all\n' },
      { modelFile: false },
    )

    // Two consecutive lines, the first saying there is no `_model.md` and the
    // second naming `_model.md/`, is what this used to print.
    expect(diagnostics.map((d) => d.code)).not.toContain('model-file-missing')
    expect(diagnostics.map((d) => d.code)).not.toContain('unknown-kind-directory')
  })

  test('the fix it names is one a developer can actually carry out', async () => {
    // `model-file-missing` says to write the file, and `test/model/read.test.ts`
    // proves that advice works where it is given. This proves the other half:
    // over a directory it does not, which is why the message is different.
    const parent = await mkdtemp(join(tmpdir(), 'dbmd-model-file-'))
    try {
      await mkdir(join(parent, '_model.md'), { recursive: true })
      await expect(writeFile(join(parent, '_model.md'), 'x', 'utf8')).rejects.toMatchObject({
        code: 'EISDIR',
      })
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  test('one that is all prose is all body', async () => {
    const { model, diagnostics } = await withModel({ '_model.md': 'Just the why.\n' })

    expect(diagnostics).toEqual([])
    expect(model.body).toBe('Just the why.\n')
  })
})

describe('never throwing, and always in the same order', () => {
  test('a directory that is not there is a diagnostic', async () => {
    const { model, diagnostics } = await readModel(join(fixtureModel, 'no-such-directory'))

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('model-directory-unreadable')
    // A directory location and not a file one: the thing that could not be read
    // is the model directory, and `dbmd check` counts these by what they say
    // they are. ADR 0086.
    expect(directoryLocation(diagnostics[0]).path).toBe('.')
    // ADR 0006 forbids absolute paths in output, so the message carries the
    // errno and not the path the caller already knows. The words beside it are
    // dbmd's own, for the same reason: `errnoText` in `src/diagnostics.ts`
    // writes them rather than lifting Node's message, which has the path in it.
    // dbmd-f3p, and `test/model/unreadable.test.ts` is the rest of that story.
    expect(diagnostics[0]?.message).toBe(
      'cannot read the model directory: no such file or directory (ENOENT)',
    )
    expect(model.tables).toEqual([])
  })

  test('diagnostics sort by path, then line, and two reads agree', async () => {
    const first = await readModel(fixtureModel)
    const second = await readModel(fixtureModel)

    expect(lines(first.diagnostics)).toEqual(lines(second.diagnostics))
    // Sorted by the comparator rather than by the rendered text: line 8 comes
    // before line 11, which string order gets backwards.
    expect(lines([...first.diagnostics].reverse().sort(compareDiagnostics))).toEqual(
      lines(first.diagnostics),
    )
    expect(first.model.tables.map((table) => table.name)).toEqual([
      'coerced',
      'customers',
      'on',
      'order_items',
      'orders',
      'shipments',
    ])
  })

  test('the whole fixture reads to exactly these diagnostics', async () => {
    const { diagnostics } = await readModel(fixtureModel)

    expect(lines(diagnostics)).toEqual([
      'notes/misfiled.md:2 error kind-mismatch: `kind: table` in a directory of notes; the directory decides, so this file is not loaded',
      'tables/broken-yaml.md:6 error frontmatter-invalid: Sequence item without - indicator',
      'tables/coerced.md:8 error field-wrong-type: `name` must be a string, but YAML read `null` as null; quote it',
      'tables/coerced.md:11 error field-wrong-type: `type` must be a string, but YAML read `true` as a boolean; quote it',
      'tables/coerced.md:14 error field-wrong-type: `default` must be a string, but YAML read `0` as a number; quote it so that it survives as SQL text, and quote it twice if it is a SQL string literal: `default: "\'pending\'"`',
      'tables/coerced.md:15 warning unknown-key: `unqiue` means nothing on a column; known keys are default, name, nullable, on delete, on update, pk, ref, type',
      'tables/empty-frontmatter.md error frontmatter-empty: the frontmatter is empty, so the file declares nothing',
      'tables/no-frontmatter.md error frontmatter-absent: no frontmatter: the file does not start with a `---` line',
      'tables/shipments.md:12 error group-unknown: `group: shipping` names no file at groups/shipping.md',
      'tables/unterminated.md error frontmatter-unterminated: the frontmatter opens with `---` and is never closed by a `---` line',
    ])
  })

  test('a composite primary key is two columns that both say pk', async () => {
    const { model } = await readModel(fixtureModel)
    const items = model.tables.find((table) => table.name === 'order_items')

    expect(
      items?.columns.filter((column) => column.pk === true).map((column) => column.name),
    ).toEqual(['order_id', 'product_id'])
  })

  test('an index keeps its columns in the order it declared them', async () => {
    const { model } = await readModel(fixtureModel)

    expect(model.tables.find((table) => table.name === 'orders')?.indexes).toEqual([
      { name: 'orders_customer_status_idx', columns: ['customer_id', 'status'] },
    ])
  })
})
