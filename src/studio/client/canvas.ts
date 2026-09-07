/**
 * The canvas: boxes, notes, groups, edges, pan, zoom and drag.
 *
 * ADR 0004 chose no UI framework and no diagram library, and named exactly this
 * shape: boxes are absolutely positioned elements, edges are one SVG overlay,
 * and pan and zoom are a CSS transform on the element that holds both. This
 * file is that sentence.
 *
 * Five things in here are the difference between a canvas that looks finished
 * and one that is, and each is at the line it happens:
 *
 * 1. **One coordinate conversion.** Every interaction goes through
 *    `geometry.ts`. A drag is expressed as "the model point under the pointer,
 *    minus where in the box the pointer grabbed it", which is scale-independent
 *    by construction rather than by a correction factor.
 * 2. **Pointer events, captured.** The pointer is captured on the canvas at
 *    pointerdown, so a fast drag that leaves the window keeps delivering moves
 *    and still gets its pointerup. Without it the box stays glued to the cursor
 *    and the model gets whatever the last event before the boundary said.
 * 3. **The end of a drag is not the end of the write.** A table or a note hands
 *    every move to the owner as it happens and the final position once more, so
 *    a write can never be waiting inside this file for an event that is not
 *    coming. The debounce lives in the server (ADR 0004), which is not affected
 *    by the tab losing focus, and there is deliberately not a second one here.
 * 4. **A group drag is the one exception to that, and it is one on purpose.**
 *    Dragging a group moves every member, so handing over every frame would be
 *    one request per member per frame. It is handed over once, on pointerup, as
 *    one batch, naming only the members whose rounded position actually
 *    changed. What makes that safe is that the end of the gesture always
 *    arrives: `pointercancel` and `lostpointercapture` are wired to the same
 *    handler as `pointerup`, so there is no path where the batch is left
 *    waiting for an event that is not coming.
 * 5. **Where a column's row sits is measured here and nowhere else.** ADR 0018.
 *    An edge lands on a row rather than on a box, and a row's position is a
 *    fact about the rendered page rather than about the model, so this is the
 *    file that can know it. It is taken once per layout and kept as an offset
 *    inside the box, so a drag carries it along for free and only a change to
 *    what a box contains asks for it again.
 *
 * **A group has no coordinates and nothing here gives it any.** Its box is
 * computed by `groups.ts` from the boxes of its members on every draw, which
 * during a drag are where the pointer has put them. There is no field on this
 * class holding a group's rectangle between frames, because a field like that
 * is the cache that ADR 0005 says turns into a stored coordinate the first time
 * somebody wants to resize a group. The only thing a group drag writes is one
 * `layout` line per member, in each member's own file.
 *
 * **Z-order is three layers and it is an argument rather than a preference.**
 * Groups are behind everything, because a group is a region and a region that
 * covered its own members would be a fill rather than a boundary. Notes are in
 * front of the tables, because a note is a person talking and the thing a
 * person says about a diagram goes on top of it. Edges sit between the two, so
 * an arrow crosses a group and passes under a note.
 *
 * The inspector is not here. It attaches through `onSelect` and hands back one
 * edited object at a time to `update`, so this file knows about columns only in
 * order to draw them.
 */

import type { Column, Group, Layout, Note, ObjectKind, Table } from '../../model/types.js'
import { columnTitle, refLabel } from './columns.js'
import { edgeSpecsOf, routeEdges, type EdgeSpec, type RoutedEdge, type TableBox } from './edges.js'
import {
  boundsOf,
  clampScale,
  fitTo,
  panBy,
  stepScale,
  toModel,
  zoomAbout,
  type Point,
  type Rect,
  type Viewport,
} from './geometry.js'
import { groupBoxes, groupPath, GROUP_HEADER, type GroupBox, type Outsider } from './groups.js'
import { parseMarkdown, type Block, type Span } from './markdown.js'
import { tintClass } from './palette.js'

const SVG = 'http://www.w3.org/2000/svg'

/**
 * How far the scene extends either side of the origin, in model units.
 *
 * An SVG element clips at its own edges, and a model may have negative
 * coordinates because the format allows them, so the overlay is one large fixed
 * rectangle centred on the origin rather than one sized to its content. Fixed,
 * because a viewBox recomputed on every frame of a drag is a viewBox that moves
 * while the developer is dragging against it.
 */
const SCENE_EXTENT = 10000

/** What a note is drawn at when its file gives no `w` and `h`. */
const NOTE_SIZE = { w: 320, h: 200 }
/** Small enough to be a note and large enough to still be grabbable. */
const NOTE_MINIMUM = { w: 140, h: 90 }
/**
 * What a resize snaps to.
 *
 * A note resize writes `w` and `h`, and a drag that wrote every pixel would put
 * a diff on the file for each of sixty frames' worth of intermediate sizes. The
 * grid is coarse enough that a deliberate resize is one line changed and an
 * accidental nudge is no line at all.
 */
const RESIZE_STEP = 10

/** What is selected: the kind as well as the name, since three kinds share the canvas. */
export interface Selected {
  readonly kind: ObjectKind
  readonly name: string
}

/** One member's new position, in a group drag's batch. */
export interface Moved {
  readonly name: string
  readonly position: Point
}

/** Everything the canvas draws, as the page currently holds it. */
export interface Scene {
  readonly tables: readonly Table[]
  readonly notes: readonly Note[]
  readonly groups: readonly Group[]
}

