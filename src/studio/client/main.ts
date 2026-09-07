/**
 * The page: read the model, draw it, and put every edit back on the disk.
 *
 * This file is only the wiring. The arithmetic is in `geometry.ts`, the routing
 * in `edges.ts`, the drawing and the interaction in `canvas.ts`, the panel in
 * `inspector.ts`, and the requests in `write.ts`. What is left here is which
 * element is which, what the status line says, and the one copy of the model.
 *
 * **The page holds one copy of the model and every edit updates it.** The
 * canvas draws from it, the inspector reads fields out of it, and the validator
 * runs over it. Two copies would drift within a keystroke of each other, and the
 * thing that would drift is what the inspector says a rename is about to break.
 *
 * **The validator runs here, in the browser, over that copy.** `validate` takes
 * a `Model` and nothing else (ADR 0017) which makes it a pure function of a
 * value this page already has, so a ref typed at a table that does not exist is
 * named on the keystroke rather than after a write, a re-read and a reload. ADR
 * 0016 has the argument, including why the answer is to show it rather than to
 * refuse it.
 *
 * - **dbmd-33, the watcher**, attaches to `adopt`. The canvas can be redrawn
 *   from a new model at any time, and this file reads `/api/model` in exactly
 *   one place so there is one thing for a live update to call.
 * - **dbmd-34, notes and groups**, attaches inside the canvas as two more
 *   layers, and the reason it is not two more calls here is ADR 0005: a group
 *   has no coordinates, so it is drawn from its members rather than fetched.
 * - **dbmd-38, adding and removing whole tables**, is the toolbar's `Add table`
 *   and the panel's `Delete`, and both land in `reload` below, because both move
 *   a file rather than editing one. ADR 0021.
 */

import { Canvas } from './canvas.js'
import { Inspector } from './inspector.js'
import { fromWireModel, withTable } from './model.js'
import { placeTables } from './place.js'
import { NEW_TABLE_COLUMNS } from './tables.js'
import { createTable, deleteTable, fetchModel, renameTable, TableWriter } from './write.js'
// The two values this page imports from outside its own directory. ADR 0014
// says a consumer that only wants to print where a diagnostic points should not
// have to ask what kind of location it is holding, and ADR 0017 says the
// validator is a pure function of a model, which is what lets it run here.
import { locationText, sortDiagnostics } from '../../diagnostics.js'
import { validate } from '../../model/validate.js'
import type { Diagnostic, Table } from '../../model/types.js'
import type { WireModel, WireModelResponse, WireStatus } from '../wire.js'
import type { Point } from './geometry.js'

const canvasHost = required('canvas')
const inspectorHost = required('inspector')
const addTableButton = required('add-table')
const statusText = required('status-text')
const selectionText = required('selection')
const diagnosticsList = required('diagnostics')
const zoomLevel = required('zoom-level')

/** How long to wait before asking whether the debounced write has landed. */
const STATUS_POLL_MS = 400
/** A write that never lands would otherwise be polled for forever. */
const STATUS_POLL_LIMIT = 6

/** The one copy. Empty until the first read, which is the only time it can be. */
let model: WireModel = {
  body: '',
  complete: true,
  tables: [],
  notes: [],
  groups: [],
  referencesTo: [],
  groupMembers: [],
}
/** What the last read of the directory said. The validator's half is recomputed. */
let readerDiagnostics: readonly Diagnostic[] = []

const writer = new TableWriter({
  onStatus: (status) => {
    showStatus(status)
    if (status.pendingWrite) pollStatus()
  },
  onFailure: (table, message) => {
    statusText.textContent = `Could not write ${table}: ${message}`
    statusText.dataset['tone'] = 'bad'
  },
})

const inspector = new Inspector(inspectorHost, {
  model: () => model,
  onPatch: (name, patch, next) => {
    adoptTable(next)
    writer.patch(name, patch)
  },
  onRename: (from, to) => {
    void rename(from, to)
  },
  onCreate: (name, at) => {
    void create(name, at)
  },
  onDelete: (name) => {
    void remove(name)
  },
})

const canvas = new Canvas(canvasHost, {
  onMove: (table, position) => writer.move(table, position),
  onSelect: (table) => {
    selectionText.textContent = table === null ? '' : `Selected ${table}.`
    inspector.show(table)
  },
  onViewport: (viewport) => {
    zoomLevel.textContent = `${Math.round(viewport.scale * 100)}%`
  },
  onPlace: (at) => {
    showArmed()
    // Whatever was selected is not what this press was about, and closing its
    // panel is what makes room for the form. `select` reaches `onSelect`, which
    // calls `inspector.show`, so the form is opened after it and not before.
    canvas.select(null)
    inspector.place(at)
    selectionText.textContent = `New table at ${at.x}, ${at.y}.`
  },
})

