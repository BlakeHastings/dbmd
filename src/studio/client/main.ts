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
 * **The page knows which model it drew, and never edits another one.** ADR 0025.
 * `revision` on every status counts the times the directory changed underneath
 * this session, and this file keeps the one it drew: it re-reads when the server
 * is ahead, and every edit it sends names the number it was made against, so an
 * edit computed from a picture that has been overtaken is refused rather than
 * written. The two are one mechanism seen twice, and both are needed: adopting
 * is what makes the page true, and naming the revision is what makes the window
 * between the change and the adoption safe.
 *
 * **It adopts only when it is between things.** A redraw under a pointer that
 * is holding a box, under a cursor that is in a field, or over an edit that has
 * not been written yet, is the page taking work away from the developer to show
 * them somebody else's. So it waits, says the model moved, and catches up at the
 * next moment when nothing is in the middle of happening. Nothing is lost by
 * waiting, because an edit made in the meantime is refused rather than applied.
 *
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
import {
  createTable,
  deleteTable,
  fetchModel,
  renameTable,
  RenameStopped,
  RequestFailed,
  TableWriter,
} from './write.js'
// The two values this page imports from outside its own directory. ADR 0014
// says a consumer that only wants to print where a diagnostic points should not
// have to ask what kind of location it is holding, and ADR 0017 says the
// validator is a pure function of a model, which is what lets it run here.
import { locationText, sortDiagnostics } from '../../diagnostics.js'
import { validate } from '../../model/validate.js'
import type { Diagnostic, Table } from '../../model/types.js'
import type { WireConflict, WireModel, WireModelResponse, WireStatus } from '../wire.js'
import type { Point } from './geometry.js'

const canvasHost = required('canvas')
const inspectorHost = required('inspector')
const addTableButton = required('add-table')
const statusText = required('status-text')
const selectionText = required('selection')
const diagnosticsList = required('diagnostics')
const conflictsList = required('conflicts')
const zoomLevel = required('zoom-level')

/** How long to wait before asking whether the debounced write has landed. */
const STATUS_POLL_MS = 400
/** A write that never lands would otherwise be polled for forever. */
const STATUS_POLL_LIMIT = 6
/**
 * How often an idle page asks whether the directory moved.
 *
 * ADR 0004 promises that editing `orders.md` in an editor and seeing the box
 * change is the same feature as the studio writing it, and something has to ask.
 * Two seconds because this is a developer's own machine watching their own
 * files: a save is noticed inside the time it takes to look back at the other
 * window, and one loopback GET every two seconds is not a cost anybody is
 * paying. It stops entirely while the tab is hidden.
 *
 * It keeps asking while the page is busy, deliberately. A developer with the
 * cursor in a field is making no requests at all, so this is the only thing
 * that can tell them the file they are looking at has changed underneath them.
 * What being busy stops is the redraw, not the question.
 */
const HEARTBEAT_MS = 2000

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
/**
 * The revision of the model on screen, and therefore the revision every edit
 * made from it is made against. ADR 0025.
 */
let drawn = 0
/** The server has moved and this page has not caught up with it yet. */
let stale = false
/**
 * What the page has said about the last thing it tried to do, kept up until
 * something new lands.
 *
 * The status line is otherwise a rendering of `WireStatus`, redrawn by every
 * response including the heartbeat's, and a sentence written straight into the
 * element would be wiped by the next beat. That is fine for "wrote x at 14:02",
 * which the next render says again, and not fine for "the rename stopped
 * part-way", which is the only place a developer is ever told that. So the
 * sentence is held rather than written, and `showStatus` renders it until an
 * edit lands or the next deliberate act replaces it.
 */
let standing: { readonly text: string; readonly tone: 'plain' | 'bad' } | null = null

/** Say something that has to outlive the next status render. */
function say(text: string, tone: 'plain' | 'bad' = 'plain'): void {
  standing = { text, tone }
  statusText.textContent = text
  statusText.dataset['tone'] = tone
}

