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
 * ADR 0019 added the fourth, and it is the one that is easy to get wrong:
 *
 * **A file that changed on disk since the session read it is a file the session
 * will not write.** The check is `readModel` immediately before the write, and
 * it compares what the disk says now with what the session adopted, per file.
 * It is deliberately not the watcher's job. The watcher is a live update and
 * `fs.watch` is allowed to be late, to coalesce, or to be unsupported; the
 * refusal has to hold anyway, because the window it closes is the debounce
 * itself. A refused write is dropped rather than retried, the disk's version is
 * adopted in its place, and the refusal is reported on the status until the
 * studio successfully writes that file again. ADR 0019 argues why losing the
 * drag is the right way round.
 *
 * ADR 0025 added the fifth, and it is the half ADR 0019 thought was cosmetic:
 *
 * **An edit made against a model this session no longer holds is refused before
 * it is applied.** The check above compares the disk with the session; this one
 * compares the session with the caller. They are different questions and the
 * first cannot answer the second: with nothing pending, `absorb` correctly
 * adopts a hand edit, so by the time a stale page's `PATCH` arrives the
 * session's baseline already matches the disk and the write is correctly
 * allowed. What is stale is the caller. So every mutation names the `revision`
 * it was made against and is refused when that is not the revision this session
 * is on, which is a refusal the caller gets on the request rather than at the
 * flush, and is therefore one a multi-step edit can stop on.
 *
 * The three are separable and are separately testable: the watcher never writes
 * and never refuses, the write-time refusal never needs the watcher to have
 * fired, and the staleness check needs neither of them.
 */

import { access, rm } from 'node:fs/promises'
import { readModel } from '../model/read.js'
import { serialiseModelFile, serialiseObject, writeModel } from '../model/write.js'
import type {
  CanvasObject,
  Diagnostic,
  Group,
  Model,
  Note,
  ObjectKind,
  ReadResult,
  Table,
} from '../model/types.js'
import { MODEL_FILE, directoryOfKind } from '../model/paths.js'
import { isSafeSegment, resolveWithin } from './safe-path.js'
import { ModelWatcher } from './watch.js'
import type {
  GroupPatch,
  NotePatch,
  TablePatch,
  WireConflict,
  WireStatus,
  WireWrite,
} from './wire.js'

/** The three kinds, in the order a model lists them, for a loop over all of them. */
const KINDS: readonly ObjectKind[] = ['table', 'note', 'group']

/** Which type each kind names, so an edit keeps its type through the round trip. */
interface ObjectByKind {
  readonly table: Table
  readonly note: Note
  readonly group: Group
}

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
  /** No object of that kind and name in the model. */
  | 'unknown-table'
  | 'unknown-note'
  | 'unknown-group'
  /** One of that kind and name is already there, or a file is in its place. */
  | 'table-exists'
  | 'note-exists'
  | 'group-exists'
  /** The reader could not build the table from its file, so a write would truncate it. */
  | 'incomplete'
  /** The file changed on disk since the session read it, so acting on it would lose that change. */
  | 'conflicted'
  /** The edit names a revision this session has moved on from, so it was made against a model that is gone. */
  | 'stale'

export interface EditsOptions {
  /** How long an edit waits for the next one before it is written. ADR 0004. */
  readonly debounceMs?: number
  /** How long a burst of filesystem events is collected before one re-read. ADR 0019. */
  readonly watchDebounceMs?: number
  /**
   * Watch the model directory for changes made outside the studio. On by
   * default: it is the live update ADR 0004 promised. A test that wants to
   * prove the write-time refusal holds without it turns it off.
   */
  readonly watch?: boolean
  /** Narration, one line at a time, without the newline. ADR 0006 sends it to stderr. */
  readonly log?: (message: string) => void
}

/** A few hundred milliseconds: long enough to swallow a drag, short enough to feel saved. */
const DEFAULT_DEBOUNCE_MS = 250

