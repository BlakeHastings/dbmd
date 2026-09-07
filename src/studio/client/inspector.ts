/**
 * The inspector: the panel that turns the studio from a viewer into an editor.
 *
 * Everything it does goes through `PATCH /api/<kind>/:name` and the one writer
 * in `write.ts`, because ADR 0004 put the debounce in the server and there is
 * exactly one path from an edit to the disk. Nothing here holds an edit waiting
 * for a Save button, and nothing here holds a timer.
 *
 * It shows three kinds and they are three panels, because the three have almost
 * nothing in common to share: a table has columns and indexes and a rename that
 * moves other people's files, a note has a colour and a size and a body that is
 * the whole of it, and a group has a label and a list of members it does not
 * own. What they do share — the prose box, the delete confirmation, the colour
 * swatches — is one method each.
 *
 * **Membership is on the table's panel and not on the group's.** That is the
 * format showing through the interface rather than an oversight: a table
 * declares its own membership, so the file that changes is the table's, and two
 * branches adding two tables to the same group touch two different files (ADR
 * 0005). The group's panel lists its members and does not offer to edit them,
 * which is the interface saying which file each fact lives in.
 *
 * Six things in this file are decisions rather than plumbing, and each is at
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
 *
 * 6. **A group is the one thing here with no position to place.** Its form asks
 *    for a name, a label and a colour and never for coordinates, and says so,
 *    because the first thing a new user learns about groups should not be
 *    something that is not true (ADR 0005, ADR 0030).
 */

import type {
  Column,
  Group,
  Index,
  Layout,
  Note,
  ObjectKind,
  Ref,
  ReferentialAction,
  Table,
} from '../../model/types.js'
import { REFERENTIAL_ACTIONS } from '../../model/types.js'
import type { GroupPatch, NotePatch, TablePatch, WireModel } from '../wire.js'
import type { Selected } from './canvas.js'
import {
  endingOf,
  indexKeysText,
  keysAreEditableAsText,
  looksLikeExpressionKey,
  parseIndexColumns,
  parseRef,
  survivesATextarea,
  toModelBody,
  type LineEnding,
} from './fields.js'
import type { Point } from './geometry.js'
import { agreeing, referrersTo, referrerText, renamePlan } from './model.js'
import { PALETTE, unknownColorNote } from './palette.js'
import { clashFor, NEW_TABLE_SHAPE, suggestName, suggestTableName } from './tables.js'

