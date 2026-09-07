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
 *
 * 5. **The panel also shows a table that does not exist yet.** Creating one
 *    needs a `layout`, which is the one thing about it the server cannot invent
 *    (ADR 0021), so the developer points at a spot on the canvas and the name is
 *    typed here. A second thing for this panel to show rather than a second
 *    panel, because the confirmation, the notes and the fields are already here.
 *    Deleting one lives here too, at the bottom, and is the only thing in this
 *    studio that destroys a file.
 */

import type { Column, Index, Ref, Table } from '../../model/types.js'
import type { TablePatch, WireModel } from '../wire.js'
import {
  endingOf,
  indexKeysText,
  keysAreEditableAsText,
  parseIndexColumns,
  parseRef,
  survivesATextarea,
  toModelBody,
  type LineEnding,
} from './fields.js'
import type { Point } from './geometry.js'
import { referrersTo, referrerText } from './model.js'
import { clashFor, NEW_TABLE_SHAPE, suggestTableName } from './tables.js'

export interface InspectorHandlers {
  /** The page's copy of the model. Read on demand so there is one copy, not two. */
  readonly model: () => WireModel
  /** An edit to the selected table: apply it to the page's copy and write it. */
  readonly onPatch: (name: string, patch: TablePatch, next: Table) => void
  /** A rename, already confirmed by the developer. It touches several files. */
  readonly onRename: (from: string, to: string) => void
  /** A new table, named and placed. It writes one file and edits no other. */
  readonly onCreate: (name: string, at: Point) => void
  /** A delete, already confirmed. The only thing here that destroys a file. */
  readonly onDelete: (name: string) => void
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
  /**
   * The keys this row arrived with, kept only when the one text field cannot
   * represent them, which today means the row holds an expression key. The
   * field is read-only in that case and these go back out unchanged, so that
   * editing this row's name, or any other row, cannot rewrite an expression as
   * a column called the same characters. ADR 0022.
   */
  readonly heldColumns?: Index['columns']
}

/**
 * A table that has been placed and not yet named, which is the whole of the
 * unsaved state this studio has.
 *
 * ADR 0004 says there is no document and no Save button, and this does not
 * introduce one: a file that does not exist has nothing to write through to, and
 * the moment it does exist every edit to it is immediate again. `at` is what
 * makes it worth holding at all, because it is where the developer pointed and
 * nothing else on the page remembers that.
 */
interface Placement {
  readonly at: Point
  /** What is in the name field, kept so a refusal can be shown without losing it. */
  name: string
  /**
   * The server's own words for a create it would not do, and the name it
   * refused.
   *
   * The name is stored with the message because a refusal is about a name rather
   * than about the form: `nul` is not a file name and `invoices` is, and leaving
   * the first sentence up while the second is being typed is the panel accusing
   * a name nobody has tried yet.
   */
  refusal: { readonly name: string; readonly message: string } | null
}

/**
 * Why one index's keys are shown and not edited here.
 *
 * The keys field is one comma-separated line and an expression key is a mapping
 * (ADR 0022), so there is no text that would come back as the thing on disk. A
 * field that accepted an edit would be offering to replace `lower(email)` with
 * a column called `lower(email)`, which is a different index and a legal one.
 */
const INDEX_KEYS_NOT_EDITABLE =
  'this index has an expression key, which this one-line field cannot hold, so its keys are shown here and changed in the file'

export class Inspector {
  private name: string | null = null
  private placement: Placement | null = null
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
    this.placement = null
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

  /**
   * Whether the panel is holding a table that has no file yet.
   *
   * The one piece of unsaved state in this studio, and therefore the one thing
   * a redraw from the disk would destroy. The page asks before it adopts.
   */
  get placing(): boolean {
    return this.placement !== null
  }

  /** Draw the form for a table that does not exist yet, at the point pointed at. */
  place(at: Point): void {
    this.name = null
    this.placement = {
      at,
      name: suggestTableName(this.handlers.model().tables.map((table) => table.name)),
      refusal: null,
    }
    this.drawPlacement(true)
  }