export interface CanvasHandlers {
  /**
   * A table or a note moved, or a note was resized, in whole model pixels.
   *
   * Called for every pointer move and once more when the drag ends, with the
   * layout the object actually came to rest at. There is deliberately no
   * separate "the drag finished" call: an owner that treats every move the same
   * way cannot forget to handle the last one, which is the shape that stops a
   * finished drag from going unwritten.
   */
  readonly onMove: (kind: 'table' | 'note', name: string, layout: Layout) => void
  /**
   * A group's header was dragged, and this is where its members ended up.
   *
   * Once, at the end, with only the members whose position changed. See rule 4
   * in this file's notes for why this one is a batch and everything else is a
   * stream, and `groups.ts` for why the group itself is not in the list.
   */
  readonly onGroupMove: (group: string, moved: readonly Moved[]) => void
  /** Something was selected, or the background was clicked. The inspector opens here. */
  readonly onSelect: (selected: Selected | null) => void
  /**
   * A point was pointed at while placement was armed, in whole model pixels.
   *
   * `layout` is the one thing about a new table or note the server cannot
   * invent (ADR 0015: a position the developer did not choose is computed,
   * never stored), so a create starts with the pointer rather than with a form.
   * Placement is disarmed before this is called, so the handler can open
   * whatever it likes.
   */
  readonly onPlace: (at: Point) => void
  /** Pan or zoom changed, so a readout can follow it. */
  readonly onViewport: (viewport: Viewport) => void
}

interface Box {
  /** Replaced in place by `update` when the table's columns change. */
  element: HTMLElement
  /** Model coordinates of the top-left corner. */
  position: Point
  /** Measured from the DOM: a table's size is a consequence of its columns. */
  size: { w: number; h: number }
  /**
   * Each column's row centre, as an offset down from the box's top.
   *
   * Measured for the same reason and on the same pass as `size`. An edge is
   * anchored at `position.y` plus this, so a drag carries the anchor with the
   * box without re-reading the DOM, and only a change to what the box contains
   * needs a fresh measurement. `measure` is the only writer.
   */
  rows: Map<string, number>
  /** The header's centre, where an edge goes when this box has no such column. */
  header: number
  /**
   * Whether the table's file parsed, which decides two separate things.
   *
   * A table whose file did not parse holds less in memory than on disk, and the
   * server refuses to write it (ADR 0013), so it cannot be dragged: refusing
   * here is the same refusal, said before the developer has moved anything. It
   * is also drawn with the reader's complaint in place of its rows, so an edge
   * that could not find a row on this box is unanchored for a different reason
   * than one that named a column its table genuinely does not have. One fact,
   * so the two answers cannot drift apart.
   */
  complete: boolean
  /** The group this table declares itself a member of, if any. */
  group: string | undefined
}

interface NoteBox {
  element: HTMLElement
  rect: Rect
  draggable: boolean
}

type Drag =
  | { readonly kind: 'pan'; readonly pointerId: number; last: Point }
  | {
      readonly kind: 'box' | 'note'
      readonly pointerId: number
      readonly name: string
      /** Where in the box the pointer took hold, in model units. */
      readonly grab: Point
      /** The canvas element's top-left, read once: it cannot move during a drag. */
      readonly origin: Point
      moved: boolean
    }
  | {
      readonly kind: 'resize'
      readonly pointerId: number
      readonly name: string
      readonly origin: Point
      moved: boolean
    }
  | {
      readonly kind: 'group'
      readonly pointerId: number
      readonly name: string
      readonly origin: Point
      /** Where the pointer started, in model units, so a delta can be taken. */
      readonly from: Point
      /** Where each member was when the gesture began. The batch is built from this. */
      readonly started: ReadonlyMap<string, Point>
      moved: boolean
    }

export class Canvas {
  private readonly scene: HTMLElement
  private readonly overlay: SVGSVGElement
  private readonly edgeLayer: SVGGElement
  private readonly boxLayer: HTMLElement
  private readonly noteLayer: HTMLElement
  private readonly groupLayer: HTMLElement

  private readonly boxes = new Map<string, Box>()
  private readonly notes = new Map<string, NoteBox>()
  /** One element per group, keyed by name. Its rectangle is never kept here. */
  private readonly groupElements = new Map<string, HTMLElement>()

  /** What is drawn, kept so one object can be redrawn without refetching the rest. */
  private tables: readonly Table[] = []
  private groups: readonly Group[] = []
  private specs: readonly EdgeSpec[] = []
  private edges: RoutedEdge[] = []
  private edgePaths: SVGPathElement[] = []

  private view: Viewport = { pan: { x: 0, y: 0 }, scale: 1 }
  private drag: Drag | undefined
  private selected: Selected | null = null
  private frame: number | undefined
  /** Armed by `arm`: the next press names a spot instead of grabbing a box. */
  private armed = false