wireToolbar()

void start()

async function start(): Promise<void> {
  await reload()
}

/** Read the directory and redraw everything from it. The watcher will call this. */
async function reload(): Promise<void> {
  let response: WireModelResponse
  try {
    response = await fetchModel()
  } catch (error) {
    statusText.textContent = `Could not read the model: ${messageOf(error)}`
    statusText.dataset['tone'] = 'bad'
    return
  }
  adopt(response)
}

function adopt(response: WireModelResponse): void {
  model = response.model
  readerDiagnostics = response.diagnostics
  canvas.show(model.tables, placeTables(model.tables))
  showDiagnostics()
  showStatus(response)
  document.title = model.name === undefined ? 'dbmd studio' : `${model.name} · dbmd studio`
}

/**
 * One table changed. Update the copy, redraw its box, and say what it broke.
 *
 * The panel is deliberately not redrawn: it is where the change came from, so it
 * already shows it, and rebuilding a field under the cursor is how an editor
 * eats a keystroke.
 *
 * The box is redrawn only when the columns are a different list, because the
 * columns and the name are the whole of what a box draws. A prose edit produces
 * a table whose column list is the same array, so typing a paragraph rebuilds no
 * DOM at all and reroutes no edges.
 */
function adoptTable(next: Table): void {
  const drawn = model.tables.find((table) => table.name === next.name)
  model = withTable(model, next)
  if (drawn === undefined || drawn.columns !== next.columns) canvas.update(next)
  showDiagnostics()
}

/**
 * Write a new table's file, then re-read and select it.
 *
 * Deliberately the same shape as `rename`: a create moves a file rather than
 * editing one, so the page adopts what the reader found rather than patching its
 * copy. The selection at the end is what puts the inspector on the new table, so
 * the name is typed once here and everything else is typed in the panel.
 */
async function create(name: string, at: Point): Promise<void> {
  statusText.textContent = `Creating tables/${name}.md.`
  statusText.dataset['tone'] = 'plain'
  try {
    await createTable({ name, layout: { x: at.x, y: at.y }, columns: NEW_TABLE_COLUMNS })
  } catch (error) {
    // The server's own words, in the form the name was typed into. `safe-path`
    // refuses a name a file cannot have and says why; a status line at the far
    // corner of the page is not where that sentence is read (ADR 0021).
    statusText.textContent = `Could not create ${name}: ${messageOf(error)}`
    statusText.dataset['tone'] = 'bad'
    inspector.placementRefused(name, messageOf(error))
    return
  }
  await reload()
  canvas.select(name)
}

/**
 * Delete a table's file. The only thing this page does that destroys one.
 *
 * `settle` first, for the reason a rename settles: a patch still in flight
 * against this name would arrive after the file has gone, and the server would
 * answer a refusal about a table that no longer exists rather than writing
 * anything. The selection is dropped before the request, so the panel does not
 * spend the round trip showing a table that is being deleted.
 */
async function remove(name: string): Promise<void> {
  canvas.select(null)
  statusText.textContent = `Deleting tables/${name}.md.`
  statusText.dataset['tone'] = 'plain'
  try {
    await writer.settle(name)
    await deleteTable(name)
  } catch (error) {
    statusText.textContent = `Could not delete ${name}: ${messageOf(error)}`
    statusText.dataset['tone'] = 'bad'
    return
  }
  await reload()
  // After the reload, because that one shows the last write, and a removal is
  // not a write: the file is gone and nothing in `WireStatus` says so.
  statusText.textContent = `Deleted tables/${name}.md. Undo is git checkout, if it was committed.`
  statusText.dataset['tone'] = 'plain'
}

async function rename(from: string, to: string): Promise<void> {
  statusText.textContent = `Renaming ${from} to ${to}.`
  statusText.dataset['tone'] = 'plain'
  try {
    await renameTable(writer, model, from, to)
  } catch (error) {
    statusText.textContent = `Could not rename ${from}: ${messageOf(error)}`
    statusText.dataset['tone'] = 'bad'
    return
  }
  // A rename moves files, so the whole directory is re-read rather than one
  // table patched: what the reader found is what the rest of the page must see.
  await reload()
  canvas.select(to)
}

function wireToolbar(): void {
  required('zoom-out').addEventListener('click', () => canvas.zoomStep(-1))
  required('zoom-in').addEventListener('click', () => canvas.zoomStep(1))
  required('zoom-reset').addEventListener('click', () => canvas.zoomTo(1))
  required('zoom-fit').addEventListener('click', () => canvas.fit())
  addTableButton.addEventListener('click', () => {
    canvas.arm(!canvas.placing)
    showArmed()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    if (canvas.placing) {
      canvas.arm(false)
      showArmed()
      return
    }
    // Not while typing in the panel: Escape there is the field's own, and
    // closing the inspector out from under a half-typed value is a lost edit.
    if (inspectorHost.contains(document.activeElement)) return
    canvas.select(null)
  })
}

