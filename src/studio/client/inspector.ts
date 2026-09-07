/**
 * The inspector: the panel that turns the studio from a viewer into an editor.
 *
 * Everything it does goes through `PATCH /api/table/:name` and the one writer in
 * `write.ts`, because ADR 0004 put the debounce in the server and there is
 * exactly one path from an edit to the disk. Nothing here holds an edit waiting
 * for a Save button, and nothing here holds a timer.
 *
 * Four things in this file are decisions rather than plumbing, and each is at
 * the line it happens:
 *
 * 1. **A textarea normalises line endings and the format does not.** The body of
 *    a model file is carried byte for byte, carriage returns included
 *    (`docs/format.md`, and ADR 0010 in the writer), while `textarea.value`
 *    hands back LF whatever went in. So the panel remembers which ending the
 *    body arrived with and puts it back on the way out. Without that, one word
 *    typed into a CRLF file is a whole-file diff, which is the reviewability the
 *    format exists for, thrown away by a widget.
 *
 * 2. **The panel is not redrawn by the response to its own edit.** Fields are
 *    built when a table is selected and when the developer clicks something
 *    structural, and never on a keystroke. Rewriting the field under a cursor is
 *    how an editor eats a character, and there is nothing to gain: the page sent
 *    the value, so it already knows what the value is.
 *
 * 3. **It shows problems and writes anyway.** A ref to a table that does not
 *    exist is a diagnostic, not something to prevent: this is a modelling tool,
 *    and a model is half-written most of the time it is being written. The one
 *    exception is a ref that is not yet `table.column`, which the wire has no
 *    shape for, and the panel says out loud that it is not being saved.
 *
 * 4. **A rename says what it is about to touch, before it touches it.** A table
 *    rename moves every `ref:` pointing at it, in other people's files, and a
 *    removal or a rename of a referenced column leaves those refs dangling.
 *    Both are named in the panel, with the columns, before anything is written.
 */

import type { Column, Index, Ref, Table } from '../../model/types.js'
import type { TablePatch, WireModel } from '../wire.js'
import {
  endingOf,
  parseIndexColumns,
  parseRef,
  survivesATextarea,
  toModelBody,
  type LineEnding,
} from './fields.js'
import { referrersTo, referrerText } from './model.js'

export interface InspectorHandlers {
  /** The page's copy of the model. Read on demand so there is one copy, not two. */
  readonly model: () => WireModel
  /** An edit to the selected table: apply it to the page's copy and write it. */
  readonly onPatch: (name: string, patch: TablePatch, next: Table) => void
  /** A rename, already confirmed by the developer. It touches several files. */
  readonly onRename: (from: string, to: string) => void
}

/**
 * One column's fields, held as elements rather than as values.
 *
 * Reordering moves `item` in the list rather than rebuilding it, which is what
 * lets a row keep its focus and its selection while the developer is moving it,
 * and `commitColumns` reads the whole list out of these on every change.
 */
interface ColumnRow {
  readonly item: HTMLLIElement
  readonly name: HTMLInputElement
  readonly type: HTMLInputElement
  readonly pk: HTMLInputElement
  readonly nullable: HTMLSelectElement
  readonly default: HTMLInputElement
  readonly ref: HTMLInputElement
  readonly notes: HTMLParagraphElement
  /** What this column was called when the panel was drawn, for the ref warning. */
  readonly was: string
}

interface IndexRow {
  readonly item: HTMLLIElement
  readonly name: HTMLInputElement
  readonly columns: HTMLInputElement
  readonly unique: HTMLInputElement
  readonly notes: HTMLParagraphElement
}

export class Inspector {
  private name: string | null = null
  private rows: ColumnRow[] = []
  private indexRows: IndexRow[] = []
  private columnList = document.createElement('ol')
  private indexList = document.createElement('ol')
  private keyLine = document.createElement('p')
  private body = document.createElement('textarea')
  /** The line ending the body arrived with, put back on everything typed into it. */
  private eol: LineEnding = '\n'

  constructor(
    private readonly host: HTMLElement,
    private readonly handlers: InspectorHandlers,
  ) {}

  /** Draw the panel for one table, or close it. Rebuilds every field. */
  show(name: string | null): void {
    this.name = name
    const table = name === null ? undefined : this.tableOf(name)
    if (table === undefined) {
      this.host.hidden = true
      this.host.replaceChildren()
      this.name = null
      return
    }
    this.host.hidden = false
    this.host.replaceChildren(...this.build(table))
  }