  /**
   * A box changed shape, so its rows moved and its edges have to be re-measured.
   *
   * `show` re-measures everything, and a model that arrives from the server goes
   * through it. This is for the other case: the inspector (dbmd-32) adds and
   * removes columns from a table that is already on the canvas, and a row offset
   * taken at load and kept would leave every arrow below the edit pointing one
   * row out. Observed size is layout size and a CSS transform does not change
   * it, so pan, zoom and drag do not wake this up.
   *
   * A table that changed size also changes the box of the group it is in, which
   * is why `drawGroups` is on this path too and not only on the drag's.
   */
  private readonly rowSizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const name = entry.target instanceof HTMLElement ? entry.target.dataset['table'] : undefined
      const box = name === undefined ? undefined : this.boxes.get(name)
      if (box !== undefined) measure(box)
    }
    this.drawEdges()
    this.describeEdges()
    this.drawGroups()
  })

  constructor(
    private readonly host: HTMLElement,
    private readonly handlers: CanvasHandlers,
  ) {
    this.scene = document.createElement('div')
    this.scene.className = 'scene'

    this.groupLayer = document.createElement('div')
    this.groupLayer.className = 'groups'

    this.overlay = document.createElementNS(SVG, 'svg')
    this.overlay.setAttribute(
      'viewBox',
      `${-SCENE_EXTENT} ${-SCENE_EXTENT} ${SCENE_EXTENT * 2} ${SCENE_EXTENT * 2}`,
    )
    this.overlay.setAttribute('width', String(SCENE_EXTENT * 2))
    this.overlay.setAttribute('height', String(SCENE_EXTENT * 2))
    this.overlay.classList.add('edges')
    this.overlay.append(arrowhead())
    this.edgeLayer = document.createElementNS(SVG, 'g')
    this.overlay.append(this.edgeLayer)

    this.boxLayer = document.createElement('div')
    this.boxLayer.className = 'boxes'
    this.noteLayer = document.createElement('div')
    this.noteLayer.className = 'notes'

    // The order is the z-order and it is the whole of rule 5 above.
    this.scene.append(this.groupLayer, this.overlay, this.boxLayer, this.noteLayer)
    this.host.append(this.scene)
    this.applyViewport()

    this.host.addEventListener('pointerdown', this.onPointerDown)
    this.host.addEventListener('pointermove', this.onPointerMove)
    this.host.addEventListener('pointerup', this.onPointerUp)
    this.host.addEventListener('pointercancel', this.onPointerUp)
    // The capture can be lost without a pointerup: another element takes it, or
    // the browser decides the gesture is over. Either way the box has already
    // moved on screen, so the move is finished rather than abandoned, and the
    // group batch is sent rather than dropped.
    this.host.addEventListener('lostpointercapture', this.onPointerUp)
    // Not passive: a wheel over the canvas zooms and must not also scroll.
    this.host.addEventListener('wheel', this.onWheel, { passive: false })
  }

  /** Replace everything on the canvas. A live update from disk calls this again. */
  show(scene: Scene, positions: ReadonlyMap<string, Point>): void {
    this.rowSizes.disconnect()
    this.boxes.clear()
    this.notes.clear()
    this.groupElements.clear()
    this.boxLayer.replaceChildren()
    this.noteLayer.replaceChildren()
    this.groupLayer.replaceChildren()
    this.tables = scene.tables
    this.groups = scene.groups

    for (const table of scene.tables) {
      const position = positions.get(table.name) ?? { x: 0, y: 0 }
      const element = renderTable(table)
      this.boxLayer.append(element)
      this.boxes.set(table.name, {
        element,
        position,
        // Replaced by a measurement below, once the browser has laid it out.
        size: { w: 220, h: 120 },
        rows: new Map(),
        header: 0,
        complete: table.complete,
        group: table.group,
      })
      placeElement(element, position)
    }

    for (const note of scene.notes) this.addNote(note)
    for (const group of scene.groups) this.addGroup(group)

    for (const box of this.boxes.values()) {
      measure(box)
      this.rowSizes.observe(box.element)
    }

    this.rebuildEdges()
    this.drawGroups()
  }

  /**
   * Redraw one table, keeping where it is and what the rest of the scene is
   * doing. The inspector calls this after an edit that changed its columns.
   *
   * A whole `show` would do it and is what the watcher will use for a change it
   * did not make, but it is the wrong shape for an edit the page just made: it
   * would recreate every box, and every box is measured from the DOM, so one
   * table gaining a column would re-measure all of them. Here exactly one box is
   * rebuilt, re-measured and re-observed.
   *
   * The `ResizeObserver` is not enough on its own and is not made redundant by
   * this either. It notices that this box's rows moved and redraws them; what it
   * cannot know is that the model gained or lost a `ref`, which is a different
   * path element rather than a different anchor, and that is `rebuildEdges`.
   */
  update(next: Table): void {
    const box = this.boxes.get(next.name)
    if (box === undefined) return
    const element = renderTable(next)
    element.classList.toggle('selected', this.isSelected('table', next.name))
    placeElement(element, box.position)
    this.rowSizes.unobserve(box.element)
    box.element.replaceWith(element)
    box.element = element
    box.complete = next.complete
    // A table that joined or left a group changes two group boxes and no
    // coordinate: the boxes are recomputed below from membership as it now
    // stands, and nothing about the group's own file has moved.
    box.group = next.group
    measure(box)
    this.rowSizes.observe(element)
    this.tables = this.tables.map((table) => (table.name === next.name ? next : table))
    this.rebuildEdges()
    this.drawGroups()
  }

  /** Redraw one note: its prose is rendered, so an edit to the body changes it. */
  updateNote(next: Note): void {
    const held = this.notes.get(next.name)
    if (held === undefined) return
    const element = renderNote(next)
    element.classList.toggle('selected', this.isSelected('note', next.name))
    const rect = { ...held.rect }
    held.element.replaceWith(element)
    held.element = element
    held.draggable = next.complete
    // Keeping the rectangle the canvas already has rather than taking the one
    // in the patch: a body edit arriving mid-drag must not teleport the note
    // back to where its file still says it is.
    placeNote(element, rect)
  }

  /** Redraw one group: its label and colour are on the file, and its box is not. */
  updateGroup(next: Group): void {
    this.groups = this.groups.map((group) => (group.name === next.name ? next : group))
    const element = this.groupElements.get(next.name)
    if (element === undefined) return
    const replacement = renderGroupShell(next)
    replacement.classList.toggle('selected', this.isSelected('group', next.name))
    element.replaceWith(replacement)
    this.groupElements.set(next.name, replacement)
    this.drawGroups()
  }

  select(selected: Selected | null): void {
    if (sameSelection(this.selected, selected)) return
    this.selected = selected
    this.markSelection()
    this.handlers.onSelect(selected)
  }

  /** What is selected, so a redraw can put the panel back on it. */
  get selection(): Selected | null {
    return this.selected
  }

  /**
   * Whether a gesture is in progress.
   *
   * Asked by the page before it redraws from a model that arrived from the
   * server: replacing every box under a pointer that is holding one is the
   * canvas losing the drag, and the developer would see the box snap back.
   */
  get dragging(): boolean {
    return this.drag !== undefined
  }

  /**
   * Whether the next press names a spot for a new table or note rather than
   * grabbing.
   *
   * The canvas's only mode, and it lasts one press. Everything else here is a
   * gesture that means the same thing whenever it is made, which is worth
   * keeping: a mode the developer forgot they were in is a click that did
   * something they did not ask for. This one shows a crosshair the whole time it
   * is on, is turned off by the press that uses it, and Escape cancels it.
   *
   * A group is deliberately not placeable. It has no coordinates to place (ADR
   * 0005), so asking somebody to point at a spot for one would be teaching them
   * something untrue about the format in the first minute.
   */
  get placing(): boolean {
    return this.armed
  }

  arm(on: boolean): void {
    this.armed = on
    this.host.classList.toggle('placing', on)
  }

  zoomStep(direction: 1 | -1): void {
    const rect = this.host.getBoundingClientRect()
    this.setViewport(
      zoomAbout(
        this.view,
        { x: rect.left, y: rect.top },
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        stepScale(this.view.scale, direction),
      ),
    )
  }

  /** Zoom to an exact level, about the middle of the canvas. */
  zoomTo(scale: number): void {
    const rect = this.host.getBoundingClientRect()
    this.setViewport(
      zoomAbout(
        this.view,
        { x: rect.left, y: rect.top },
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        clampScale(scale),
      ),
    )
  }

  /**
   * Show everything, or reset the view when there is nothing to show.
   *
   * Everything means the notes and the group boxes too, and that is also the
   * fix for the toolbar sitting on top of the first table: `fitTo` centres the
   * content inside a margin, so the box a model puts at (40, 40) is no longer
   * drawn underneath the zoom controls at (12, 12).
   */
  fit(): void {
    const content = boundsOf(this.everyRect())
    const rect = this.host.getBoundingClientRect()
    if (content === undefined) {
      this.setViewport({ pan: { x: 0, y: 0 }, scale: 1 })
      return
    }
    this.setViewport(fitTo(content, { w: rect.width, h: rect.height }))
  }

  // ------------------------------------------------------------------------
  // Interaction.
  // ------------------------------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    const rect = this.host.getBoundingClientRect()
    const origin = { x: rect.left, y: rect.top }

    // Placement first, and without capturing the pointer or changing the
    // selection: this press is a coordinate rather than a gesture, and a box
    // that happens to be under it is not what was being pointed at.
    if (this.armed) {
      this.arm(false)
      this.handlers.onPlace(
        round(toModel({ x: event.clientX, y: event.clientY }, origin, this.view)),
      )
      return
    }

    // Capture on the canvas rather than on the box: one element receives every
    // move and the pointerup, wherever the pointer goes, including outside the
    // window. Everything below then reads from `this.drag` and never from what
    // the event happens to be over.
    this.host.setPointerCapture(event.pointerId)

    const target = event.target instanceof Element ? event.target : null
    const at = toModel({ x: event.clientX, y: event.clientY }, origin, this.view)

    const grip = target?.closest('.note-grip')
    const noteElement = target?.closest('.note-card')
    const noteName = noteElement instanceof HTMLElement ? noteElement.dataset['note'] : undefined
    if (noteName !== undefined) {
      const note = this.notes.get(noteName)
      this.select({ kind: 'note', name: noteName })
      if (note !== undefined && note.draggable) {
        note.element.classList.add('dragging')
        this.drag =
          grip === null || grip === undefined
            ? {
                kind: 'note',
                pointerId: event.pointerId,
                name: noteName,
                grab: { x: at.x - note.rect.x, y: at.y - note.rect.y },
                origin,
                moved: false,
              }
            : { kind: 'resize', pointerId: event.pointerId, name: noteName, origin, moved: false }
        return
      }
      this.startPan(event)
      return
    }

    const groupHeader = target?.closest('.group > header')
    const groupElement = groupHeader?.parentElement
    const groupName =
      groupElement instanceof HTMLElement ? groupElement.dataset['group'] : undefined
    if (groupName !== undefined) {
      this.select({ kind: 'group', name: groupName })
      const started = new Map<string, Point>()
      for (const [name, box] of this.boxes) {
        if (box.group === groupName && box.complete) started.set(name, box.position)
      }
      this.drag = {
        kind: 'group',
        pointerId: event.pointerId,
        name: groupName,
        origin,
        from: at,
        started,
        moved: false,
      }
      groupElement?.classList.add('dragging')
      return
    }

    const element = target?.closest('.box')
    const name = element instanceof HTMLElement ? (element.dataset['table'] ?? null) : null
    const box = name === null ? undefined : this.boxes.get(name)

    this.select(name === null ? null : { kind: 'table', name })

    // A table whose file did not parse is still selectable, so the developer
    // can read what is wrong with it; the background drag it falls through to
    // pans, which is what it would have done anyway.
    if (name === null || box === undefined || !box.complete) {
      this.startPan(event)
      return
    }

    this.drag = {
      kind: 'box',
      pointerId: event.pointerId,
      name,
      grab: { x: at.x - box.position.x, y: at.y - box.position.y },
      origin,
      moved: false,
    }
    box.element.classList.add('dragging')
  }

  private startPan(event: PointerEvent): void {
    this.drag = {
      kind: 'pan',
      pointerId: event.pointerId,
      last: { x: event.clientX, y: event.clientY },
    }
    this.host.classList.add('panning')
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag
    if (drag === undefined || drag.pointerId !== event.pointerId) return

    if (drag.kind === 'pan') {
      this.setViewport(panBy(this.view, event.clientX - drag.last.x, event.clientY - drag.last.y))
      drag.last = { x: event.clientX, y: event.clientY }
      return
    }

    const at = toModel({ x: event.clientX, y: event.clientY }, drag.origin, this.view)

    if (drag.kind === 'box') {
      const box = this.boxes.get(drag.name)
      if (box === undefined) return
      // The grab offset is in model units, so this is the same arithmetic at
      // every zoom level and there is no scale factor anywhere else to get
      // wrong.
      box.position = { x: at.x - drag.grab.x, y: at.y - drag.grab.y }
      drag.moved = true
      placeElement(box.element, box.position)
      this.scheduleFrame()
      this.handlers.onMove('table', drag.name, round(box.position))
      return
    }

    if (drag.kind === 'note') {
      const note = this.notes.get(drag.name)
      if (note === undefined) return
      note.rect = { ...note.rect, x: at.x - drag.grab.x, y: at.y - drag.grab.y }
      drag.moved = true
      placeNote(note.element, note.rect)
      this.handlers.onMove('note', drag.name, roundRect(note.rect))
      return
    }

    if (drag.kind === 'resize') {
      const note = this.notes.get(drag.name)
      if (note === undefined) return
      note.rect = {
        ...note.rect,
        w: Math.max(NOTE_MINIMUM.w, snap(at.x - note.rect.x)),
        h: Math.max(NOTE_MINIMUM.h, snap(at.y - note.rect.y)),
      }
      drag.moved = true
      placeNote(note.element, note.rect)
      this.handlers.onMove('note', drag.name, roundRect(note.rect))
      return
    }

    if (drag.kind !== 'group') return
    // A group. Every member moves by the same delta, the group's box follows
    // from where they now are, and nothing is handed over until pointerup.
    const dx = at.x - drag.from.x
    const dy = at.y - drag.from.y
    for (const [name, from] of drag.started) {
      const box = this.boxes.get(name)
      if (box === undefined) continue
      box.position = { x: from.x + dx, y: from.y + dy }
      placeElement(box.element, box.position)
    }
    drag.moved = true
    this.scheduleFrame()
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag
    if (drag === undefined || drag.pointerId !== event.pointerId) return
    this.drag = undefined
    if (this.host.hasPointerCapture(event.pointerId)) {
      this.host.releasePointerCapture(event.pointerId)
    }

    if (drag.kind === 'pan') {
      this.host.classList.remove('panning')
      return
    }

    if (drag.kind === 'box') {
      const box = this.boxes.get(drag.name)
      if (box === undefined) return
      box.element.classList.remove('dragging')
      if (!drag.moved) return
      // Snap to what will be written, so the picture and the file agree. The
      // fractional position was only ever for the pointer to track smoothly.
      box.position = round(box.position)
      placeElement(box.element, box.position)
      this.drawEdges()
      this.drawGroups()
      this.handlers.onMove('table', drag.name, box.position)
      return
    }

    if (drag.kind === 'note' || drag.kind === 'resize') {
      const note = this.notes.get(drag.name)
      if (note === undefined) return
      note.element.classList.remove('dragging')
      if (!drag.moved) return
      note.rect = roundRect(note.rect)
      placeNote(note.element, note.rect)
      this.handlers.onMove('note', drag.name, note.rect)
      return
    }

    if (drag.kind !== 'group') return
    this.groupElements.get(drag.name)?.classList.remove('dragging')
    this.drawEdges()
    this.drawGroups()
    if (!drag.moved) return
    const batch: Moved[] = []
    for (const [name, from] of drag.started) {
      const box = this.boxes.get(name)
      if (box === undefined) continue
      box.position = round(box.position)
      placeElement(box.element, box.position)
      // Only the members that actually moved. A group nudged and put back, or
      // dragged less than half a pixel, must not put every member's file into
      // somebody's `git status` for a change that says the same thing.
      if (box.position.x !== from.x || box.position.y !== from.y) {
        batch.push({ name, position: box.position })
      }
    }
    this.drawEdges()
    this.drawGroups()
    if (batch.length > 0) this.handlers.onGroupMove(drag.name, batch)
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const rect = this.host.getBoundingClientRect()
    // A wheel notch is lines in Firefox and pixels in Chromium; both end up as
    // a small exponent so that zooming is smooth and never crosses zero.
    const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
    const factor = Math.exp((-event.deltaY * lines) / 500)
    this.setViewport(
      zoomAbout(
        this.view,
        { x: rect.left, y: rect.top },
        { x: event.clientX, y: event.clientY },
        this.view.scale * factor,
      ),
    )
  }

  // ------------------------------------------------------------------------

  private addNote(note: Note): void {
    const element = renderNote(note)
    const rect = {
      x: note.layout?.x ?? 0,
      y: note.layout?.y ?? 0,
      w: note.layout?.w ?? NOTE_SIZE.w,
      h: note.layout?.h ?? NOTE_SIZE.h,
    }
    placeNote(element, rect)
    this.noteLayer.append(element)
    this.notes.set(note.name, { element, rect, draggable: note.complete })
  }

  private addGroup(group: Group): void {
    const element = renderGroupShell(group)
    this.groupLayer.append(element)
    this.groupElements.set(group.name, element)
  }

  private setViewport(next: Viewport): void {
    this.view = next
    this.applyViewport()
    this.handlers.onViewport(next)
  }

  private applyViewport(): void {
    this.scene.style.transform = `translate(${this.view.pan.x}px, ${this.view.pan.y}px) scale(${this.view.scale})`
  }

  private boxRects(): Map<string, TableBox> {
    const rects = new Map<string, TableBox>()
    for (const [name, box] of this.boxes) {
      rects.set(name, {
        x: box.position.x,
        y: box.position.y,
        w: box.size.w,
        h: box.size.h,
        rows: box.rows,
        header: box.header,
        drawsRows: box.complete,
      })
    }
    return rects
  }

  /** Every rectangle on the canvas, which is what `fit` has to enclose. */
  private everyRect(): Rect[] {
    const rects: Rect[] = [
      ...this.boxRects().values(),
      ...[...this.notes.values()].map((n) => n.rect),
    ]
    for (const box of this.computeGroupBoxes()) {
      rects.push({
        x: box.rect.x,
        y: box.rect.y - GROUP_HEADER,
        w: box.rect.w,
        h: box.rect.h + GROUP_HEADER,
      })
    }
    return rects
  }

  /**
   * Every group's box, worked out from where its members are right now.
   *
   * Membership is read off each table's own `group`, which is the page's live
   * copy, rather than off `Model.groupMembers`, which is what the reader
   * computed at the last read. ADR 0017's third rule, and here it buys the
   * thing an inspector edit needs: a table that joined a group two keystrokes
   * ago is inside the box before the file has even been written.
   */
  private computeGroupBoxes(): GroupBox[] {
    const members = new Map<string, string[]>()
    for (const group of this.groups) members.set(group.name, [])
    for (const [name, box] of this.boxes) {
      if (box.group === undefined) continue
      members.get(box.group)?.push(name)
    }
    const rects = new Map<string, Rect>()
    for (const [name, box] of this.boxes) {
      rects.set(name, { x: box.position.x, y: box.position.y, w: box.size.w, h: box.size.h })
    }
    const noteRects = new Map<string, Rect>()
    for (const [name, held] of this.notes) noteRects.set(name, held.rect)
    return groupBoxes(
      this.groups.map((group) => group.name),
      members,
      rects,
      noteRects,
    )
  }

  /**
   * Put every group element where its computed box says, say if it is empty,
   * and say what it is covering that is not in it.
   *
   * The shape is rebuilt here on every draw rather than kept, for the reason
   * the rectangle is: a group's fill is a fact about where its members are this
   * frame, and a cached one is the stored coordinate ADR 0005 refuses wearing a
   * different hat. The count on the header is written from the same value in
   * the same pass, so the number and the picture cannot disagree, and both move
   * while a table is being dragged into the box rather than after it lands
   * (ADR 0035).
   */
  private drawGroups(): void {
    for (const box of this.computeGroupBoxes()) {
      const element = this.groupElements.get(box.name)
      if (element === undefined) continue
      element.style.transform = `translate(${box.rect.x}px, ${box.rect.y - GROUP_HEADER}px)`
      element.style.width = `${box.rect.w}px`
      element.style.height = `${box.rect.h + GROUP_HEADER}px`
      element.classList.toggle('empty', box.members.length === 0)
      const caption = element.querySelector<HTMLElement>('.group-empty')
      if (caption !== null) caption.hidden = box.members.length > 0

      const shape = element.querySelector<SVGSVGElement>('.group-shape')
      const path = shape?.firstElementChild
      if (shape !== null && shape !== undefined && path !== null && path !== undefined) {
        shape.setAttribute('viewBox', `0 0 ${box.rect.w} ${box.rect.h}`)
        path.setAttribute('d', groupPath(box))
      }

      const covers = element.querySelector<HTMLElement>('.group-covers')
      if (covers !== null) {
        covers.hidden = box.outsiders.length === 0
        covers.textContent = coversText(box.outsiders)
        covers.title = coversTitle(box.name, box.outsiders)
      }
    }
  }

  /**
   * One path element per `ref` in the model, from scratch.
   *
   * Rebuilt rather than patched because a column edit can add or remove an edge
   * as readily as move one, and the path elements are index-aligned with
   * `this.edges`.
   */
  private rebuildEdges(): void {
    this.specs = edgeSpecsOf(this.tables)
    this.edges = routeEdges(this.specs, this.boxRects())
    this.edgePaths = this.edges.map(() => {
      const path = document.createElementNS(SVG, 'path')
      path.setAttribute('class', 'edge')
      path.setAttribute('marker-end', 'url(#dbmd-arrowhead)')
      path.append(document.createElementNS(SVG, 'title'))
      return path
    })
    this.edgeLayer.replaceChildren(...this.edgePaths)
    this.drawEdges()
    this.describeEdges()
    this.markSelection()
  }

  /**
   * One reroute per animation frame.
   *
   * A pointermove can arrive several times per frame on a high-rate mouse, and
   * every reroute writes attributes the browser will only paint once anyway.
   * The group boxes ride along, because they move for exactly the same reason
   * the edges do: a member's box moved.
   */
  private scheduleFrame(): void {
    if (this.frame !== undefined) return
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined
      this.drawEdges()
      this.drawGroups()
    })
  }

  private drawEdges(): void {
    // Routed from the specs every time rather than from the last routing, so
    // an edge keeps the path element `show` created for it.
    this.edges = routeEdges(this.specs, this.boxRects())
    this.edges.forEach((edge, index) => {
      this.edgePaths[index]?.setAttribute('d', edge.d)
    })
  }

  /**
   * What each edge says about itself, which changes only when the model does.
   *
   * Separate from `drawEdges` because that one runs on every animation frame of
   * a drag and this one writes text. Whether an end found its row depends on
   * which columns exist, not on where the boxes are, so the two have different
   * reasons to run and it is the cheaper one that has to run often.
   */
  private describeEdges(): void {
    this.edges.forEach((edge, index) => {
      const path = this.edgePaths[index]
      if (path === undefined) return
      const title = path.querySelector('title')
      if (title !== null) title.textContent = edgeTitle(edge)
      path.classList.toggle('unanchored', edge.unanchored.length > 0)
    })
  }

  private isSelected(kind: ObjectKind, name: string): boolean {
    return this.selected?.kind === kind && this.selected.name === name
  }

  private markSelection(): void {
    for (const [name, box] of this.boxes) {
      box.element.classList.toggle('selected', this.isSelected('table', name))
    }
    for (const [name, note] of this.notes) {
      note.element.classList.toggle('selected', this.isSelected('note', name))
    }
    for (const [name, element] of this.groupElements) {
      element.classList.toggle('selected', this.isSelected('group', name))
    }
    const table = this.selected?.kind === 'table' ? this.selected.name : null
    this.edges.forEach((edge, index) => {
      this.edgePaths[index]?.classList.toggle(
        'related',
        table !== null && (edge.from.table === table || edge.to.table === table),
      )
    })
  }
}