/** What the status line said before placement borrowed it, or null. */
let borrowedLine: { readonly text: string; readonly tone: string } | null = null

/**
 * Say whether the next click on the canvas places a table.
 *
 * A mode has to be visible from wherever the developer is looking, which is the
 * canvas rather than the button, so the cursor is a crosshair for as long as it
 * lasts (`canvas.ts`) and the status line says what the crosshair is for.
 *
 * The line is borrowed and given back rather than recomputed. Arming and then
 * cancelling produces no response to redraw from, and remembering the rendered
 * line is one string; remembering the `WireStatus` it came from is a copy of a
 * type that grows.
 */
function showArmed(): void {
  addTableButton.setAttribute('aria-pressed', String(canvas.placing))
  if (canvas.placing) {
    borrowedLine ??= {
      text: statusText.textContent ?? '',
      tone: statusText.dataset['tone'] ?? 'plain',
    }
    statusText.textContent = 'Click the canvas where the new table goes. Escape cancels.'
    statusText.dataset['tone'] = 'plain'
    return
  }
  if (borrowedLine === null) return
  statusText.textContent = borrowedLine.text
  statusText.dataset['tone'] = borrowedLine.tone
  borrowedLine = null
}

/**
 * ADR 0004: there is no Save button, so the status line is how a save is seen.
 *
 * The write is debounced in the server, so the response to the request that
 * caused it says `pendingWrite` and cannot say when it landed. One poll after
 * the debounce is what turns "waiting" into "wrote tables/orders.md at 14:02".
 */
let pollTimer: number | undefined
let pollsLeft = STATUS_POLL_LIMIT

function pollStatus(): void {
  if (pollTimer !== undefined) return
  if (pollsLeft <= 0) return
  pollsLeft -= 1
  pollTimer = window.setTimeout(() => {
    pollTimer = undefined
    void fetchModel().then(
      (response) => {
        // The model itself is deliberately not adopted here. Redrawing the
        // canvas from a response that arrived mid-drag would fight the pointer,
        // and noticing a change on disk is the watcher's job (dbmd-33). The
        // reader's diagnostics are taken, because they are what the last write
        // made true and the page cannot compute them for itself.
        readerDiagnostics = response.diagnostics
        showDiagnostics()
        showStatus(response)
        if (response.pendingWrite) pollStatus()
        else pollsLeft = STATUS_POLL_LIMIT
      },
      () => {
        // A status poll that failed says nothing the developer needs; the next
        // write will report its own failure in its own words.
      },
    )
  }, STATUS_POLL_MS)
}

function showStatus(status: WireStatus): void {
  if (status.writeError !== null) {
    statusText.textContent = `Last write failed: ${status.writeError}`
    statusText.dataset['tone'] = 'bad'
    return
  }
  statusText.dataset['tone'] = 'plain'
  if (status.pendingWrite) {
    statusText.textContent = 'An edit is waiting to be written.'
    return
  }
  if (status.lastWrite === null) {
    statusText.textContent = 'Nothing written this session. Undo is git checkout.'
    return
  }
  statusText.textContent = `Wrote ${status.lastWrite.paths.join(', ')} at ${new Date(
    status.lastWrite.at,
  ).toLocaleTimeString()}. Undo is git checkout.`
}

/**
 * What is wrong with the model: what the reader said about the files, plus what
 * the validator says about the copy in this page as it stands right now.
 *
 * The two halves answer different questions and go stale differently. The
 * reader's are about bytes on disk and change only when a file does, so the
 * last read's answer is still true. The validator's are about whether the model
 * agrees with itself, which is exactly what an edit changes, so they are
 * recomputed here rather than fetched.
 */
function showDiagnostics(): void {
  const diagnostics = sortDiagnostics([...readerDiagnostics, ...validate(fromWireModel(model))])
  diagnosticsList.replaceChildren(
    ...diagnostics.map((diagnostic) => {
      const item = document.createElement('li')
      item.className = diagnostic.severity
      const where = document.createElement('code')
      where.textContent = locationText(diagnostic.at)
      item.append(where, ` ${diagnostic.message}`)
      return item
    }),
  )
  diagnosticsList.hidden = diagnostics.length === 0
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The element with this id, or a throw.
 *
 * The page and this file are the same change and ship together, so a missing id
 * is a mistake in this repository rather than a condition to survive. Failing
 * at startup says so; a null check per use would hide it in a page that half
 * works.
 */
function required(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`the page has no #${id}`)
  return element
}