  // ------------------------------------------------------------------------
  // Building the panel.
  // ------------------------------------------------------------------------

  private build(table: Table): HTMLElement[] {
    const parts: HTMLElement[] = [this.heading(table)]
    if (!table.complete) {
      parts.push(
        note(
          `${table.path} did not parse, so this server is holding less than the file does and will not write over it. Fix the file and reload.`,
          'bad',
        ),
      )
      return parts
    }
    parts.push(this.nameSection(table), this.columnsSection(table), this.indexesSection(table))
    parts.push(this.bodySection(table))
    return parts
  }

  private heading(table: Table): HTMLElement {
    const header = el('header')
    header.append(el('h2', 'title', table.name), el('code', 'path', table.path))
    return header
  }

  // ------------------------------------------------------------------------

  private nameSection(table: Table): HTMLElement {
    const section = sectionOf('Name')
    const field = el('div', 'field')
    const input = el('input')
    input.type = 'text'
    input.value = table.name
    input.spellcheck = false
    input.setAttribute('aria-label', 'Table name')
    input.dataset['field'] = 'table-name'

    const button = el('button', 'primary', 'Rename')
    button.type = 'button'
    const confirmHost = el('div', 'confirm-host')

    const askToRename = (): void => {
      const to = input.value.trim()
      const from = table.name
      if (to === from || to === '') {
        input.value = from
        confirmHost.replaceChildren()
        return
      }
      const referrers = referrersTo(this.handlers.model(), from)
      const files = [...new Set(referrers.map((referrer) => referrer.table))]
      const lines = [
        `Rename \`${from}\` to \`${to}\`?`,
        `This writes tables/${to}.md and deletes tables/${from}.md.`,
        files.length === 0
          ? 'Nothing else in the model refs this table, so no other file changes.'
          : `${referrers.length} ref${referrers.length === 1 ? '' : 's'} point here and will be moved with it, which edits ${files.length} other file${files.length === 1 ? '' : 's'}: ${files.map((file) => `tables/${file}.md`).join(', ')} (${referrerText(referrers)}).`,
      ]
      this.confirm(confirmHost, lines, 'Rename', () => {
        confirmHost.replaceChildren()
        this.handlers.onRename(from, to)
      })
    }

    button.addEventListener('click', askToRename)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') askToRename()
      if (event.key === 'Escape') {
        input.value = table.name
        confirmHost.replaceChildren()
      }
    })

    field.append(input, button)
    section.append(
      field,
      note(
        'Renaming is not a keystroke: it writes one file, deletes another and edits everyone who refs it, so it waits for the button.',
      ),
      confirmHost,
    )
    return section
  }

  // ------------------------------------------------------------------------

  private columnsSection(table: Table): HTMLElement {
    const section = sectionOf('Columns')
    this.columnList = el('ol', 'columns')
    this.columnList.dataset['field'] = 'columns'
    this.rows = table.columns.map((column) => this.columnRow(column))
    this.columnList.replaceChildren(...this.rows.map((row) => row.item))

    this.keyLine = el('p', 'key')
    const add = el('button', '', 'Add column')
    add.type = 'button'
    add.dataset['action'] = 'add-column'
    add.addEventListener('click', () => {
      const row = this.columnRow({ name: '', type: '' })
      this.rows.push(row)
      this.columnList.append(row.item)
      this.commitColumns()
      row.name.focus()
    })

    section.append(this.keyLine, this.columnList, add)
    this.refreshKeyLine()
    return section
  }

  private columnRow(column: Column): ColumnRow {
    const item = el('li')

    const name = textField(item, 'name', column.name, 'name')
    const type = textField(item, 'type', column.type, 'type')

    const pkLabel = el('label', 'flag')
    const pk = el('input')
    pk.type = 'checkbox'
    pk.checked = column.pk === true
    pkLabel.append(pk, document.createTextNode(' pk'))

    const nullable = el('select')
    for (const [value, text] of [
      ['', 'nullable: unsaid'],
      ['false', 'nullable: false'],
      ['true', 'nullable: true'],
    ] as const) {
      const option = el('option', '', text)
      option.value = value
      nullable.append(option)
    }
    nullable.value = column.nullable === undefined ? '' : String(column.nullable)
    nullable.setAttribute('aria-label', 'nullable')

    const fields = el('div', 'flags')
    fields.append(pkLabel, nullable)
    item.append(fields)

    const fallback = textField(item, 'default', column.default ?? '', 'default')
    const ref = textField(
      item,
      'ref',
      column.ref === undefined ? '' : `${column.ref.table}.${column.ref.column}`,
      'ref (table.column)',
    )

    const buttons = el('div', 'row-buttons')
    const up = iconButton('↑', 'Move up')
    const down = iconButton('↓', 'Move down')
    const remove = iconButton('✕', 'Remove column')
    remove.classList.add('danger')
    buttons.append(up, down, remove)
    item.append(buttons)

    const notes = el('p', 'notes')
    item.append(notes)

    const row: ColumnRow = {
      item,
      name,
      type,
      pk,
      nullable,
      default: fallback,
      ref,
      notes,
      was: column.name,
    }

    for (const input of [name, type, fallback, ref]) {
      input.addEventListener('input', () => this.commitColumns())
    }
    pk.addEventListener('change', () => this.commitColumns())
    nullable.addEventListener('change', () => this.commitColumns())
    up.addEventListener('click', () => this.moveColumn(row, -1))
    down.addEventListener('click', () => this.moveColumn(row, 1))
    remove.addEventListener('click', () => this.askToRemoveColumn(row))

    return row
  }

  private moveColumn(row: ColumnRow, by: -1 | 1): void {
    const at = this.rows.indexOf(row)
    const to = at + by
    if (at === -1 || to < 0 || to >= this.rows.length) return
    const other = this.rows[to]
    if (other === undefined) return
    this.rows[to] = row
    this.rows[at] = other
    // The elements are moved rather than rebuilt, so a field keeps its focus and
    // its selection: reordering is not a reason to interrupt typing.
    this.columnList.replaceChildren(...this.rows.map((each) => each.item))
    this.commitColumns()
  }

  private askToRemoveColumn(row: ColumnRow): void {
    const name = this.name
    if (name === null) return
    const remove = (): void => {
      this.rows = this.rows.filter((each) => each !== row)
      row.item.remove()
      this.commitColumns()
    }
    const referrers = referrersTo(this.handlers.model(), name, row.was)
    if (referrers.length === 0 || row.was === '') {
      remove()
      return
    }
    const host = el('div', 'confirm-host')
    row.item.append(host)
    this.confirm(
      host,
      [
        `Remove \`${name}.${row.was}\`?`,
        `${referrers.length} ref${referrers.length === 1 ? '' : 's'} point at it and will be left dangling: ${referrerText(referrers)}.`,
        'Those files are not edited. dbmd will report each one as `ref-column-unknown` until you fix it.',
      ],
      'Remove anyway',
      remove,
    )
  }

  /**
   * Read every column field, write the lot, and say what is wrong with it.
   *
   * The whole list every time, because that is what a `TablePatch` carries: a
   * key is the whole of its part of the table rather than a delta into it, so
   * there is no position to get wrong when two edits race.
   */
  private commitColumns(): void {
    const name = this.name
    const table = name === null ? undefined : this.tableOf(name)
    if (name === null || table === undefined) return

    const columns: Column[] = []
    const notes: string[][] = []
    const seen = new Set<string>()
    const twice = new Set<string>()

    for (const row of this.rows) {
      const text = row.name.value
      if (seen.has(text)) twice.add(text)
      seen.add(text)

      const column: {
        name: string
        type: string
        pk?: boolean
        nullable?: boolean
        default?: string
        ref?: Ref
      } = { name: text, type: row.type.value }
      if (row.pk.checked) column.pk = true
      if (row.nullable.value !== '') column.nullable = row.nullable.value === 'true'
      if (row.default.value !== '') column.default = row.default.value

      const said: string[] = []
      if (text === '') said.push('this column has no name, and will be written as an empty one')

      const ref = parseRef(row.ref.value)
      if (ref === 'malformed') {
        said.push(
          `\`${row.ref.value.trim()}\` is not a ref: write \`table.column\`. Until it is, no ref is being saved on this column`,
        )
      } else if (ref !== 'absent') {
        column.ref = ref
      }

      if (text !== row.was && row.was !== '') {
        const orphans = referrersTo(this.handlers.model(), name, row.was)
        if (orphans.length > 0) {
          said.push(
            `${orphans.length} ref${orphans.length === 1 ? '' : 's'} still point at \`${name}.${row.was}\` and are not being moved: ${referrerText(orphans)}`,
          )
        }
      }

      columns.push(column)
      notes.push(said)
    }

    this.rows.forEach((row, at) => {
      const said = [...(notes[at] ?? [])]
      if (twice.has(row.name.value) && row.name.value !== '') {
        said.push(`another column here is also called \`${row.name.value}\``)
      }
      row.notes.textContent = said.join('. ')
      row.notes.hidden = said.length === 0
    })

    this.handlers.onPatch(name, { columns }, { ...table, columns })
    this.refreshKeyLine()
  }

  /**
   * The primary key, spelled out, because its order is the order of the list.
   *
   * `docs/format.md` warns that reordering `columns:` silently changes the key
   * and that nothing will tell you. This is the page telling you: the line moves
   * as the rows move, so a developer who drags a key column past another one
   * sees the key they now have rather than the one they meant.
   */
  private refreshKeyLine(): void {
    const key = this.rows.filter((row) => row.pk.checked).map((row) => row.name.value || '?')
    this.keyLine.textContent =
      key.length === 0
        ? 'No primary key. Tick `pk` on the columns that identify one row.'
        : `Primary key (${key.join(', ')}) — the key is in the order the rows are in.`
    this.keyLine.classList.toggle('warn', key.length === 0)
  }

  // ------------------------------------------------------------------------

  private indexesSection(table: Table): HTMLElement {
    const section = sectionOf('Indexes')
    this.indexList = el('ol', 'indexes')
    this.indexList.dataset['field'] = 'indexes'
    this.indexRows = table.indexes.map((index) => this.indexRow(index))
    this.indexList.replaceChildren(...this.indexRows.map((row) => row.item))

    const add = el('button', '', 'Add index')
    add.type = 'button'
    add.dataset['action'] = 'add-index'
    add.addEventListener('click', () => {
      const row = this.indexRow({ name: '', columns: [] })
      this.indexRows.push(row)
      this.indexList.append(row.item)
      this.commitIndexes()
      row.name.focus()
    })

    section.append(
      note(
        'Name an index what the database calls it: that name is what the engine prints when the constraint fires.',
      ),
      this.indexList,
      add,
    )
    return section
  }

  private indexRow(index: Index): IndexRow {
    const item = el('li')
    const name = textField(item, 'name', index.name, 'index name')
    const columns = textField(item, 'columns', index.columns.join(', '), 'columns, in order')

    const uniqueLabel = el('label', 'flag')
    const unique = el('input')
    unique.type = 'checkbox'
    unique.checked = index.unique === true
    uniqueLabel.append(unique, document.createTextNode(' unique'))

    const remove = iconButton('✕', 'Remove index')
    remove.classList.add('danger')

    const buttons = el('div', 'row-buttons')
    buttons.append(uniqueLabel, remove)
    item.append(buttons)

    const notes = el('p', 'notes')
    item.append(notes)

    const row: IndexRow = { item, name, columns, unique, notes }
    for (const input of [name, columns]) {
      input.addEventListener('input', () => this.commitIndexes())
    }
    unique.addEventListener('change', () => this.commitIndexes())
    remove.addEventListener('click', () => {
      this.indexRows = this.indexRows.filter((each) => each !== row)
      item.remove()
      this.commitIndexes()
    })
    return row
  }

  private commitIndexes(): void {
    const name = this.name
    const table = name === null ? undefined : this.tableOf(name)
    if (name === null || table === undefined) return

    const indexes: Index[] = []
    for (const row of this.indexRows) {
      const columns = parseIndexColumns(row.columns.value)
      const index: { name: string; columns: readonly string[]; unique?: boolean } = {
        name: row.name.value,
        columns,
      }
      if (row.unique.checked) index.unique = true
      indexes.push(index)

      const said: string[] = []
      if (row.name.value === '') said.push('this index has no name')
      if (columns.length === 0) said.push('this index names no columns')
      row.notes.textContent = said.join('. ')
      row.notes.hidden = said.length === 0
    }

    this.handlers.onPatch(name, { indexes }, { ...table, indexes })
  }

  // ------------------------------------------------------------------------

  /**
   * The prose, and the whole of the line-ending promise.
   *
   * `textarea.value` is the API value, which the HTML specification defines as
   * having every line break normalised to LF whatever was assigned to it. The
   * body of a model file is not: it reaches disk exactly as it arrived. So the
   * ending is read off the body once, here, and put back on every value read
   * out. The alternative is that opening a CRLF model, typing one word and
   * saving rewrites every line of the file, which is the diff the format exists
   * to avoid.
   */
  private bodySection(table: Table): HTMLElement {
    const section = sectionOf('Prose')
    this.eol = endingOf(table.body)
    this.body = el('textarea')
    this.body.value = table.body
    this.body.spellcheck = false
    this.body.rows = 12
    this.body.dataset['field'] = 'body'
    this.body.setAttribute('aria-label', 'Prose body')

    this.body.addEventListener('input', () => {
      const name = this.name
      const current = name === null ? undefined : this.tableOf(name)
      if (name === null || current === undefined) return
      const body = this.bodyText()
      this.handlers.onPatch(name, { body }, { ...current, body })
    })

    section.append(this.body)
    // A body that is neither all-LF nor all-CRLF cannot survive a textarea,
    // which has one normalisation and no memory of what it replaced. Saying so
    // is better than either refusing the edit or quietly flattening the file.
    if (!survivesATextarea(table.body, this.eol)) {
      section.append(
        note(
          `This body mixes line endings. A textarea cannot hold that, so saving from here makes them all ${this.eol === '\r\n' ? 'CRLF' : 'LF'}.`,
          'bad',
        ),
      )
    } else {
      section.append(
        note(
          `Carried byte for byte, ${this.eol === '\r\n' ? 'CRLF' : 'LF'} endings and all. Markdown is not rendered and never reflowed.`,
        ),
      )
    }
    return section
  }

  private bodyText(): string {
    return toModelBody(this.body.value, this.eol)
  }

  // ------------------------------------------------------------------------

  private tableOf(name: string): Table | undefined {
    return this.handlers.model().tables.find((table) => table.name === name)
  }

  /**
   * Say what is about to happen, in the panel, and wait to be told to do it.
   *
   * A `window.confirm` would be one line and is the wrong line: it is a string,
   * so it cannot name three files as three lines, and it is a modal that
   * anything driving the page has to be taught about. This is the same question
   * asked where the answer will be read.
   */
  private confirm(
    host: HTMLElement,
    lines: readonly string[],
    label: string,
    run: () => void,
  ): void {
    const block = el('div', 'confirm')
    for (const line of lines) block.append(el('p', '', line))
    const go = el('button', 'danger', label)
    go.type = 'button'
    go.dataset['action'] = 'confirm'
    const cancel = el('button', '', 'Cancel')
    cancel.type = 'button'
    cancel.dataset['action'] = 'cancel'
    go.addEventListener('click', () => {
      host.replaceChildren()
      run()
    })
    cancel.addEventListener('click', () => host.replaceChildren())
    const buttons = el('div', 'row-buttons')
    buttons.append(go, cancel)
    block.append(buttons)
    host.replaceChildren(block)
    go.focus()
  }
}

// --------------------------------------------------------------------------
// Small DOM helpers. Nothing here is a component; they are the four shapes this
// panel repeats, named so the builders above read as the form they describe.
// --------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className !== '') element.className = className
  if (text !== '') element.textContent = text
  return element
}

function sectionOf(title: string): HTMLElement {
  const section = el('section')
  section.append(el('h3', '', title))
  return section
}

function note(text: string, tone = 'plain'): HTMLElement {
  const paragraph = el('p', 'note', text)
  paragraph.dataset['tone'] = tone
  return paragraph
}

function textField(
  parent: HTMLElement,
  key: string,
  value: string,
  placeholder: string,
): HTMLInputElement {
  const input = el('input', key)
  input.type = 'text'
  input.value = value
  input.placeholder = placeholder
  input.spellcheck = false
  input.autocomplete = 'off'
  input.setAttribute('aria-label', placeholder)
  input.dataset['field'] = key
  parent.append(input)
  return input
}

function iconButton(glyph: string, label: string): HTMLButtonElement {
  const button = el('button', 'icon', glyph)
  button.type = 'button'
  button.title = label
  button.setAttribute('aria-label', label)
  return button
}