// --------------------------------------------------------------------------
// Rendering one object.
// --------------------------------------------------------------------------

function renderTable(table: Table): HTMLElement {
  const element = document.createElement('article')
  element.className = table.complete ? 'box' : 'box broken'
  element.dataset['table'] = table.name

  const header = document.createElement('header')
  header.textContent = table.name
  element.append(header)

  if (!table.complete) {
    const problem = document.createElement('p')
    problem.className = 'problem'
    problem.textContent = `${table.path} did not parse, so this table cannot be moved. See the diagnostics below.`
    element.append(problem)
    return element
  }

  const list = document.createElement('ul')
  for (const column of table.columns) list.append(renderColumn(column))
  element.append(list)
  return element
}

/**
 * One column's row: its name, its type, and, on a second line, what it points
 * at.
 *
 * The ref is its own element rather than the tail of the type's text, and the
 * stylesheet gives it the whole width of the row. Both halves used to share one
 * span, and in `examples/shop` seven of sixty-four rows ran out of room in it:
 * `subscription_id uuid → subsc…` is the picture, and the column it names is
 * the one fact this tool draws that a diagram does not. ADR 0055 has the
 * reasoning and what the second line costs.
 *
 * The `title` is on the row and holds all of it, because a row can still run
 * out of width for a long enough name or type, and a person who is unsure has
 * to have somewhere to go.
 */
