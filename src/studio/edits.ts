/**
 * The model the studio is editing, and how an edit reaches the disk.
 *
 * ADR 0004 says the files are the state and every edit writes through, debounced
 * a few hundred milliseconds so a drag is one write rather than sixty. That is
 * three properties, and this file is all three of them.
 *
 * **The model in memory is a cache of the directory, not a second copy of the
 * truth.** After every write it re-reads the directory and adopts what it finds,
 * so what the server serves is what the files say rather than what it hoped it
 * wrote. That is also what keeps `referencesTo` and `groupMembers` honest: they
 * are computed by the reader, and an edit that changed a `ref` or a `group`
 * would otherwise leave them describing the model as it was at startup.
 *
 * **A write it did not have to do is a write it does not do**, and that is two
 * rules rather than one. `writeModel` compares each rendered file with what is
 * on disk and skips a match, which covers a drag that ended where it started.
 * It does not cover the file nobody touched: a model directory written by hand
 * is rarely canonical, so handing `writeModel` the whole model after one drag
 * would rewrite every neighbour into canonical form and put three files in the
 * developer's `git status` next to the one they meant. So the session tracks
 * the files it actually edited and writes only those. Canonicalising the rest
 * is a thing to ask for, not a thing to be given.
 *
 * **A file it could not read is a file it will not write.** An object the reader
 * could not build entirely carries `complete: false` and `writeModel` skips it,
 * which would make an edit to it vanish silently. So an edit to such a table is
 * refused here, out loud, rather than accepted and then dropped one layer down.
 *
 * What is not here is the watcher. A file edited by hand while the studio is
 * running is not noticed until the next flush re-reads, and a flush will write
 * the studio's version over it. That is dbmd-33, and it is the reason the
 * re-read exists here at all rather than being invented there.
 */

import { access, rm } from 'node:fs/promises'
import { readModel } from '../model/read.js'
import { writeModel } from '../model/write.js'
import type { Diagnostic, Model, Table } from '../model/types.js'
import { directoryOfKind } from '../model/paths.js'
import { isSafeSegment, resolveWithin } from './safe-path.js'
import type { TablePatch, WireStatus, WireWrite } from './wire.js'

/**
 * A refusal with the status the HTTP layer should send.
 *
 * The status lives on the error because the reason and the code are the same
 * decision: "that table does not exist" is a 404 wherever it is raised, and
 * choosing the number again at the routing layer is where the two drift apart.
 */
export class EditRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: EditRefusalCode,
    message: string,
  ) {
    super(message)
    this.name = 'EditRefused'
  }
}

export type EditRefusalCode =
  /** The name cannot be a file name inside the model directory. */
  | 'unsafe-name'
  /** No table of that name in the model. */
  | 'unknown-table'
  /** A table of that name is already there, or a file is in its place. */
  | 'table-exists'
  /** The reader could not build the table from its file, so a write would truncate it. */
  | 'incomplete'

export interface EditsOptions {
  /** How long an edit waits for the next one before it is written. ADR 0004. */
  readonly debounceMs?: number
  /** Narration, one line at a time, without the newline. ADR 0006 sends it to stderr. */
  readonly log?: (message: string) => void
}

/** A few hundred milliseconds: long enough to swallow a drag, short enough to feel saved. */
const DEFAULT_DEBOUNCE_MS = 250

export class Edits {
  private model: Model
  private diagnostics: readonly Diagnostic[]
  /** The files this session has edited, as `writeModel` names them. Empty means idle. */
  private edited = new Set<string>()
  private timer: NodeJS.Timeout | undefined
  private last: WireWrite | null = null
  private failure: string | null = null
  /** Flushes run one at a time, so a timer firing during a close cannot interleave. */
  private queue: Promise<void> = Promise.resolve()

  private constructor(
    readonly dir: string,
    private readonly debounceMs: number,
    private readonly log: (message: string) => void,
    read: { model: Model; diagnostics: readonly Diagnostic[] },
  ) {
    this.model = read.model
    this.diagnostics = read.diagnostics
  }

  static async open(dir: string, options: EditsOptions = {}): Promise<Edits> {
    const read = await readModel(dir)
    return new Edits(
      dir,
      options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      options.log ?? (() => {}),
      read,
    )
  }

  snapshot(): { model: Model; diagnostics: readonly Diagnostic[] } {
    return { model: this.model, diagnostics: this.diagnostics }
  }

  status(): WireStatus {
    return { lastWrite: this.last, pendingWrite: this.edited.size > 0, writeError: this.failure }
  }

  table(name: string): Table {
    // For its refusal rather than for its answer: a name that cannot resolve to
    // a file inside the model directory is refused before it is looked up, so
    // every route gets the same containment check in the same words.
    this.fileFor(name)
    const found = this.model.tables.find((table) => table.name === name)
    if (found === undefined) {
      throw new EditRefused(404, 'unknown-table', `no table called \`${name}\` in this model`)
    }
    return found
  }

  /**
   * Apply an edit and schedule the write. Returns the table as it now stands,
   * which is what the client should show even though the file is not written
   * yet: the write is deferred, the edit is not.
   */
  patchTable(name: string, patch: TablePatch): Table {
    const current = this.table(name)
    if (!current.complete) {
      throw new EditRefused(
        409,
        'incomplete',
        `\`${current.path}\` did not parse, so this server is holding less than the file does; writing it back would delete the part it could not read. Fix the file and reload`,
      )
    }
    const next = applyPatch(current, patch)
    this.model = { ...this.model, tables: replace(this.model.tables, next) }
    this.schedule(fileOf(name))
    return next
  }

