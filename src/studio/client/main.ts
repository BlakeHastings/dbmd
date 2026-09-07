/**
 * The page: read the model, draw it, and put every drag back on the disk.
 *
 * This file is only the wiring. The arithmetic is in `geometry.ts`, the routing
 * in `edges.ts`, the drawing and the interaction in `canvas.ts`, and the
 * requests in `write.ts`. What is left here is which element is which and what
 * the status line says, and it is worth keeping it that thin: the two items
 * blocked on this one both attach at this level.
 *
 * - **dbmd-32, the inspector**, attaches to `onSelect` below. The canvas already
 *   tracks the selection and marks it; what it does not have is a panel.
 * - **dbmd-33, the watcher**, attaches to `show`. The canvas can be redrawn from
 *   a new model at any time, and this file reads `/api/model` in exactly one
 *   place so there is one thing for a live update to call.
 * - **dbmd-34, notes and groups**, attaches inside the canvas as two more
 *   layers, and the reason it is not two more calls here is ADR 0005: a group
 *   has no coordinates, so it is drawn from its members rather than fetched.
 */

import { Canvas } from './canvas.js'
import { placeTables } from './place.js'
import { fetchModel, LayoutWriter } from './write.js'
// The one consumer that only wants to print where a diagnostic points, which
// ADR 0014 says should not have to ask whether it is holding a file or a
// document. It is the only value this page imports from outside its own
// directory, and `diagnostics.ts` has no imports of its own, so the bundle
// gains one function rather than a module graph.
import { locationText } from '../../diagnostics.js'
import type { Diagnostic } from '../../model/types.js'
import type { WireModelResponse, WireStatus } from '../wire.js'

const canvasHost = required('canvas')
const statusText = required('status-text')
const selectionText = required('selection')
const diagnosticsList = required('diagnostics')
const zoomLevel = required('zoom-level')

/** How long to wait before asking whether the debounced write has landed. */
const STATUS_POLL_MS = 400
/** A write that never lands would otherwise be polled for forever. */
const STATUS_POLL_LIMIT = 6

const writer = new LayoutWriter({
  onStatus: (status) => {
    showStatus(status)
    if (status.pendingWrite) pollStatus()
  },
  onFailure: (table, message) => {
    statusText.textContent = `Could not write ${table}: ${message}`
    statusText.dataset['tone'] = 'bad'
  },
})

const canvas = new Canvas(canvasHost, {
  onMove: (table, position) => writer.move(table, position),
  onSelect: (table) => {
    // dbmd-32 opens the inspector here. Until it does, saying what is selected
    // is what makes the selection visible as something rather than a border.
    selectionText.textContent = table === null ? '' : `Selected ${table}.`
  },
  onViewport: (viewport) => {
    zoomLevel.textContent = `${Math.round(viewport.scale * 100)}%`
  },
})

wireToolbar()

void start()

async function start(): Promise<void> {
  let response: WireModelResponse
  try {
    response = await fetchModel()
  } catch (error) {
    statusText.textContent = `Could not read the model: ${
      error instanceof Error ? error.message : String(error)
    }`
    statusText.dataset['tone'] = 'bad'
    return
  }
  show(response)
}

function show(response: WireModelResponse): void {
  const tables = response.model.tables
  canvas.show(tables, placeTables(tables))
  canvas.fit()
  showDiagnostics(response.diagnostics)
  showStatus(response)
  document.title =
    response.model.name === undefined ? 'dbmd studio' : `${response.model.name} · dbmd studio`
}

function wireToolbar(): void {
  required('zoom-out').addEventListener('click', () => canvas.zoomStep(-1))
  required('zoom-in').addEventListener('click', () => canvas.zoomStep(1))
  required('zoom-reset').addEventListener('click', () => canvas.zoomTo(1))
  required('zoom-fit').addEventListener('click', () => canvas.fit())
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') canvas.select(null)
  })
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
        // and noticing a change on disk is the watcher's job (dbmd-33).
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

function showDiagnostics(diagnostics: readonly Diagnostic[]): void {
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