function renderColumn(column: Column): HTMLElement {
  const row = document.createElement('li')
  // How `measure` finds this row again. By name rather than by position,
  // because an edge is about a named column and a list that has had a column
  // inserted into it would otherwise silently renumber every anchor below it.
  row.dataset['column'] = column.name
  if (column.pk === true) row.classList.add('pk')
  if (column.ref !== undefined) row.classList.add('fk')
  row.title = columnTitle(column)

  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = column.name

  const type = document.createElement('span')
  type.className = 'type'
  type.textContent = column.type

  row.append(name, type)

  if (column.ref !== undefined) {
    const ref = document.createElement('span')
    ref.className = 'ref'
    ref.textContent = refLabel(column.ref)
    row.append(ref)
  }

  return row
}

/**
 * A sticky note: the prose, rendered, and a corner to resize it by.
 *
 * The body is built out of text nodes by `renderBlocks`, never assigned as
 * HTML, so a note whose body contains a tag shows the tag.
 */
function renderNote(note: Note): HTMLElement {
  const element = document.createElement('article')
  element.className = `note-card ${tintClass(note.color)}`
  if (!note.complete) element.classList.add('broken')
  element.dataset['note'] = note.name
  element.title = note.path

  if (!note.complete) {
    const problem = document.createElement('p')
    problem.className = 'problem'
    problem.textContent = `${note.path} did not parse, so this note cannot be moved. See the diagnostics below.`
    element.append(problem)
    return element
  }

  const body = document.createElement('div')
  body.className = 'note-body'
  body.append(...renderBlocks(parseMarkdown(note.body)))
  if (note.body.trim() === '') {
    const empty = document.createElement('p')
    empty.className = 'note-placeholder'
    empty.textContent = 'An empty note. Its body is the note; write it in the panel.'
    body.append(empty)
  }
  element.append(body)

  const grip = document.createElement('div')
  grip.className = 'note-grip'
  grip.title = 'Resize'
  element.append(grip)
  return element
}