const writer = new TableWriter({
  revision: () => drawn,
  onStatus: (status) => {
    // An edit that landed is the answer to whatever was refused before it.
    standing = null
    notice(status)
    showStatus(status)
    if (status.pendingWrite) pollStatus()
  },
  onFailure: (table, failure) => {
    if (failure.isStale) {
      // Not "could not write": nothing failed. The page was holding a model the
      // files had moved on from, and the edit was refused rather than written
      // over the change. Saying it as an error would send a developer looking
      // at their disk.
      say(
        `${failure.message}. The page will re-read the model; make the edit again on top of what it then shows.`,
        'bad',
      )
      // Through `catchUp` rather than straight to `reload`, because a refusal in
      // the middle of a drag is exactly when redrawing every box would be worst:
      // the pointer is holding one of them. The re-read happens on the pointerup
      // that ends the gesture, and until then every further edit is refused for
      // the same reason this one was, which is the safe way round.
      stale = true
      catchUp()
      return
    }
    say(`Could not write ${table}: ${failure.message}`, 'bad')
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
wireHeartbeat()

void start()

async function start(): Promise<void> {
  await reload()
}

/** Read the directory and redraw everything from it, whatever the page is doing. */
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
  drawn = response.revision
  stale = false
  canvas.show(model.tables, placeTables(model.tables))
  // The panel is rebuilt from the model that just arrived, and it has to be:
  // its rows are the previous model's values held as DOM, and `commitColumns`
  // reads the whole list out of them. A panel left standing over an adopted
  // model would send that old list back with a fresh revision on it, which is
  // this item's defect with the guard passed rather than failed.
  inspector.show(canvas.selection)
  showDiagnostics()
  showStatus(response)
  document.title = model.name === undefined ? 'dbmd studio' : `${model.name} · dbmd studio`
}

/**
 * Take note that the server is ahead, and catch up if this is a moment to.
 *
 * Every response carries a revision, so this is called from everywhere a
 * response arrives rather than only from the heartbeat: the cheapest way to
 * learn the model moved is to be told by the request you were making anyway.
 */
function notice(status: WireStatus): void {
  if (status.revision <= drawn) return
  stale = true
  catchUp()
}

/**
 * Whether redrawing right now would take something away from the developer.
 *
 * Three things say no, and each is somebody's unfinished work: a pointer
 * holding a box, a cursor in a field, and an edit this page has not managed to
 * write yet. A placement is a fourth, because a table that has been pointed at
 * and not yet named is the one thing here with no file to be redrawn from.
 *
 * Focus only counts while this window has it. Side by side with an editor is
 * the workflow ADR 0004 is for, and `document.activeElement` still names the
 * last field the developer used in a window they are not typing into.
 */
function busy(): boolean {
  if (canvas.dragging || writer.busy || inspector.placing) return true
  return document.hasFocus() && inspectorHost.contains(document.activeElement)
}

function catchUp(): void {
  if (!stale) return
  if (busy()) return
  void reload()
}

/**
 * Ask whether the directory moved, on a slow beat and at the moments it is most
 * likely to have.
 *
 * The events matter more than the interval. Coming back to the tab, or back to
 * the window, is exactly when a developer has just saved something in their
 * editor, so those ask immediately and the interval is only there for the case
 * where the two windows are side by side and nothing was ever focused.
 *
 * `catchUp` is also called at the ends of the two gestures that block it, so an
 * adoption that was deferred usually lands on the pointerup or the blur rather
 * than at the next beat. Usually rather than always: the last write of a drag
 * is still in flight at pointerup, and that also blocks. The beat is what makes
 * "usually" into "within two seconds".
 */
function wireHeartbeat(): void {
  window.setInterval(() => void peek(), HEARTBEAT_MS)
  document.addEventListener('visibilitychange', () => void peek())
  window.addEventListener('focus', () => void peek())
  window.addEventListener('pointerup', () => catchUp())
  inspectorHost.addEventListener('focusout', () => catchUp())
}

async function peek(): Promise<void> {
  if (document.visibilityState !== 'visible') return
  // An adoption that is already owed does not need another read to find out.
  if (stale) {
    catchUp()
    return
  }
  let response: WireModelResponse
  try {
    response = await fetchModel()
  } catch {
    // A heartbeat that failed says nothing a developer needs. The next edit
    // reports its own failure in its own words, and the next beat tries again.
    return
  }
  // Asked even while the page is busy, and that is the point: a developer with
  // the cursor in a field makes no requests at all, so this is the only thing
  // that can tell them the file they are editing has changed underneath them.
  // Adopted from the response in hand rather than by asking again, because the
  // read that noticed the change is the read that carries it.
  if (response.revision > drawn) {
    if (!busy()) {
      adopt(response)
      return
    }
    stale = true
  }
  showStatus(response)
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
  const shown = model.tables.find((table) => table.name === next.name)
  model = withTable(model, next)
  if (shown === undefined || shown.columns !== next.columns) canvas.update(next)
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
  say(`Creating tables/${name}.md.`)
  try {
    // The same revision every other edit names. A create writes a file nobody
    // else has, so nothing of anybody's is at stake in the file itself; what is
    // at stake is the `layout` and the name, both of which were chosen against
    // a picture, and a picture that has been overtaken is one where the spot
    // pointed at may now hold something else.
    await createTable({ name, layout: { x: at.x, y: at.y }, columns: NEW_TABLE_COLUMNS }, drawn)
  } catch (error) {
    // The server's own words, in the form the name was typed into. `safe-path`
    // refuses a name a file cannot have and says why; a status line at the far
    // corner of the page is not where that sentence is read (ADR 0021).
    say(`Could not create ${name}: ${messageOf(error)}`, 'bad')
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
  say(`Deleting tables/${name}.md.`)
  try {
    await writer.settle(name)
    await deleteTable(name, drawn)
  } catch (error) {
    say(`Could not delete ${name}: ${messageOf(error)}`, 'bad')
    // A delete refused because the model moved leaves a page showing a table
    // the developer was told they were deleting. Re-reading is what puts the
    // question back where they can ask it again.
    if (error instanceof RequestFailed && error.isStale) await reload()
    return
  }
  await reload()
  // After the reload, because that one shows the last write, and a removal is
  // not a write: the file is gone and nothing in `WireStatus` says so. Held
  // rather than written, because the next heartbeat renders the status again
  // and a sentence nothing on the status can reconstruct would go with it.
  say(`Deleted tables/${name}.md. Undo is git checkout, if it was committed.`)
}

async function rename(from: string, to: string): Promise<void> {
  say(`Renaming ${from} to ${to}.`)
  try {
    // One revision for the whole rename, which is what makes several requests
    // one decision: it is the model the confirmation was written against, so a
    // step made against a different one is a step nobody agreed to. dbmd-39.
    await renameTable(writer, model, from, to, drawn)
  } catch (error) {
    // Kept up rather than replaced by the reload's own line: this is the only
    // place a developer is told the rename did not finish, and it has to
    // survive the redraw that immediately follows it.
    say(
      error instanceof RenameStopped
        ? error.message
        : `Could not rename ${from}: ${messageOf(error)}`,
      'bad',
    )
    await reload()
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
        // The model itself is deliberately not adopted here, even now that the
        // page does adopt: this poll runs during a write, which is one of the
        // moments `busy` exists to protect, so it hands the revision to
        // `notice` and lets that decide. The reader's diagnostics are taken,
        // because they are what the last write made true and the page cannot
        // compute them for itself.
        readerDiagnostics = response.diagnostics
        showDiagnostics()
        notice(response)
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
  showConflicts(status.conflicts)
  if (status.writeError !== null) {
    statusText.textContent = `Last write failed: ${status.writeError}`
    statusText.dataset['tone'] = 'bad'
    return
  }
  // A refusal wins over everything below, because it is the only place a
  // developer is told an edit did not happen and the render after it would
  // otherwise wipe it. An ordinary "deleted x" does not win over the news that
  // the model moved: the second is about what they are looking at now.
  if (standing?.tone === 'bad') {
    statusText.textContent = standing.text
    statusText.dataset['tone'] = 'bad'
    return
  }
  if (stale) {
    // Deliberately not a redraw. Something on this page is in the middle of
    // being done, and taking it away to show a change would be a smaller
    // version of the loss this whole guard exists to prevent.
    statusText.textContent =
      'The model changed on disk. This page is still showing what you were working on, and will catch up when you are between edits.'
    statusText.dataset['tone'] = 'bad'
    return
  }
  if (standing !== null) {
    statusText.textContent = standing.text
    statusText.dataset['tone'] = standing.tone
    return
  }
  if (status.pendingWrite) {
    statusText.dataset['tone'] = 'plain'
    statusText.textContent = 'An edit is waiting to be written.'
    return
  }
  // Above the last write, because "wrote tables/products.md" standing over a
  // list saying the studio would not write tables/products.md is the studio
  // contradicting itself. The list below has the file and the sentence; this is
  // the line that stops a developer reading the wrong one.
  if (status.conflicts.length > 0) {
    statusText.dataset['tone'] = 'bad'
    statusText.textContent = `${status.conflicts.length} edit${
      status.conflicts.length === 1 ? ' was' : 's were'
    } dropped rather than written over a change on disk.`
    return
  }
  statusText.dataset['tone'] = 'plain'
  if (status.lastWrite === null) {
    statusText.textContent = 'Nothing written this session. Undo is git checkout.'
    return
  }
  statusText.textContent = `Wrote ${status.lastWrite.paths.join(', ')} at ${new Date(
    status.lastWrite.at,
  ).toLocaleTimeString()}. Undo is git checkout.`
}

/**
 * The edits this session dropped rather than write over a change on disk.
 *
 * ADR 0019 put these on the status and said a refusal is visible or it is not a
 * refusal, and then nothing rendered them, so until now a developer learned
 * about one from stderr. They are a list rather than a line because there can be
 * several and each names a different file, and they are beside the diagnostics
 * rather than in them because a conflict is a fact about this session and a
 * diagnostic is a fact about the model that `dbmd check` would report too.
 *
 * An entry stands until the studio writes that file again, which is what
 * happens when the developer makes the edit a second time on top of the
 * reloaded model, so the list clears itself by being resolved.
 */
function showConflicts(conflicts: readonly WireConflict[]): void {
  conflictsList.replaceChildren(
    ...conflicts.map((conflict) => {
      const item = document.createElement('li')
      const where = document.createElement('code')
      where.textContent = conflict.path
      item.append(where, ` ${conflict.message}`)
      return item
    }),
  )
  conflictsList.hidden = conflicts.length === 0
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