  /**
   * Add a table. Written immediately rather than debounced: creating a file is a
   * deliberate act, and a client that just made one wants it in `git status`.
   */
  async addTable(name: string, patch: TablePatch): Promise<Table> {
    const target = this.fileFor(name)
    if (this.model.tables.some((table) => table.name === name)) {
      throw new EditRefused(409, 'table-exists', `there is already a table called \`${name}\``)
    }
    const created = applyPatch(
      {
        kind: 'table',
        name,
        path: fileOf(name),
        // The blank line the format conventionally puts after the closing `---`
        // belongs to the body, and `writeModel` concatenates rather than pads.
        body: '\n',
        complete: true,
        columns: [],
        indexes: [],
      },
      patch,
    )
    // A file with no table in the model is a file the reader could not parse
    // (ADR 0008 leaves it out rather than guessing), and writing over it would
    // destroy the thing whose problem the developer is trying to see.
    if (await exists(target)) {
      throw new EditRefused(
        409,
        'table-exists',
        `\`${created.path}\` is already a file, and it is not in the model, which means it did not parse. Fix or delete it rather than writing over it`,
      )
    }
    this.model = { ...this.model, tables: sortByName([...this.model.tables, created]) }
    this.edited.add(fileOf(name))
    await this.flush()
    return created
  }

  /**
   * Remove a table and its file. `writeModel` never deletes, deliberately, so
   * this is the only place in the project that does, and it goes through the
   * same containment check as every other path here.
   */
  async removeTable(name: string): Promise<void> {
    this.table(name)
    const target = this.fileFor(name)
    // Anything already queued is written first, in order, so a pending edit to
    // this table cannot land after the file is gone and recreate it.
    await this.flush()
    this.model = {
      ...this.model,
      tables: this.model.tables.filter((table) => table.name !== name),
    }
    await rm(target, { force: true })
    this.log(`removed ${fileOf(name)}`)
    await this.refresh()
  }

  /** Write anything pending, now, and re-read. Idempotent when nothing is pending. */
  async flush(): Promise<void> {
    this.clearTimer()
    await this.serialise(async () => {
      if (this.edited.size > 0) await this.write()
      await this.adopt()
    })
  }

  /** Stop the timer and land whatever it was waiting to write. */
  async close(): Promise<void> {
    await this.flush()
  }

  // ------------------------------------------------------------------------

  private fileFor(name: string): string {
    const target = resolveWithin(this.dir, directoryOfKind('table'), `${name}.md`)
    // Both checks, in this order, because they refuse different things: the
    // first says the name is not one path segment, the second says the resolved
    // path is not inside the model directory. See `safe-path.ts`.
    if (!isSafeSegment(name) || target === undefined) {
      throw new EditRefused(
        400,
        'unsafe-name',
        `refusing \`${name}\`: a table name has to be one file name inside the model directory, and this one resolves outside it or is not a name a file can have`,
      )
    }
    return target
  }

  private schedule(file: string): void {
    this.edited.add(file)
    // Trailing debounce: every edit pushes the write out, so a drag writes once
    // when it stops rather than once per frame.
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, this.debounceMs)
    // A pending write must not be the reason the process stays alive; the
    // listening socket already is, and `close` flushes before it goes.
    this.timer.unref()
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private serialise(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => {})
    return next
  }

  private async write(): Promise<void> {
    // Taken before the write rather than after, so an edit that arrives while it
    // is in flight lands in the next set and gets its own flush.
    const only = this.edited
    this.edited = new Set()
    try {
      const result = await writeModel(this.dir, this.model, { only })
      this.failure = null
      if (result.written.length > 0) {
        this.last = { at: new Date().toISOString(), paths: result.written }
        this.log(`wrote ${result.written.join(', ')}`)
      }
    } catch (error) {
      // The edit is still in memory, so the files go back in the set and the
      // next flush retries. Saying nothing here is the failure the writer's own
      // notes warn about: telling the developer their work is saved when it is
      // not.
      for (const file of only) this.edited.add(file)
      this.failure = error instanceof Error ? error.message : String(error)
      this.log(`write failed: ${this.failure}`)
    }
  }

  private async adopt(): Promise<void> {
    const read = await readModel(this.dir)
    // An edit that arrived while the directory was being read is newer than
    // what the read found, so the read is dropped rather than overwriting it.
    if (this.edited.size > 0) return
    this.model = read.model
    this.diagnostics = read.diagnostics
  }

  private async refresh(): Promise<void> {
    await this.serialise(() => this.adopt())
  }
}

/** Where a table's file is, in the words `writeModel` uses for it. */
function fileOf(name: string): string {
  return `${directoryOfKind('table')}/${name}.md`
}

function applyPatch(table: Table, patch: TablePatch): Table {
  const next: {
    -readonly [K in keyof Table]: Table[K]
  } = { ...table }
  if (patch.columns !== undefined) next.columns = patch.columns
  if (patch.indexes !== undefined) next.indexes = patch.indexes
  if (patch.body !== undefined) next.body = patch.body
  if (patch.layout !== undefined) {
    if (patch.layout === null) delete next.layout
    else next.layout = patch.layout
  }
  if (patch.group !== undefined) {
    if (patch.group === null) delete next.group
    else next.group = patch.group
  }
  return next
}

function replace(tables: readonly Table[], next: Table): readonly Table[] {
  return tables.map((table) => (table.name === next.name ? next : table))
}

/** The reader sorts, so a model that gained a table keeps the same order it would on reload. */
function sortByName(tables: readonly Table[]): readonly Table[] {
  return [...tables].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}