/**
 * The group's element: a label bar and an outline, with no position at all.
 *
 * `drawGroups` puts it somewhere every time it runs, and this function
 * deliberately does not, so that a group element created and never drawn is a
 * group at the origin rather than a group at a coordinate somebody stored.
 */
function renderGroupShell(group: Group): HTMLElement {
  const element = document.createElement('div')
  element.className = `group ${tintClass(group.color)}`
  element.dataset['group'] = group.name

  const header = document.createElement('header')
  const label = document.createElement('span')
  label.className = 'group-label'
  label.textContent = group.label ?? group.name
  label.title = `${group.path} — drag to move every member`
  // What the box covers that is not in it, filled in by `drawGroups` because it
  // is a fact about this frame's arrangement rather than about the file, and it
  // changes under a drag that never touches `groups/`.
  const covers = document.createElement('span')
  covers.className = 'group-covers'
  covers.hidden = true
  header.append(label, covers)
  element.append(header)

  const area = document.createElement('div')
  area.className = 'group-area'
  // The fill and the outline are one path so that a clearing is a hole in the
  // region rather than a patch of background painted on top of it (ADR 0035).
  const shape = document.createElementNS(SVG, 'svg')
  shape.setAttribute('class', 'group-shape')
  shape.setAttribute('preserveAspectRatio', 'none')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('fill-rule', 'evenodd')
  shape.append(path)
  const empty = document.createElement('p')
  empty.className = 'group-empty'
  empty.hidden = true
  empty.textContent = `Nothing declares \`group: ${group.name}\`. Put a table in it from the table's panel.`
  area.append(shape, empty)
  element.append(area)
  return element
}