export interface InspectorHandlers {
  /** The page's copy of the model. Read on demand so there is one copy, not two. */
  readonly model: () => WireModel
  /** An edit to the selected table: apply it to the page's copy and write it. */
  readonly onPatch: (name: string, patch: TablePatch, next: Table) => void
  /** An edit to the selected note. Same shape, one kind along. */
  readonly onPatchNote: (name: string, patch: NotePatch, next: Note) => void
  /** An edit to the selected group. Never a position: a group has none (ADR 0005). */
  readonly onPatchGroup: (name: string, patch: GroupPatch, next: Group) => void
  /** A rename, already confirmed by the developer. It touches several files. */
  readonly onRename: (from: string, to: string) => void
  /** A new table, named and placed. It writes one file and edits no other. */
  readonly onCreate: (name: string, at: Point) => void
  /** A new note, named and placed, with the colour the form was showing. */
  readonly onCreateNote: (name: string, at: Point, color: string | null) => void
  /**
   * A new group: a name, a label and a colour, and deliberately no position.
   *
   * A group is the one thing on this canvas that is not created by pointing at
   * a spot, because it has no spot: its box is its members' (ADR 0005), and
   * asking somebody to choose coordinates for one would teach them something
   * about this format that is not true.
   */
  readonly onCreateGroup: (name: string, label: string, color: string | null) => void
  /** A delete, already confirmed. The only thing here that destroys a file. */
  readonly onDelete: (kind: ObjectKind, name: string) => void
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
  /**
   * The two referential actions, and the row they sit on, which is hidden while
   * the `ref` field holds nothing to be about.
   *
   * They are shown rather than carried invisibly, which is the choice ADR 0016
   * takes everywhere: a panel that holds a fact it does not display is a panel
   * that deletes it the first time somebody retypes the ref, and the developer
   * would find out from a diff. ADR 0046.
   */
  readonly actions: HTMLDivElement
  readonly onDelete: HTMLSelectElement
  readonly onUpdate: HTMLSelectElement
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
 * An object that has been placed and not yet named, which is the whole of the
 * unsaved state this studio has.
 *
 * ADR 0004 says there is no document and no Save button, and this does not
 * introduce one: a file that does not exist has nothing to write through to, and
 * the moment it does exist every edit to it is immediate again. `at` is what
 * makes it worth holding at all, because it is where the developer pointed and
 * nothing else on the page remembers that.
 *
 * `at` is `null` for a group, and that is the format rather than a gap: a group
 * has no coordinates (ADR 0005), so there is nothing to have pointed at, and a
 * form that asked for a position would be the first thing a new user learned
 * about groups and it would be wrong.
 */
interface Placement {
  readonly kind: ObjectKind
  readonly at: Point | null
  /** What is in the name field, kept so a refusal can be shown without losing it. */
  name: string
  /** A group's label, and unused by the other two. */
  label: string
  /** The colour a new note or group is born with. Not a table's: a table has none. */
  color: string | null
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

/**
 * What the row says when the spelling above it has been typed into it.
 *
 * The panel prints `{ expression: lower(email) }` on the row it will not edit,
 * one line above a row it will, so copying it is the obvious move and it is the
 * wrong one: this field writes column names, so the model gets a column called
 * those characters. `index-column-unknown` then fires and offers to wrap it
 * again — `{ expression: { expression: lower(email) } }` — which is advice for
 * a case it was not written for, and following it does not work either.
 *
 * The row is the only place that knows the paste came from the panel, so the
 * row is where this is said. It is said and not acted on: the keys still reach
 * the file exactly as typed. ADR 0047.
 */
const INDEX_KEYS_LOOK_LIKE_AN_EXPRESSION =
  'that is how the file spells an expression key, but this field writes column names, so it has been written as a column called that; an expression key is a mapping this one-line field cannot make, so write that one in the file'

export class Inspector {
  private selected: Selected | null = null
  private placement: Placement | null = null
  private rows: ColumnRow[] = []
  private indexRows: IndexRow[] = []
  /** The layout readout on a note's panel, so a drag can keep it true. */
  private layoutLine: HTMLElement | null = null
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

  /** Draw the panel for one object, or close it. Rebuilds every field. */
  show(selected: Selected | null): void {
    this.placement = null
    this.selected = selected
    const parts = selected === null ? undefined : this.buildFor(selected)
    if (parts === undefined) {
      this.host.hidden = true
      this.host.replaceChildren()
      this.selected = null
      return
    }
    this.host.hidden = false
    this.host.replaceChildren(...parts)
  }