export class Edits {
  /** What the session serves: the disk as it last read it, plus its own unwritten edits. */
  private model: Model
  private diagnostics: readonly Diagnostic[]
  /**
   * The disk as the session last read it, with none of its own edits in it.
   *
   * This is the baseline the write-time check compares against, and it is a
   * second field rather than a recomputation because `model` is mutated by
   * every patch and the question "did this file change underneath us" needs the
   * version the edit was made against, not the edited one.
   */
  private adopted: ReadResult
  /** A fingerprint of what is being served, so a re-read that changed nothing is not a change. */
  private print: string
  /**
   * The same, of the objects alone, which is what `revision` counts.
   *
   * Two strings rather than one because a re-read answers two questions and
   * they have different answers: "is there anything new to serve", which
   * diagnostics are part of, and "could an edit made against the old picture
   * lose something", which they are not. See `fingerprint`.
   */
  private shape: string
  /** The files this session has edited and has not written yet. Empty means idle. */
  private edited = new Set<string>()
  /** The files a write is in flight for. Empty except inside `write`. */
  private writing = new Set<string>()
  /** Writes refused because the file moved underneath them, keyed by path. */
  private readonly refusals = new Map<string, WireConflict>()
  private timer: NodeJS.Timeout | undefined
  private last: WireWrite | null = null
  private failure: string | null = null
  /** Bumped whenever a re-read changed what is served. The client's cue to redraw. */
  private revision = 0
  private watcher: ModelWatcher | undefined
  /** Flushes run one at a time, so a timer firing during a close cannot interleave. */
  private queue: Promise<void> = Promise.resolve()

  private constructor(
    readonly dir: string,
    private readonly debounceMs: number,
    private readonly log: (message: string) => void,
    read: ReadResult,
  ) {
    this.model = read.model
    this.diagnostics = read.diagnostics
    this.adopted = read
    this.print = fingerprint(read.model, read.diagnostics)
    this.shape = shapeOf(read.model)
  }

  /** Take note of what is now being served, after this session changed it itself. */
  private restate(): void {
    this.print = fingerprint(this.model, this.diagnostics)
    this.shape = shapeOf(this.model)
  }

  static async open(dir: string, options: EditsOptions = {}): Promise<Edits> {
    const read = await readModel(dir)
    const edits = new Edits(
      dir,
      options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      options.log ?? (() => {}),
      read,
    )
    if (options.watch ?? true) {
      edits.watcher = ModelWatcher.open(dir, () => void edits.reload(), {
        ...(options.watchDebounceMs === undefined ? {} : { debounceMs: options.watchDebounceMs }),
        log: edits.log,
      })
    }
    return edits
  }

  snapshot(): { model: Model; diagnostics: readonly Diagnostic[] } {
    return { model: this.model, diagnostics: this.diagnostics }
  }