/**
 * The count on a group's header, or nothing when the box covers only its own.
 *
 * A count rather than a list, because the header is a drag handle and a label
 * bar that grew to name four tables would cover the thing it is a label for.
 * The names are on the tooltip, and the picture is on the canvas.
 */
function coversText(outsiders: readonly Outsider[]): string {
  if (outsiders.length === 0) return ''
  return outsiders.length === 1 ? 'covers 1 non-member' : `covers ${outsiders.length} non-members`
}

/** The same fact, named, for the hover. */
function coversTitle(group: string, outsiders: readonly Outsider[]): string {
  if (outsiders.length === 0) return ''
  const named = outsiders.map((outsider) => `${outsider.kind} ${outsider.name}`).join(', ')
  return (
    `This box is the bounding box of the tables that declare \`group: ${group}\`, ` +
    `and it reaches over ${named}, which do not. ` +
    `They are cut out of it rather than moved: a group has no coordinates (ADR 0005).`
  )
}

/** Blocks as elements. Text nodes only: nothing here parses HTML. */
function renderBlocks(blocks: readonly Block[]): HTMLElement[] {
  return blocks.map((block) => {
    if (block.kind === 'code') {
      const pre = document.createElement('pre')
      pre.textContent = block.text
      return pre
    }
    if (block.kind === 'list') {
      const list = document.createElement('ul')
      for (const item of block.items) {
        const entry = document.createElement('li')
        entry.append(...renderSpans(item))
        list.append(entry)
      }
      return list
    }
    const element = document.createElement(
      block.kind === 'heading' ? `h${Math.min(6, block.level + 2)}` : 'p',
    )
    element.append(...renderSpans(block.spans))
    return element
  })
}