  private buildFor(selected: Selected): HTMLElement[] | undefined {
    const model = this.handlers.model()
    if (selected.kind === 'table') {
      const table = model.tables.find((held) => held.name === selected.name)
      return table === undefined ? undefined : this.build(table)
    }
    if (selected.kind === 'note') {
      const note = model.notes.find((held) => held.name === selected.name)
      return note === undefined ? undefined : this.buildNote(note)
    }
    const group = model.groups.find((held) => held.name === selected.name)
    return group === undefined ? undefined : this.buildGroup(group)
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

  /** A note was dragged or resized: keep the panel's readout true while it moves. */
  noteMoved(name: string, layout: Layout): void {
    if (this.selected?.kind !== 'note' || this.selected.name !== name) return
    if (this.layoutLine === null) return
    this.layoutLine.textContent = layoutText(layout)
  }

  /** Draw the form for a table or a note that does not exist yet, where pointed. */
  place(kind: 'table' | 'note', at: Point): void {
    this.selected = null
    const model = this.handlers.model()
    this.placement = {
      kind,
      at,
      name:
        kind === 'table'
          ? suggestTableName(model.tables.map((table) => table.name))
          : suggestName(
              'new-note',
              model.notes.map((note) => note.name),
            ),
      label: '',
      color: 'amber',
      refusal: null,
    }
    this.drawPlacement(true)
  }

  /**
   * Draw the form for a group, which is named and labelled and never placed.
   *
   * It is born with nothing in it, and it says so: a table joins a group from
   * that table's own panel, which is the one line in the one file the format
   * puts membership in. `dbmd check` warns about the empty group in between,
   * which is the warning working rather than the studio misbehaving.
   */
  draftGroup(): void {
    this.selected = null
    this.placement = {
      kind: 'group',
      at: null,
      name: suggestName(
        'new-group',
        this.handlers.model().groups.map((group) => group.name),
      ),
      label: '',
      color: 'violet',
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
    parts.push(this.nameSection(table), this.groupSection(table))
    parts.push(this.columnsSection(table), this.indexesSection(table))
    parts.push(this.bodySection(table), this.deleteSection(table))
    return parts
  }

  /**
   * Which group this table is in, which is one line in this table's own file.
   *
   * This is the whole of group membership, and putting it here rather than on
   * the group's panel is the format showing through the interface: a table
   * declares its own membership, so the file that changes is this one, and two
   * branches adding two tables to the same group touch two different files and
   * merge without a question (ADR 0005). A members list on the group's panel
   * would have been the same edit written into a shared file, which is the
   * design that record exists to refuse.
   */
  private groupSection(table: Table): HTMLElement {
    const section = sectionOf('Group')
    const groups = this.handlers.model().groups
    const select = el('select')
    select.dataset['field'] = 'group'
    select.setAttribute('aria-label', 'Group')
    for (const [value, text] of [
      ['', '(no group)'] as const,
      ...groups.map(
        (group) =>
          [
            group.name,
            group.label === undefined ? group.name : `${group.name} — ${group.label}`,
          ] as const,
      ),
    ]) {
      const option = el('option', '', text)
      option.value = value
      select.append(option)
    }
    // A `group:` naming a file that is not there is a `group-unknown` error and
    // still a real thing the file says, so it is shown rather than silently
    // reset to "(no group)", which would look like the studio agreeing.
    if (table.group !== undefined && !groups.some((group) => group.name === table.group)) {
      const option = el('option', '', `${table.group} (no groups/${table.group}.md)`)
      option.value = table.group
      select.append(option)
    }
    select.value = table.group ?? ''

    select.addEventListener('change', () => {
      const chosen = select.value === '' ? null : select.value
      const next: Table = { ...table }
      if (chosen === null) delete (next as { group?: string }).group
      else (next as { group?: string }).group = chosen
      this.handlers.onPatch(table.name, { group: chosen }, next)
    })

    const field = el('div', 'field')
    field.append(select)
    section.append(
      field,
      note(
        groups.length === 0
          ? 'No groups in this model yet. `Add group` on the toolbar writes one, and then this list has it.'
          : 'One line, `group: <name>`, in this file. The box on the canvas is worked out from whoever joined, so joining or leaving changes nothing in the group file.',
      ),
    )
    return section
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
    const kind = placement.kind
    const directory = `${kind}s`
    const header = el('header')
    const path = el('code', 'path')
    header.append(el('h2', 'title', `New ${kind}`), path)

    const section = sectionOf('Name')
    const field = el('div', 'field')
    const input = el('input')
    input.type = 'text'
    input.value = placement.name
    input.spellcheck = false
    input.autocomplete = 'off'
    input.setAttribute('aria-label', `New ${kind} name`)
    input.dataset['field'] = `new-${kind}-name`

    const create = el('button', 'primary', 'Create')
    create.type = 'button'
    create.dataset['action'] = `create-${kind}`
    const cancel = el('button', '', 'Cancel')
    cancel.type = 'button'
    cancel.dataset['action'] = `cancel-${kind}`
    field.append(input, create, cancel)

    const writes = note('')
    const said = el('p', 'notes')
    said.dataset['field'] = `new-${kind}-notes`
    const confirmHost = el('div', 'confirm-host')

    const taken = (): string[] => {
      const model = this.handlers.model()
      const held = kind === 'table' ? model.tables : kind === 'note' ? model.notes : model.groups
      return held.map((object) => object.name)
    }

    /**
     * Everything the form says about the name as it stands, without rebuilding
     * the field: the panel is not redrawn on a keystroke (rule 2 above), and
     * that rule does not stop over the form for a table that has no file yet.
     */
    const at = placement.at
    const restate = (): void => {
      const name = input.value.trim()
      placement.name = name
      path.textContent = name === '' ? `${directory}/….md` : `${directory}/${name}.md`
      writes.textContent =
        name === ''
          ? at === null
            ? 'Writes one file, and edits no other.'
            : `Writes one file, at ${at.x}, ${at.y} on the canvas, and edits no other.`
          : kind === 'table'
            ? `Writes tables/${name}.md, with layout: { x: ${at?.x ?? 0}, y: ${at?.y ?? 0} } and ${NEW_TABLE_SHAPE}. No other file in the model changes.`
            : kind === 'note'
              ? `Writes notes/${name}.md, with layout: { x: ${at?.x ?? 0}, y: ${at?.y ?? 0} } and color: ${placement.color}. The body is the note; type it in the panel afterwards. No other file in the model changes.`
              : `Writes groups/${name}.md, with color: ${placement.color} and no coordinates at all. Its box is worked out from whatever joins it, and a table joins from its own panel.`
      confirmHost.replaceChildren()

      const lines: string[] = []
      // Only while the field still holds the name that was refused. Otherwise
      // the panel is complaining about a name the developer has moved on from.
      if (placement.refusal?.name === name) lines.push(placement.refusal.message)
      if (name === '') {
        lines.push(`A ${kind} needs a name: the file name is the identity.`)
      } else {
        const clash = clashFor(name, taken())
        if (clash?.kind === 'same') lines.push(`there is already a ${kind} called \`${name}\``)
        if (clash?.kind === 'case') {
          lines.push(
            `\`${clash.held}\` differs from this only in case, which is two ${kind}s on Linux and one file on Windows and macOS`,
          )
        }
      }
      said.textContent = lines.join('. ')
      said.hidden = lines.length === 0
    }

    const write = (): void => {
      confirmHost.replaceChildren()
      placement.refusal = null
      if (kind === 'group') {
        this.handlers.onCreateGroup(placement.name, placement.label, placement.color)
        return
      }
      if (at === null) return
      if (kind === 'note') this.handlers.onCreateNote(placement.name, at, placement.color)
      else this.handlers.onCreate(placement.name, at)
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
            `Linux keeps two files and this model has two ${kind}s. Windows and macOS keep one, under whichever name got there first, holding whatever was written last, so the model a colleague checks out is missing one of them.`,
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

    section.append(field)

    if (kind === 'group') {
      const label = el('input')
      label.type = 'text'
      label.value = placement.label
      label.placeholder = 'label, as it reads on the box'
      label.spellcheck = false
      label.autocomplete = 'off'
      label.setAttribute('aria-label', 'Group label')
      label.dataset['field'] = 'new-group-label'
      label.addEventListener('input', () => {
        placement.label = label.value
      })
      const labelField = el('div', 'field')
      labelField.append(label)
      section.append(labelField)
    }

    if (kind !== 'table') {
      section.append(
        this.colorField(placement.color, (color) => {
          placement.color = color
          restate()
        }),
      )
    }

    section.append(
      writes,
      note(
        kind === 'group'
          ? 'A group has no coordinates. Its box is the bounding box of the tables that declare `group: ' +
              `${placement.name}` +
              '`, computed every time it is drawn, so dragging it writes one `layout` line per member and never touches this file (ADR 0005).'
          : `It goes where you pointed. A position nobody chose is computed and never written (ADR 0015), so pointing is the only way a new ${kind} gets a \`layout\` at all.`,
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
  // The colour, which is a name from a small list and never a hex value.
  // ------------------------------------------------------------------------

  /**
   * A row of swatches, plus "none", which is the absence of the key.
   *
   * A `<select>` of names would do the same job and say less: the point of the
   * list is that these are the seven the studio can draw legibly in both
   * themes, and a swatch shows that where a word does not. The value that
   * reaches the file is still the name (`color: amber`), because the diff is
   * what this format is for.
   */
  private colorField(
    current: string | null | undefined,
    choose: (color: string | null) => void,
  ): HTMLElement {
    const row = el('div', 'swatches')
    row.dataset['field'] = 'color'
    const buttons: HTMLButtonElement[] = []
    const mark = (chosen: string | undefined): void => {
      for (const button of buttons) {
        button.setAttribute(
          'aria-pressed',
          String((button.dataset['color'] ?? '') === (chosen ?? '')),
        )
      }
    }
    for (const color of ['', ...PALETTE]) {
      const button = el('button', color === '' ? 'swatch none' : `swatch tint-${color}`)
      button.type = 'button'
      button.dataset['color'] = color
      button.title = color === '' ? 'no colour: the file has no `color` key' : `color: ${color}`
      button.setAttribute('aria-label', button.title)
      button.addEventListener('click', () => {
        mark(color === '' ? undefined : color)
        choose(color === '' ? null : color)
      })
      buttons.push(button)
      row.append(button)
    }
    mark(current ?? undefined)

    const section = el('div', 'color-field')
    section.append(el('h3', '', 'Colour'), row)
    const unknown = unknownColorNote(current ?? undefined)
    if (unknown !== undefined) section.append(note(unknown, 'bad'))
    return section
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
    const refused = el('p', 'notes')
    refused.dataset['field'] = 'rename-notes'
    refused.hidden = true

    const askToRename = (): void => {
      const to = input.value.trim()
      const from = table.name
      confirmHost.replaceChildren()
      refused.hidden = true
      if (to === from || to === '') {
        input.value = from
        return
      }

      // Worked out before anything is drawn, rather than after the developer has
      // agreed to it. The server refuses a taken name too and has to, because a
      // client is not a permission system; what it cannot do is get its answer
      // in before the paragraph is read, and the moment before the button is
      // pressed is the one moment that paragraph exists for.
      const plan = renamePlan(this.handlers.model(), from, to)
      if (plan.kind === 'refused') {
        refused.textContent = plan.said
        refused.hidden = false
        return
      }
      this.confirm(confirmHost, plan.lines, 'Rename', () => {
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
        refused.hidden = true
      }
    })

    field.append(input, button)
    section.append(
      field,
      note(
        'Renaming is not a keystroke: it writes one file, deletes another and edits everyone who refs it, so it waits for the button.',
      ),
      refused,
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

    const actions = el('div', 'flags actions')
    const onDelete = actionField(actions, 'on delete', column.ref?.onDelete)
    const onUpdate = actionField(actions, 'on update', column.ref?.onUpdate)
    // Hidden rather than absent, so that typing a ref reveals it without the
    // row being rebuilt under the cursor, which is decision 2 at the top of this
    // file. An action with no ref is a diagnostic in the reader, so the panel
    // simply never offers one.
    actions.hidden = column.ref === undefined
    item.append(actions)

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
      actions,
      onDelete,
      onUpdate,
      notes,
      was: column.name,
    }

    for (const input of [name, type, fallback, ref]) {
      input.addEventListener('input', () => this.commitColumns())
    }
    pk.addEventListener('change', () => this.commitColumns())
    nullable.addEventListener('change', () => this.commitColumns())
    onDelete.addEventListener('change', () => this.commitColumns())
    onUpdate.addEventListener('change', () => this.commitColumns())
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
    const name = this.tableName()
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
        `${referrers.length} ${agreeing(referrers.length, 'ref points', 'refs point')} at it and will be left dangling: ${referrerText(referrers)}.`,
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
    const name = this.tableName()
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
      // The two action fields belong to the ref and go with it: a column with no
      // ref has nothing for them to be about, which is an error in the reader,
      // so the panel hides them rather than writing one.
      row.actions.hidden = ref === 'absent' || ref === 'malformed'
      if (ref === 'malformed') {
        said.push(
          `\`${row.ref.value.trim()}\` is not a ref: write \`table.column\`. Until it is, no ref is being saved on this column`,
        )
      } else if (ref !== 'absent') {
        const onDelete = actionOf(row.onDelete)
        const onUpdate = actionOf(row.onUpdate)
        column.ref = {
          ...ref,
          ...(onDelete === undefined ? {} : { onDelete }),
          ...(onUpdate === undefined ? {} : { onUpdate }),
        }
      }

      if (text !== row.was && row.was !== '') {
        const orphans = referrersTo(this.handlers.model(), name, row.was)
        if (orphans.length > 0) {
          said.push(
            `${orphans.length} ${agreeing(orphans.length, 'ref still points', 'refs still point')} at \`${name}.${row.was}\` and ${agreeing(orphans.length, 'is', 'are')} not being moved: ${referrerText(orphans)}`,
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
    const name = this.tableName()
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
      else if (looksLikeExpressionKey(row.columns.value))
        said.push(INDEX_KEYS_LOOK_LIKE_AN_EXPRESSION)
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
    return this.proseSection(table.body, 'Prose', (body) => {
      const name = this.tableName()
      const current = name === null ? undefined : this.tableOf(name)
      if (name === null || current === undefined) return
      this.handlers.onPatch(name, { body }, { ...current, body })
    })
  }

  /**
   * The prose of whatever is selected, as plain text, with the line-ending
   * promise on it.
   *
   * One section for all three kinds, and one line-ending rule with it, because
   * the rule is about the widget rather than about the kind: `textarea.value`
   * normalises to LF whatever was assigned, and the body of any model file
   * reaches disk exactly as it arrived. A second copy of this for notes would
   * be a second place for that to be got wrong, and a note is the file most
   * likely to be a paragraph somebody pasted out of an editor.
   *
   * The note is drawn on the canvas with its markdown rendered and edited here
   * as the characters that are in the file. That is deliberate: what reaches
   * disk is the text, and an editor that showed bold as bold would be a second
   * opinion about what the author wrote.
   */
  private proseSection(body: string, title: string, write: (body: string) => void): HTMLElement {
    const section = sectionOf(title)
    this.eol = endingOf(body)
    this.body = el('textarea')
    this.body.value = body
    this.body.spellcheck = false
    this.body.rows = 12
    this.body.dataset['field'] = 'body'
    this.body.setAttribute('aria-label', 'Prose body')
    this.body.addEventListener('input', () => write(this.bodyText()))

    section.append(this.body)
    // A body that is neither all-LF nor all-CRLF cannot survive a textarea,
    // which has one normalisation and no memory of what it replaced. Saying so
    // is better than either refusing the edit or quietly flattening the file.
    if (!survivesATextarea(body, this.eol)) {
      section.append(
        note(
          `This body mixes line endings. A textarea cannot hold that, so saving from here makes them all ${this.eol === '\r\n' ? 'CRLF' : 'LF'}.`,
          'bad',
        ),
      )
    } else {
      section.append(
        note(
          `Carried byte for byte, ${this.eol === '\r\n' ? 'CRLF' : 'LF'} endings and all. What is typed here is what reaches the file, never reflowed.`,
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
            : `${orphans.length} ${agreeing(orphans.length, 'ref', 'refs')} in ${files.length} other ${agreeing(files.length, 'file', 'files')} will be left pointing at nothing: ${referrerText(orphans)}. Those files are not edited. dbmd will report each one as \`ref-table-unknown\` until you fix it.`,
          ...this.lastMemberWarning(table),
          'Undo is `git checkout`, and only for a file that was committed. This one is gone from the disk either way.',
        ],
        'Delete',
        () => this.handlers.onDelete('table', table.name),
      )
    })

    section.append(button, confirmHost)
    return section
  }

  /**
   * That this table is the last thing in its group, said before it goes.
   *
   * The group file is deliberately left alone: deleting somebody's prose about
   * a region because the last table in it went is a thing that cannot be undone
   * and was never asked for. What is left is an empty group, which draws as a
   * placeholder so it does not look deleted, and which `dbmd check` reports as
   * `group-empty` because that is nearly always a rename that missed a file.
   */
  private lastMemberWarning(table: Table): string[] {
    if (table.group === undefined) return []
    const others = this.handlers
      .model()
      .tables.filter((held) => held.group === table.group && held.name !== table.name)
    if (others.length > 0) return []
    return [
      `\`${table.group}\` will have nothing in it. groups/${table.group}.md is not deleted and not edited: it keeps its label and its prose, draws as an empty box, and dbmd reports it as \`group-empty\` until something joins it or you delete the file yourself.`,
    ]
  }

  // ------------------------------------------------------------------------
  // The other two kinds.
  // ------------------------------------------------------------------------

  /**
   * A note: its colour, its prose, where it is, and how to get rid of it.
   *
   * There is no name field and no rename. A note's identity is its file name
   * and nothing points at a note, so renaming one is `git mv`, which is the
   * honest answer rather than a button that would have to explain that it is
   * writing one file and deleting another for no reason but tidiness.
   */
  private buildNote(sticky: Note): HTMLElement[] {
    const header = el('header')
    header.append(el('h2', 'title', sticky.name), el('code', 'path', sticky.path))
    const parts: HTMLElement[] = [header]

    if (!sticky.complete) {
      parts.push(
        this.brokenNotice(sticky.path),
        this.deleteObjectSection('note', sticky.name, sticky.path, []),
      )
      return parts
    }

    const colour = el('section')
    colour.append(
      this.colorField(sticky.color, (color) => {
        const next: Note = { ...sticky }
        if (color === null) delete (next as { color?: string }).color
        else (next as { color?: string }).color = color
        this.handlers.onPatchNote(sticky.name, { color }, next)
      }),
      note(
        "A name from the studio's list, so the diff says `color: amber` rather than a hex value (ADR 0005).",
      ),
    )
    parts.push(colour)

    parts.push(
      this.proseSection(sticky.body, 'The note', (body) =>
        this.handlers.onPatchNote(sticky.name, { body }, { ...sticky, body }),
      ),
    )
    parts.push(this.layoutSection(sticky.layout))
    parts.push(this.deleteObjectSection('note', sticky.name, sticky.path, []))
    return parts
  }

  /**
   * A group: its label, its colour, its prose, and who is in it.
   *
   * The members are listed and are not editable here, and that is the record
   * rather than an unfinished panel: membership is declared by the member (ADR
   * 0005), so the control that changes it is on the table's own panel and edits
   * the table's own file. Listing them here without offering to edit them is
   * the interface saying which file each fact lives in.
   */
  private buildGroup(group: Group): HTMLElement[] {
    const header = el('header')
    header.append(el('h2', 'title', group.name), el('code', 'path', group.path))
    const parts: HTMLElement[] = [header]

    if (!group.complete) {
      parts.push(
        this.brokenNotice(group.path),
        this.deleteObjectSection('group', group.name, group.path, []),
      )
      return parts
    }

    const labelSection = sectionOf('Label')
    const label = el('input')
    label.type = 'text'
    label.value = group.label ?? ''
    label.spellcheck = false
    label.autocomplete = 'off'
    label.placeholder = 'what the box is called'
    label.setAttribute('aria-label', 'Group label')
    label.dataset['field'] = 'label'
    label.addEventListener('input', () => {
      const value = label.value === '' ? null : label.value
      const next: Group = { ...group }
      if (value === null) delete (next as { label?: string }).label
      else (next as { label?: string }).label = value
      this.handlers.onPatchGroup(group.name, { label: value }, next)
    })
    const labelField = el('div', 'field')
    labelField.append(label)
    labelSection.append(labelField, note('One line in this file. Nothing else changes.'))
    parts.push(labelSection)

    const colour = el('section')
    colour.append(
      this.colorField(group.color, (color) => {
        const next: Group = { ...group }
        if (color === null) delete (next as { color?: string }).color
        else (next as { color?: string }).color = color
        this.handlers.onPatchGroup(group.name, { color }, next)
      }),
    )
    parts.push(colour)

    const members = this.handlers.model().tables.filter((table) => table.group === group.name)
    const memberSection = sectionOf('Members')
    if (members.length === 0) {
      memberSection.append(
        note(
          `Nothing declares \`group: ${group.name}\`. The box on the canvas is a placeholder, not a deletion, and dbmd reports this as \`group-empty\` until a table joins.`,
        ),
      )
    } else {
      const list = el('ul', 'members')
      list.dataset['field'] = 'members'
      for (const member of members) list.append(el('li', '', `tables/${member.name}.md`))
      memberSection.append(list)
    }
    memberSection.append(
      note(
        "Membership is declared by the member, so it is changed on a table's panel and written in that table's file. This file never lists them (ADR 0005).",
      ),
    )
    if (members.length > 0) {
      // A rule rather than a count. A count read off the canvas would be true
      // when the panel was drawn and false as soon as somebody dragged a table,
      // and this panel is not redrawn by a drag: the live answer is on the
      // label bar, which is redrawn every frame (ADR 0035).
      memberSection.append(
        note(
          'The box on the canvas is the bounding box of those members plus padding, so it can reach over a table or a note that never joined. Anything it reaches over is cut out of the box and counted on its label bar. Nothing is moved and no rectangle is stored here.',
        ),
      )
    }
    parts.push(memberSection)

    parts.push(
      this.proseSection(group.body, 'Prose', (body) =>
        this.handlers.onPatchGroup(group.name, { body }, { ...group, body }),
      ),
    )
    parts.push(
      this.deleteObjectSection('group', group.name, group.path, [
        members.length === 0
          ? 'Nothing is in it, so nothing else in the model mentions it.'
          : `${members.length} table${members.length === 1 ? '' : 's'} still declare \`group: ${group.name}\` and are not edited: ${members.map((member) => `tables/${member.name}.md`).join(', ')}. dbmd will report each one as \`group-unknown\` until you change or remove that line.`,
      ]),
    )
    return parts
  }

  private brokenNotice(path: string): HTMLElement {
    return note(
      `${path} did not parse, so this server is holding less than the file does and will not write over it. Fix the file and reload.`,
      'bad',
    )
  }

  /**
   * Where a note is, as a readout. It is changed by dragging, not by typing.
   *
   * Kept up to date by `noteMoved`, which is the one thing on this panel that a
   * drag changes. Rule 2 above says the panel is not redrawn by its own edit,
   * and this is not a redraw: it is one line of text, nothing here has focus
   * during a drag, and a readout that said where the note used to be is exactly
   * the sort of claim this item exists to stop the studio making.
   */
  private layoutSection(layout: Layout | undefined): HTMLElement {
    const section = sectionOf('Layout')
    this.layoutLine = el('p', 'key', layoutText(layout))
    this.layoutLine.dataset['field'] = 'layout'
    section.append(
      this.layoutLine,
      note(
        "Drag the note to move it and its bottom-right corner to resize it. `w` and `h` are a note's alone: a table's size is a consequence of its columns.",
      ),
    )
    return section
  }

  private deleteObjectSection(
    kind: ObjectKind,
    name: string,
    path: string,
    extra: readonly string[],
  ): HTMLElement {
    const section = sectionOf('Delete')
    const button = el('button', 'danger', `Delete this ${kind}`)
    button.type = 'button'
    button.dataset['action'] = `delete-${kind}`
    const confirmHost = el('div', 'confirm-host')
    button.addEventListener('click', () => {
      this.confirm(
        confirmHost,
        [
          `Delete \`${name}\`?`,
          `This deletes ${path} and edits no other file.`,
          ...extra,
          'Undo is `git checkout`, and only for a file that was committed. This one is gone from the disk either way.',
        ],
        'Delete',
        () => this.handlers.onDelete(kind, name),
      )
    })
    section.append(button, confirmHost)
    return section
  }

  private tableOf(name: string): Table | undefined {
    return this.handlers.model().tables.find((table) => table.name === name)
  }

  /** The selected table's name, or null when what is selected is not a table. */
  private tableName(): string | null {
    return this.selected?.kind === 'table' ? this.selected.name : null
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

/** A `layout` as the file spells it, which is what the readout shows. */
function layoutText(layout: Layout | undefined): string {
  if (layout === undefined) return 'No `layout` in the file. Drag it once and it gets one.'
  const size = `${layout.w === undefined ? '' : `, w: ${layout.w}`}${layout.h === undefined ? '' : `, h: ${layout.h}`}`
  return `layout: { x: ${layout.x}, y: ${layout.y}${size} }`
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

/**
 * One referential action, as a select whose empty option is "the file does not
 * say".
 *
 * Absent and `no action` are different facts (ADR 0046), so "unsaid" is an
 * option of its own rather than the same thing as the standard's default, and
 * the shape is the `nullable` select's for the same reason: a closed vocabulary
 * with a nothing in it.
 */
function actionField(
  parent: HTMLElement,
  key: 'on delete' | 'on update',
  value: ReferentialAction | undefined,
): HTMLSelectElement {
  const select = el('select')
  const unsaid = el('option', '', `${key}: unsaid`)
  unsaid.value = ''
  select.append(unsaid)
  for (const action of REFERENTIAL_ACTIONS) {
    const option = el('option', '', `${key}: ${action}`)
    option.value = action
    select.append(option)
  }
  select.value = value ?? ''
  select.setAttribute('aria-label', key)
  select.dataset['field'] = key
  parent.append(select)
  return select
}

/** What a select holds, or nothing when it holds the unsaid option. */
function actionOf(select: HTMLSelectElement): ReferentialAction | undefined {
  return REFERENTIAL_ACTIONS.find((action) => action === select.value)
}

function iconButton(glyph: string, label: string): HTMLButtonElement {
  const button = el('button', 'icon', glyph)
  button.type = 'button'
  button.title = label
  button.setAttribute('aria-label', label)
  return button
}