  status(): WireStatus {
    return {
      lastWrite: this.last,
      pendingWrite: this.edited.size > 0,
      writeError: this.failure,
      // Sorted, because ADR 0006 wants the same request to produce the same
      // bytes and a Map's order is insertion order.
      conflicts: [...this.refusals.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
      revision: this.revision,
    }
  }

  /**
   * One object on the canvas, whatever kind it is.
   *
   * Kinds are looked up rather than dispatched to three methods because
   * everything below this line treats them identically: the same containment
   * check, the same conflict check, the same debounced write of the same shape
   * of file. ADR 0005 put a directory per kind precisely so that the difference
   * between a note and a table is a directory name and a set of keys, and this
   * is that sentence in the server.
   */
  object<K extends ObjectKind>(kind: K, name: string): ObjectByKind[K] {
    // For its refusal rather than for its answer: a name that cannot resolve to
    // a file inside the model directory is refused before it is looked up, so
    // every route gets the same containment check in the same words.
    this.fileFor(kind, name)
    const found = objectsOfKind(this.model, kind).find((object) => object.name === name)
    if (found === undefined) {
      throw new EditRefused(404, `unknown-${kind}`, `no ${kind} called \`${name}\` in this model`)
    }
    return found as ObjectByKind[K]
  }

  table(name: string): Table {
    return this.object('table', name)
  }

  /**
   * Refuse an edit made against a model this session has moved on from.
   *
   * The whole of ADR 0025, and it is three lines because `revision` was already
   * the right number: it counts the times a re-read found something the session
   * did not already know, and an edit that names an earlier one is by
   * construction an edit made against a version of the files that is gone.
   *
   * It is deliberately model-wide rather than per file. The page draws one
   * picture from one read, and a `columns` array it is about to send back was
   * computed from all of it; narrowing this to the file being written would
   * pass exactly the case where a rename moved a `ref` into a neighbour.
   */
  private requireCurrent(base: number, what: string): void {
    if (base === this.revision) return
    throw new EditRefused(
      409,
      'stale',
      `${what} names revision ${base} and this studio is on revision ${this.revision}, so it was made ` +
        `against a model that is no longer what the files say. Nothing was written. Read /api/model ` +
        `again and make the edit on top of what it says now`,
    )
  }

  /**
   * Apply an edit and schedule the write. Returns the table as it now stands,
   * which is what the client should show even though the file is not written
   * yet: the write is deferred, the edit is not.
   */
  patchTable(name: string, patch: TablePatch, base: number): Table {
    return this.patchObject('table', name, base, (table) => applyTablePatch(table, patch))
  }

  patchNote(name: string, patch: NotePatch, base: number): Note {
    return this.patchObject('note', name, base, (note) => applyNotePatch(note, patch))
  }

  patchGroup(name: string, patch: GroupPatch, base: number): Group {
    return this.patchObject('group', name, base, (group) => applyGroupPatch(group, patch))
  }

  private patchObject<K extends ObjectKind>(
    kind: K,
    name: string,
    base: number,
    apply: (current: ObjectByKind[K]) => ObjectByKind[K],
  ): ObjectByKind[K] {
    this.requireCurrent(base, 'this patch')
    const current = this.object(kind, name)
    if (!current.complete) {
      throw new EditRefused(
        409,
        'incomplete',
        `\`${current.path}\` did not parse, so this server is holding less than the file does; writing it back would delete the part it could not read. Fix the file and reload`,
      )
    }
    const next = apply(current)
    this.model = withObject(this.model, kind, next)
    // The session's own edit is folded into what it knows it is serving, so
    // that reading it back off the disk afterwards is not a change. `revision`
    // answers "did something happen that I did not ask for", and a client that
    // was told to redraw after every one of its own drags would be told to
    // redraw sixty times a second.
    this.restate()
    this.schedule(fileOf(kind, name))
    return next
  }

  /**
   * Add a table. Written immediately rather than debounced: creating a file is a
   * deliberate act, and a client that just made one wants it in `git status`.
   */
  async addTable(name: string, patch: TablePatch, base: number): Promise<Table> {
    return this.addObject('table', name, base, (blank) => applyTablePatch(blank, patch))
  }

  async addNote(name: string, patch: NotePatch, base: number): Promise<Note> {
    return this.addObject('note', name, base, (blank) => applyNotePatch(blank, patch))
  }

  /**
   * Add a group.
   *
   * Nothing joins it here, and that is the format rather than an omission: a
   * table declares its own membership with one line in its own file, so a group
   * is born empty and the tables join it one `PATCH /api/table/:name` at a time.
   * `dbmd check` reports the empty group in the meantime, which is exactly the
   * warning it exists for.
   */
  async addGroup(name: string, patch: GroupPatch, base: number): Promise<Group> {
    return this.addObject('group', name, base, (blank) => applyGroupPatch(blank, patch))
  }

  private async addObject<K extends ObjectKind>(
    kind: K,
    name: string,
    base: number,
    apply: (blank: ObjectByKind[K]) => ObjectByKind[K],
  ): Promise<ObjectByKind[K]> {
    this.requireCurrent(base, 'this create')
    const target = this.fileFor(kind, name)
    if (objectsOfKind(this.model, kind).some((object) => object.name === name)) {
      throw new EditRefused(409, `${kind}-exists`, `there is already a ${kind} called \`${name}\``)
    }
    const created = apply(blankObject(kind, name) as ObjectByKind[K])
    // A file with no object in the model is a file the reader could not parse
    // (ADR 0008 leaves it out rather than guessing), and writing over it would
    // destroy the thing whose problem the developer is trying to see.
    if (await exists(target)) {
      throw new EditRefused(
        409,
        `${kind}-exists`,
        `\`${created.path}\` is already a file, and it is not in the model, which means it did not parse. Fix or delete it rather than writing over it`,
      )
    }
    this.model = withAdded(this.model, kind, created)
    this.restate()
    this.edited.add(fileOf(kind, name))
    await this.flush()
    return created
  }

  /**
   * Remove an object and its file. `writeModel` never deletes, deliberately, so
   * this is the only place in the project that does, and it goes through the
   * same containment check as every other path here.
   *
   * A group is removed the same way as anything else and nothing is cascaded.
   * A table that still says `group: billing` after `groups/billing.md` has gone
   * is a `group-unknown` error from the reader, which is the studio saying what
   * happened rather than quietly editing files the developer did not name. The
   * mirror case matters more and is the same rule: removing the last table in a
   * group leaves an empty group file, and `dbmd check` warns about it rather
   * than the studio deleting somebody's prose on their behalf (ADR 0005).
   */
  async removeObject(kind: ObjectKind, name: string, base: number): Promise<void> {
    this.requireCurrent(base, 'this delete')
    this.object(kind, name)
    const target = this.fileFor(kind, name)
    const path = fileOf(kind, name)
    // The same check a write gets, for the same reason and more so: deleting a
    // file somebody has just been typing into is the one thing here that `git
    // checkout` cannot undo if the file was never committed.
    //
    // Before the flush rather than inside it, because a flush re-reads and
    // would quietly make the change on disk the new baseline, which is the
    // shape the whole defect had.
    const disk = await readModel(this.dir)
    if (renderOf(disk.model, path) !== renderOf(this.adopted.model, path)) {
      await this.serialise(() => this.absorb(disk))
      throw new EditRefused(409, 'conflicted', changedUnderneath(path, 'deleting it'))
    }
    // Anything already queued is written first, in order, so a pending edit to
    // this table cannot land after the file is gone and recreate it.
    await this.flush()
    // And asked again afterwards, because that flush is allowed to discover a
    // refusal, which moves the revision. A delete is the last step of the
    // inspector's rename (ADR 0016), and the whole of dbmd-39 is that it ran
    // anyway after one of the earlier steps had been refused. The caller
    // pointed at a model; if landing what it had already asked for changed that
    // model, this is a different delete from the one it asked for.
    this.requireCurrent(base, 'this delete')
    await this.serialise(async () => {
      this.model = withoutObject(this.model, kind, name)
      this.restate()
      await rm(target, { force: true })
      this.log(`removed ${path}`)
      await this.adopt()
    })
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
    this.watcher?.close()
    this.watcher = undefined
    await this.flush()
  }

  // ------------------------------------------------------------------------

  private fileFor(kind: ObjectKind, name: string): string {
    const target = resolveWithin(this.dir, directoryOfKind(kind), `${name}.md`)
    // Both checks, in this order, because they refuse different things: the
    // first says the name is not one path segment, the second says the resolved
    // path is not inside the model directory. See `safe-path.ts`.
    if (!isSafeSegment(name) || target === undefined) {
      throw new EditRefused(
        400,
        'unsafe-name',
        `refusing \`${name}\`: a ${kind} name has to be one file name inside the model directory, and this one resolves outside it or is not a name a file can have`,
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
    this.writing = this.edited
    this.edited = new Set()
    try {
      // The disk as it is right now, not as the session last saw it. This is
      // the whole of ADR 0019's refusal: an edit can be a few hundred
      // milliseconds old by the time its timer fires, and the file it is about
      // to replace may have been saved by an editor inside that window.
      const disk = await readModel(this.dir)
      const refused = [...this.writing].filter(
        (path) => renderOf(disk.model, path) !== renderOf(this.adopted.model, path),
      )
      for (const path of refused) {
        this.writing.delete(path)
        this.refusals.set(path, {
          path,
          at: new Date().toISOString(),
          message: changedUnderneath(path, 'writing over it'),
        })
        this.log(`refused to write ${path}: it changed on disk since the studio read it`)
      }
      // The disk's version replaces the refused edit rather than sitting beside
      // it. ADR 0004 says there is no state but the files, and a rejected edit
      // kept in memory would be exactly that second state: the next flush would
      // find the disk matching its baseline again and write it after all.
      if (refused.length > 0) await this.absorb(disk)

      if (this.writing.size === 0) return
      try {
        const result = await writeModel(this.dir, this.model, { only: this.writing })
        this.failure = null
        if (result.written.length > 0) {
          this.last = { at: new Date().toISOString(), paths: result.written }
          this.log(`wrote ${result.written.join(', ')}`)
        }
        // A file the studio has just written is a file it has caught up with,
        // so the refusal that was standing against it has been answered.
        for (const path of result.written) this.refusals.delete(path)
      } catch (error) {
        // The edit is still in memory, so the files go back in the set and the
        // next flush retries. Saying nothing here is the failure the writer's own
        // notes warn about: telling the developer their work is saved when it is
        // not.
        for (const file of this.writing) this.edited.add(file)
        this.failure = error instanceof Error ? error.message : String(error)
        this.log(`write failed: ${this.failure}`)
      }
    } finally {
      this.writing = new Set()
    }
  }

  private async adopt(): Promise<void> {
    await this.absorb(await readModel(this.dir))
  }

  /**
   * Take a fresh read as the truth, keeping only the edits not written yet.
   *
   * The previous version of this dropped a read outright when an edit had
   * arrived while it was in flight, which was right about the edit and wrong
   * about every other file: a hand edit to `customers.md` was thrown away
   * because a drag of `orders` was pending. Keeping the pending files from
   * memory and taking the rest from disk is the same protection, per file.
   */
  private async absorb(read: ReadResult): Promise<void> {
    const pending = pendingNames([...this.edited, ...this.writing])
    // The baseline for a file with an unwritten edit stays frozen at what the
    // disk said when that edit was made. Taking the fresh read for it would be
    // the whole defect back again: a reload triggered by the hand edit would
    // quietly make the hand edit the thing the pending write is "unchanged"
    // against, and the write would go through and delete it.
    const baseline = keeping(read.model, this.adopted.model, pending)
    // `carryForward` reads the model being replaced, so it has to run before
    // that model is replaced.
    const served = keeping(await this.carryForward(read.model), this.model, pending)
    this.adopted = { model: baseline, diagnostics: read.diagnostics }
    this.model = served
    this.diagnostics = read.diagnostics
    const print = fingerprint(this.model, this.diagnostics)
    if (print === this.print) return
    this.print = print
    // Something is new to serve. Whether it is new to *edit against* is the
    // second question, and only that one moves the revision: a change that
    // leaves every object saying what the session already says cannot make an
    // edit made against the old picture lose anything.
    const shape = shapeOf(this.model)
    if (shape === this.shape) return
    this.shape = shape
    this.revision += 1
  }

  /**
   * The watcher's whole effect: look again, and adopt if anything moved.
   *
   * It never writes and never refuses. A wake-up caused by the studio's own
   * save re-reads a directory that says what the session already says, the
   * fingerprint matches, and nothing happens; that is what keeps a write from
   * bouncing back as an external change without needing to remember what was
   * written.
   */
  private async reload(): Promise<void> {
    await this.serialise(async () => {
      const read = await readModel(this.dir)
      if (fingerprint(read.model, read.diagnostics) === this.print) return
      const before = this.revision
      await this.absorb(read)
      if (this.revision !== before) this.log('reloaded: the model changed on disk')
    })
  }

  /**
   * Objects the reader no longer produces, kept as they last were.
   *
   * ADR 0004: a hand edit that is invalid mid-keystroke will be seen by the
   * watcher, and the studio reports the parse failure and keeps showing the
   * last good version rather than emptying the canvas. A file halfway through
   * being typed is the ordinary state of a file, not a deletion, and the two
   * are told apart by asking whether the file is still there. A table whose
   * file is gone is gone; a table whose file is there and no longer parses is
   * kept.
   *
   * The kept object is marked incomplete, which is what it now is: the reader
   * could not build it from its file. That is not cosmetic. It is the flag
   * `writeModel` skips on and the flag `patchObject` refuses on, so an object
   * shown from memory cannot be written back over the file it no longer
   * matches.
   */
  private async carryForward(fresh: Model): Promise<Model> {
    let model = fresh
    for (const kind of KINDS) {
      const arrived = objectsOfKind(fresh, kind)
      const names = new Set(arrived.map((object) => object.name))
      const missing = objectsOfKind(this.model, kind).filter((object) => !names.has(object.name))
      if (missing.length === 0) continue
      const carried: CanvasObject[] = []
      for (const object of missing) {
        // Only ever a handful, and only when something has stopped parsing, so
        // this costs nothing in the case that happens every keystroke.
        const target = resolveWithin(this.dir, ...object.path.split('/'))
        if (target !== undefined && (await exists(target))) {
          carried.push({ ...object, complete: false })
        }
      }
      if (carried.length === 0) continue
      model = withObjectsOfKind(model, kind, sortByName([...arrived, ...carried]))
    }
    return model
  }
}

// --------------------------------------------------------------------------
// The three object lists, reached by kind.
//
// A `Model` names them separately because a caller nearly always wants one of
// them, and everything in this file wants whichever one a request named. These
// four functions are the whole of the translation, in one place, so that adding
// a fourth kind (ADR 0005 expects some) is a case here rather than a search.
// --------------------------------------------------------------------------

function objectsOfKind(model: Model, kind: ObjectKind): readonly CanvasObject[] {
  switch (kind) {
    case 'table':
      return model.tables
    case 'note':
      return model.notes
    case 'group':
      return model.groups
  }
}

function withObjectsOfKind(
  model: Model,
  kind: ObjectKind,
  objects: readonly CanvasObject[],
): Model {
  switch (kind) {
    case 'table':
      return { ...model, tables: objects as readonly Table[] }
    case 'note':
      return { ...model, notes: objects as readonly Note[] }
    case 'group':
      return { ...model, groups: objects as readonly Group[] }
  }
}

/** The model with one object replaced by an edited version of itself. */
function withObject(model: Model, kind: ObjectKind, next: CanvasObject): Model {
  return withObjectsOfKind(
    model,
    kind,
    objectsOfKind(model, kind).map((object) => (object.name === next.name ? next : object)),
  )
}

/** The model with one object added, in the order the reader would have read it. */
function withAdded(model: Model, kind: ObjectKind, created: CanvasObject): Model {
  return withObjectsOfKind(model, kind, sortByName([...objectsOfKind(model, kind), created]))
}

function withoutObject(model: Model, kind: ObjectKind, name: string): Model {
  return withObjectsOfKind(
    model,
    kind,
    objectsOfKind(model, kind).filter((object) => object.name !== name),
  )
}

/** The empty object a create starts from, before the patch is applied to it. */
function blankObject(kind: ObjectKind, name: string): CanvasObject {
  const shared = {
    name,
    path: fileOf(kind, name),
    // The blank line the format conventionally puts after the closing `---`
    // belongs to the body, and `writeModel` concatenates rather than pads.
    body: '\n',
    complete: true as const,
  }
  switch (kind) {
    case 'table':
      return { kind, ...shared, columns: [], indexes: [] }
    case 'note':
      return { kind, ...shared }
    case 'group':
      return { kind, ...shared }
  }
}

/**
 * `fresh`, with the named tables taken from `held` instead of from it.
 *
 * The one operation both halves of a re-read need, and they need it for
 * opposite-looking reasons that are the same reason. What is served keeps the
 * unwritten edit, because throwing away a developer's drag because somebody
 * saved an unrelated file would be its own kind of losing work. What the write
 * compares against keeps the pre-edit version, because the question it asks is
 * "has this file moved since the edit was made", and refreshing the baseline
 * from a disk that had already moved is how that question quietly answers no.
 */
function keeping(fresh: Model, held: Model, names: PendingNames): Model {
  let model = fresh
  for (const kind of KINDS) {
    const pending = names.get(kind)
    if (pending === undefined || pending.size === 0) continue
    model = withObjectsOfKind(
      model,
      kind,
      sortByName([
        ...objectsOfKind(fresh, kind).filter((object) => !pending.has(object.name)),
        ...objectsOfKind(held, kind).filter((object) => pending.has(object.name)),
      ]),
    )
  }
  return model
}

/** Where an object's file is, in the words `writeModel` uses for it. */
function fileOf(kind: ObjectKind, name: string): string {
  return `${directoryOfKind(kind)}/${name}.md`
}

/** The names with an unwritten edit, by kind, which is what `keeping` asks about. */
type PendingNames = ReadonlyMap<ObjectKind, ReadonlySet<string>>

function pendingNames(paths: readonly string[]): PendingNames {
  const pending = new Map<ObjectKind, Set<string>>()
  for (const path of paths) {
    const named = objectAt(path)
    if (named === undefined) continue
    const held = pending.get(named.kind) ?? new Set<string>()
    held.add(named.name)
    pending.set(named.kind, held)
  }
  return pending
}

/**
 * The object a `tables/x.md` or `notes/x.md` path names, or `undefined` when it
 * names something else, `_model.md` included.
 */
function objectAt(path: string): { kind: ObjectKind; name: string } | undefined {
  if (!path.endsWith('.md')) return undefined
  for (const kind of KINDS) {
    const prefix = `${directoryOfKind(kind)}/`
    if (!path.startsWith(prefix)) continue
    return { kind, name: path.slice(prefix.length, -'.md'.length) }
  }
  return undefined
}

/**
 * What one file of a model says, as canonical text, or `undefined` for a file
 * the model has no object for.
 *
 * Canonical text rather than the bytes on disk, because a hand-written model is
 * rarely canonical and comparing bytes would call every file a conflict. Both
 * sides of every comparison go through this, so what is being compared is what
 * the two versions of the file *mean*, which is the question worth asking: a
 * developer who retyped `'pending'` as `"pending"` has not changed the model
 * and should not have their drag refused for it.
 */
function renderOf(model: Model, path: string): string | undefined {
  if (path === MODEL_FILE) return serialiseModelFile(model)
  const objects: readonly CanvasObject[] = [...model.tables, ...model.notes, ...model.groups]
  for (const object of objects) {
    if (`${directoryOfKind(object.kind)}/${object.name}.md` !== path) continue
    return renderObject(object)
  }
  return undefined
}

/**
 * An object as canonical text, with whether the reader managed to read all of
 * it folded in.
 *
 * The flag has to be part of it. An object the reader could not fully build
 * renders to less than its file holds, so a file being typed into can render
 * identically to the last version that parsed, and a comparison that only saw
 * the text would call the two the same file.
 */
function renderObject(object: CanvasObject): string {
  return object.complete ? serialiseObject(object) : `incomplete\n${serialiseObject(object)}`
}

/**
 * Every object a model holds, as one string: what a stale edit could overwrite.
 *
 * This is what `revision` counts, and the two are the same question asked once.
 * An edit is stale when the picture it was computed from is no longer what the
 * files say, and "what the files say" is the objects, because an edit replaces
 * objects and nothing else.
 */
function shapeOf(model: Model): string {
  const objects: readonly CanvasObject[] = [...model.tables, ...model.notes, ...model.groups]
  return JSON.stringify([
    serialiseModelFile(model),
    model.complete,
    objects.map((object) => [
      `${directoryOfKind(object.kind)}/${object.name}.md`,
      renderObject(object),
    ]),
  ])
}

/**
 * A whole model as one string, for "is there anything new to serve".
 *
 * Diagnostics are in this one and deliberately not in `shapeOf`, and the split
 * is the difference between the two questions a re-read answers. A file can
 * change in a way that leaves every object identical and still has something
 * new to say: an unknown key is a warning and no object at all, and a page that
 * did not redraw would never show it. So a diagnostics-only change is adopted
 * and served.
 *
 * It is not a staleness. dbmd-25 made a blank column name a warning, and the
 * inspector's `Add column` writes exactly that (ADR 0016), so the session's own
 * write comes back with a diagnostic the session could not have predicted. A
 * revision that moved for it would refuse the very next character the developer
 * typed into the column they had just added. Every object still says what the
 * page has, so there is nothing for a stale edit to lose.
 */
function fingerprint(model: Model, diagnostics: readonly Diagnostic[]): string {
  return JSON.stringify([shapeOf(model), diagnostics])
}

/** One sentence, in one place, because the status and the refusal have to agree. */
function changedUnderneath(path: string, action: string): string {
  return (
    `\`${path}\` changed on disk after the studio read it, so ${action} would lose that change. ` +
    `The studio has reloaded the file and dropped its own edit to it; make the edit again if you still want it`
  )
}

function applyTablePatch(table: Table, patch: TablePatch): Table {
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

function applyNotePatch(note: Note, patch: NotePatch): Note {
  const next: { -readonly [K in keyof Note]: Note[K] } = { ...note }
  if (patch.body !== undefined) next.body = patch.body
  if (patch.layout !== undefined) {
    if (patch.layout === null) delete next.layout
    else next.layout = patch.layout
  }
  if (patch.color !== undefined) {
    if (patch.color === null) delete next.color
    else next.color = patch.color
  }
  return next
}

function applyGroupPatch(group: Group, patch: GroupPatch): Group {
  const next: { -readonly [K in keyof Group]: Group[K] } = { ...group }
  if (patch.body !== undefined) next.body = patch.body
  if (patch.label !== undefined) {
    if (patch.label === null) delete next.label
    else next.label = patch.label
  }
  if (patch.color !== undefined) {
    if (patch.color === null) delete next.color
    else next.color = patch.color
  }
  return next
}

/** The reader sorts, so a model that gained an object keeps the order a reload would give it. */
function sortByName<T extends CanvasObject>(objects: readonly T[]): readonly T[] {
  return [...objects].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}