  /**
   * The server would not create it. Keep the form, and say why in its words.
   *
   * `safe-path.ts` refuses a name a file cannot have, and it refuses it in a
   * sentence written for a person. Repeating that rule here would be a second
   * copy to keep in step; showing the sentence is the whole of what this page
   * needs to do about it (ADR 0021).
   */
  placementRefused(name: string, message: string): void {
    if (this.placement === null) return
    this.placement.refusal = { name, message }
    this.drawPlacement(false)
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
      // Deleting it is still offered, and is the only thing this panel can
      // usefully do with a file it could not read: every other section edits
      // something the server has refused to write back.
      parts.push(this.deleteSection(table))
      return parts
    }
    parts.push(this.nameSection(table), this.columnsSection(table), this.indexesSection(table))
    parts.push(this.bodySection(table), this.deleteSection(table))
    return parts
  }

  private heading(table: Table): HTMLElement {
    const header = el('header')
    header.append(el('h2', 'title', table.name), el('code', 'path', table.path))
    return header
  }

  // ------------------------------------------------------------------------
  // A table that does not exist yet.
  // ------------------------------------------------------------------------

  private drawPlacement(focus: boolean): void {
    const placement = this.placement
    if (placement === null) return
    this.host.hidden = false
    this.host.replaceChildren(...this.buildPlacement(placement, focus))
  }

  /**
   * The form, and everything it is about to do, said before it does it.
   *
   * The two sentences that matter are the file it will write and the fact that
   * it will write nothing else, which is the property a create has and a rename
   * does not. The third is the case clash, which is the one thing about a name
   * the server cannot decide for anybody else's checkout (`tables.ts`).
   */
  private buildPlacement(placement: Placement, focus: boolean): HTMLElement[] {
    const header = el('header')
    const path = el('code', 'path')
    header.append(el('h2', 'title', 'New table'), path)

    const section = sectionOf('Name')
    const field = el('div', 'field')
    const input = el('input')
    input.type = 'text'
    input.value = placement.name
    input.spellcheck = false
    input.autocomplete = 'off'
    input.setAttribute('aria-label', 'New table name')
    input.dataset['field'] = 'new-table-name'

    const create = el('button', 'primary', 'Create')
    create.type = 'button'
    create.dataset['action'] = 'create-table'
    const cancel = el('button', '', 'Cancel')
    cancel.type = 'button'
    cancel.dataset['action'] = 'cancel-table'
    field.append(input, create, cancel)

    const writes = note('')
    const said = el('p', 'notes')
    said.dataset['field'] = 'new-table-notes'
    const confirmHost = el('div', 'confirm-host')

    const taken = (): string[] => this.handlers.model().tables.map((table) => table.name)

    /**
     * Everything the form says about the name as it stands, without rebuilding
     * the field: the panel is not redrawn on a keystroke (rule 2 above), and
     * that rule does not stop over the form for a table that has no file yet.
     */
    const restate = (): void => {
      const name = input.value.trim()
      placement.name = name
      path.textContent = name === '' ? 'tables/….md' : `tables/${name}.md`
      writes.textContent =
        name === ''
          ? `Writes one file, at ${placement.at.x}, ${placement.at.y} on the canvas, and edits no other.`
          : `Writes tables/${name}.md, with layout: { x: ${placement.at.x}, y: ${placement.at.y} } and ${NEW_TABLE_SHAPE}. No other file in the model changes.`
      confirmHost.replaceChildren()

      const lines: string[] = []
      // Only while the field still holds the name that was refused. Otherwise
      // the panel is complaining about a name the developer has moved on from.
      if (placement.refusal?.name === name) lines.push(placement.refusal.message)
      if (name === '') {
        lines.push('A table needs a name: the file name is the identity.')
      } else {
        const clash = clashFor(name, taken())
        if (clash?.kind === 'same') lines.push(`there is already a table called \`${name}\``)
        if (clash?.kind === 'case') {
          lines.push(
            `\`${clash.held}\` differs from this only in case, which is two tables on Linux and one file on Windows and macOS`,
          )
        }
      }
      said.textContent = lines.join('. ')
      said.hidden = lines.length === 0
    }

    const write = (): void => {
      confirmHost.replaceChildren()
      placement.refusal = null
      this.handlers.onCreate(placement.name, placement.at)
    }

    const askToCreate = (): void => {
      restate()
      const name = placement.name
      if (name === '') return
      const clash = clashFor(name, taken())
      if (clash?.kind === 'same') return
      if (clash?.kind === 'case') {
        this.confirm(
          confirmHost,
          [
            `Create \`${name}\` beside \`${clash.held}\`?`,
            'Linux keeps two files and this model has two tables. Windows and macOS keep one, under whichever name got there first, holding whatever was written last, so the model a colleague checks out is missing one of them.',
            'Lowercase letters, digits, hyphens and underscores are the habit that never runs into this. `docs/format.md` has the measurement.',
          ],
          'Create anyway',
          write,
        )
        return
      }
      write()
    }

    input.addEventListener('input', restate)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') askToCreate()
      if (event.key === 'Escape') this.show(null)
    })
    create.addEventListener('click', askToCreate)
    cancel.addEventListener('click', () => this.show(null))

    section.append(
      field,
      writes,
      note(
        'It goes where you pointed. A position nobody chose is computed and never written (ADR 0015), so pointing is the only way a new table gets a `layout` at all.',
      ),
      said,
      confirmHost,
    )
    restate()
    if (focus) {
      input.focus()
      input.select()
    }
    return [header, section]
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
    const editable = keysAreEditableAsText(index.columns)
    const columns = textField(item, 'columns', indexKeysText(index.columns), 'columns, in order')
    // Shown and not edited. There is no text a person could type here that
    // comes back as an expression key, so an editable field would be offering
    // to replace one with a column of the same characters, which is a different
    // index and a legal one. ADR 0022.
    columns.readOnly = !editable

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
    if (!editable) {
      // Said now rather than only on the next edit, because the refusal is a
      // property of the row and a person has to see it before they try.
      notes.textContent = INDEX_KEYS_NOT_EDITABLE
      notes.hidden = false
    }

    const row: IndexRow = {
      item,
      name,
      columns,
      unique,
      notes,
      ...(editable ? {} : { heldColumns: index.columns }),
    }
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
      // A held row's keys never come from the field, so a save prompted by any
      // other row cannot rewrite them, and this row's name and `unique` stay
      // editable around keys nothing touched.
      const columns = row.heldColumns ?? parseIndexColumns(row.columns.value)
      const index: { name: string; columns: Index['columns']; unique?: boolean } = {
        name: row.name.value,
        columns,
      }
      if (row.unique.checked) index.unique = true
      indexes.push(index)

      const said: string[] = []
      if (row.name.value === '') said.push('this index has no name')
      if (columns.length === 0) said.push('this index names no columns')
      if (row.heldColumns !== undefined) said.push(INDEX_KEYS_NOT_EDITABLE)
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

  /**
   * The one destructive thing in this studio, and what it costs said first.
   *
   * Every other edit here writes a file that can be read back; this one removes
   * it. Three things are worth saying before it happens and are all said in the
   * confirmation: which file goes, which refs in other people's files are left
   * pointing at nothing and what dbmd will call them, and that the undo the
   * status line offers is `git checkout`, which can only bring back a file that
   * was committed. A table created and deleted in the same session leaves
   * nothing behind for git to restore, and saying so afterwards is too late.
   */
  private deleteSection(table: Table): HTMLElement {
    const section = sectionOf('Delete')
    const button = el('button', 'danger', 'Delete this table')
    button.type = 'button'
    button.dataset['action'] = 'delete-table'
    const confirmHost = el('div', 'confirm-host')

    button.addEventListener('click', () => {
      // A self-reference goes with the file, so it is not left dangling and
      // counting it would overstate what this costs by one.
      const orphans = referrersTo(this.handlers.model(), table.name).filter(
        (referrer) => referrer.table !== table.name,
      )
      const files = [...new Set(orphans.map((referrer) => referrer.table))]
      this.confirm(
        confirmHost,
        [
          `Delete \`${table.name}\`?`,
          `This deletes ${table.path} and edits no other file.`,
          orphans.length === 0
            ? 'Nothing else in the model refs this table, so nothing is left pointing at it.'
            : `${orphans.length} ref${orphans.length === 1 ? '' : 's'} in ${files.length} other file${files.length === 1 ? '' : 's'} will be left pointing at nothing: ${referrerText(orphans)}. Those files are not edited. dbmd will report each one as \`ref-table-unknown\` until you fix it.`,
          'Undo is `git checkout`, and only for a file that was committed. This one is gone from the disk either way.',
        ],
        'Delete',
        () => this.handlers.onDelete(table.name),
      )
    })

    section.append(button, confirmHost)
    return section
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
