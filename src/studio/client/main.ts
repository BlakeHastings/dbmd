/**
 * The client, as far as dbmd-30 takes it: it reads the model and shows it.
 *
 * This is not the canvas. Boxes, edges, pan, zoom and drag are dbmd-31, and the
 * inspector that edits a column is dbmd-32. What is here is the page the server
 * serves, so that the bundle the build produces is a real one and the two later
 * items are UI work rather than UI work plus a build pipeline.
 *
 * It is read-only on purpose. A half-canvas that writes would be a second way to
 * edit a table that dbmd-31 would then have to delete.
 */

interface Layout {
  x: number
  y: number
}

interface Column {
  name: string
  type: string
  pk?: boolean
  nullable?: boolean
  default?: string
  ref?: { table: string; column: string }
}

interface Table {
  name: string
  columns: Column[]
  layout?: Layout
  group?: string
  complete: boolean
}

interface Diagnostic {
  code: string
  severity: 'error' | 'warning'
  path: string
  line?: number
  message: string
}

interface ModelResponse {
  model: { name?: string; engine?: string; tables: Table[] }
  diagnostics: Diagnostic[]
  lastWrite: { at: string; paths: string[] } | null
  pendingWrite: boolean
  writeError: string | null
}

const modelElement = document.querySelector('#model')
const statusElement = document.querySelector('#status')

async function load(): Promise<void> {
  if (modelElement === null || statusElement === null) return
  let response: ModelResponse
  try {
    const fetched = await fetch('/api/model', { headers: { accept: 'application/json' } })
    if (!fetched.ok) throw new Error(`the server answered ${fetched.status}`)
    response = (await fetched.json()) as ModelResponse
  } catch (error) {
    modelElement.textContent = `Could not read the model: ${
      error instanceof Error ? error.message : String(error)
    }`
    return
  }

  modelElement.replaceChildren(...render(response))
  statusElement.textContent = statusLine(response)
}

function render(response: ModelResponse): Node[] {
  const nodes: Node[] = []

  const heading = document.createElement('h1')
  heading.textContent = response.model.name ?? 'this model has no name'
  nodes.push(heading)

  const subtitle = document.createElement('p')
  subtitle.className = 'subtitle'
  subtitle.textContent = `${response.model.tables.length} tables${
    response.model.engine === undefined ? '' : `, ${response.model.engine}`
  }. The canvas is dbmd-31; this page is what the server serves until it lands.`
  nodes.push(subtitle)

  for (const diagnostic of response.diagnostics) {
    const line = document.createElement('p')
    line.className = `diagnostic ${diagnostic.severity}`
    const where = document.createElement('code')
    where.textContent =
      diagnostic.line === undefined ? diagnostic.path : `${diagnostic.path}:${diagnostic.line}`
    line.append(where, ` ${diagnostic.message}`)
    nodes.push(line)
  }

  for (const table of response.model.tables) {
    nodes.push(renderTable(table))
  }
  return nodes
}

function renderTable(table: Table): Node {
  const element = document.createElement('table')
  const caption = document.createElement('caption')
  caption.textContent = table.group === undefined ? table.name : `${table.name} (${table.group})`
  element.append(caption)

  for (const column of table.columns) {
    const row = document.createElement('tr')
    const name = document.createElement('td')
    name.textContent = column.pk === true ? `${column.name} (pk)` : column.name
    const type = document.createElement('td')
    type.className = 'type'
    type.textContent =
      column.ref === undefined
        ? column.type
        : `${column.type} -> ${column.ref.table}.${column.ref.column}`
    row.append(name, type)
    element.append(row)
  }
  return element
}

/** ADR 0004: there is no Save button, so the status line is how a save is seen. */
function statusLine(response: ModelResponse): string {
  if (response.writeError !== null) return `Last write failed: ${response.writeError}`
  if (response.pendingWrite) return 'An edit is waiting to be written.'
  if (response.lastWrite === null) return 'Nothing written this session. Undo is git checkout.'
  return `Wrote ${response.lastWrite.paths.join(', ')} at ${new Date(
    response.lastWrite.at,
  ).toLocaleTimeString()}. Undo is git checkout.`
}

void load()