function renderSpans(spans: readonly Span[]): Node[] {
  return spans.map((span) => {
    if (span.code === true) {
      const code = document.createElement('code')
      code.textContent = span.text
      return code
    }
    if (span.strong === true) {
      const strong = document.createElement('strong')
      strong.textContent = span.text
      return strong
    }
    if (span.emphasis === true) {
      const emphasis = document.createElement('em')
      emphasis.textContent = span.text
      return emphasis
    }
    return document.createTextNode(span.text)
  })
}

/**
 * Read a box's size and the position of every row in it, out of the DOM.
 *
 * `offsetTop` and `offsetHeight` rather than `getBoundingClientRect`, because
 * these are layout numbers and the rectangle is a painted one: the scene is
 * scaled by a CSS transform, so a rectangle would come back multiplied by the
 * zoom and would have to be divided back out in the one place a scale factor
 * must not appear. These are the same numbers at every zoom level, which is what
 * makes an anchor at 300% the same anchor as at 25%.
 *
 * `offsetTop` is measured from inside the offsetParent's border, and
 * `position` names the border box's corner, so the box's own border width is
 * added back.
 */
function measure(box: Box): void {
  const element = box.element
  box.size = { w: element.offsetWidth, h: element.offsetHeight }
  const border = element.clientTop
  box.rows.clear()
  element.querySelectorAll<HTMLElement>('li[data-column]').forEach((row) => {
    const name = row.dataset['column']
    if (name === undefined) return
    box.rows.set(name, border + row.offsetTop + row.offsetHeight / 2)
  })
  const header = element.querySelector<HTMLElement>(':scope > header')
  box.header =
    header === null ? box.size.h / 2 : border + header.offsetTop + header.offsetHeight / 2
}

/**
 * What the edge is about, and why an end of it is not on a row.
 *
 * The reason is the end's own, not a single sentence covering both, because the
 * two causes are different facts and a reader acts differently on each: a column
 * that is not there is a `ref` to correct, and a table that did not parse is a
 * file to fix, after which the column is very probably where it always was.
 * Saying the first about the second sends somebody looking for a column the
 * model still holds.
 */
function edgeTitle(edge: RoutedEdge): string {
  const said = `${edge.from.table}.${edge.from.column} references ${edge.to.table}.${edge.to.column}`
  if (edge.unanchored.length === 0) return said
  const because = edge.unanchored
    .map((end) =>
      end.why === 'no-such-column'
        ? `there is no ${end.table}.${end.column}`
        : `${end.table} did not parse, so its columns are not drawn`,
    )
    .join(' and ')
  return `${said}. Drawn at the table's name because ${because}.`
}

function placeElement(element: HTMLElement, position: Point): void {
  element.style.transform = `translate(${position.x}px, ${position.y}px)`
}

function placeNote(element: HTMLElement, rect: Rect): void {
  element.style.transform = `translate(${rect.x}px, ${rect.y}px)`
  element.style.width = `${rect.w}px`
  element.style.height = `${rect.h}px`
}

function sameSelection(a: Selected | null, b: Selected | null): boolean {
  if (a === null || b === null) return a === b
  return a.kind === b.kind && a.name === b.name
}

function round(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

function roundRect(rect: Rect): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.w),
    h: Math.round(rect.h),
  }
}

function snap(value: number): number {
  return Math.round(value / RESIZE_STEP) * RESIZE_STEP
}

/** One marker, referenced by every edge, so there is one arrow to restyle. */
function arrowhead(): SVGDefsElement {
  const defs = document.createElementNS(SVG, 'defs')
  const marker = document.createElementNS(SVG, 'marker')
  marker.setAttribute('id', 'dbmd-arrowhead')
  marker.setAttribute('viewBox', '0 0 10 10')
  marker.setAttribute('refX', '9')
  marker.setAttribute('refY', '5')
  marker.setAttribute('markerWidth', '7')
  marker.setAttribute('markerHeight', '7')
  marker.setAttribute('orient', 'auto-start-reverse')
  const head = document.createElementNS(SVG, 'path')
  head.setAttribute('d', 'M 0 1 L 10 5 L 0 9 z')
  marker.append(head)
  defs.append(marker)
  return defs
}
