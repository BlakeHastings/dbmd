/**
 * The canvas: boxes, edges, pan, zoom and drag.
 *
 * ADR 0004 chose no UI framework and no diagram library, and named exactly this
 * shape: boxes are absolutely positioned elements, edges are one SVG overlay,
 * and pan and zoom are a CSS transform on the element that holds both. This
 * file is that sentence.
 *
 * Three things in here are the difference between a canvas that looks finished
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
 * 3. **The end of a drag is not the end of the write.** Every move is handed to
 *    the owner as it happens and the final position is handed over once more, so
 *    a write can never be waiting inside this file for an event that is not
 *    coming. The debounce lives in the server (ADR 0004), which is not affected
 *    by the tab losing focus, and there is deliberately not a second one here.
 * 4. **Where a column's row sits is measured here and nowhere else.** ADR 0018.
 *    An edge lands on a row rather than on a box, and a row's position is a
 *    fact about the rendered page rather than about the model, so this is the
 *    file that can know it. It is taken once per layout and kept as an offset
 *    inside the box, so a drag carries it along for free and only a change to
 *    what a box contains asks for it again.
 *
 * The inspector is not here either. It attaches through `onSelect` and hands
 * back one edited table at a time to `update`, so this file knows about columns
 * only in order to draw them. Notes and groups (dbmd-34) attach as two more
 * layers inside the scene, behind and in front of the box layer respectively,
 * reusing this drag.
 */

import type { Column, Table } from '../../model/types.js'
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
  type Viewport,
} from './geometry.js'

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

export interface CanvasHandlers {
  /**
   * A box moved, in whole model pixels.
   *
   * Called for every pointer move and once more when the drag ends, with the
   * position the box actually came to rest at. There is deliberately no
   * separate "the drag finished" call: an owner that treats every move the same
   * way cannot forget to handle the last one, which is the shape that stops a
   * finished drag from going unwritten.
   */
  readonly onMove: (table: string, position: Point) => void
  /** A table was selected, or the background was clicked. The inspector opens here. */
  readonly onSelect: (table: string | null) => void
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
  draggable: boolean
}

type Drag =
  | { readonly kind: 'pan'; readonly pointerId: number; last: Point }
  | {
      readonly kind: 'box'
      readonly pointerId: number
      readonly table: string
      /** Where in the box the pointer took hold, in model units. */
      readonly grab: Point
      /** The canvas element's top-left, read once: it cannot move during a drag. */
      readonly origin: Point
      moved: boolean
    }

export class Canvas {
  private readonly scene: HTMLElement
  private readonly overlay: SVGSVGElement
  private readonly edgeLayer: SVGGElement
  private readonly boxLayer: HTMLElement

  private readonly boxes = new Map<string, Box>()
  /** What is drawn, kept so one table can be redrawn without refetching the rest. */
  private tables: readonly Table[] = []
  private specs: readonly EdgeSpec[] = []
  private edges: RoutedEdge[] = []
  private edgePaths: SVGPathElement[] = []

  private view: Viewport = { pan: { x: 0, y: 0 }, scale: 1 }
  private drag: Drag | undefined
  private selected: string | null = null
  private frame: number | undefined

  /**
   * A box changed shape, so its rows moved and its edges have to be re-measured.
   *
   * `show` re-measures everything, and a model that arrives from the server goes
   * through it. This is for the other case: the inspector (dbmd-32) adds and
   * removes columns from a table that is already on the canvas, and a row offset
   * taken at load and kept would leave every arrow below the edit pointing one
   * row out. Observed size is layout size and a CSS transform does not change
   * it, so pan, zoom and drag do not wake this up.
   */
  private readonly rowSizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const name = entry.target instanceof HTMLElement ? entry.target.dataset['table'] : undefined
      const box = name === undefined ? undefined : this.boxes.get(name)
      if (box !== undefined) measure(box)
    }
    this.drawEdges()
    this.describeEdges()
  })

  constructor(
    private readonly host: HTMLElement,
    private readonly handlers: CanvasHandlers,
  ) {
    this.scene = document.createElement('div')
    this.scene.className = 'scene'

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

    this.scene.append(this.overlay, this.boxLayer)
    this.host.append(this.scene)
    this.applyViewport()

    this.host.addEventListener('pointerdown', this.onPointerDown)
    this.host.addEventListener('pointermove', this.onPointerMove)
    this.host.addEventListener('pointerup', this.onPointerUp)
    this.host.addEventListener('pointercancel', this.onPointerUp)
    // The capture can be lost without a pointerup: another element takes it, or
    // the browser decides the gesture is over. Either way the box has already
    // moved on screen, so the move is finished rather than abandoned.
    this.host.addEventListener('lostpointercapture', this.onPointerUp)
    // Not passive: a wheel over the canvas zooms and must not also scroll.
    this.host.addEventListener('wheel', this.onWheel, { passive: false })
  }

  /** Replace everything on the canvas. dbmd-33's watcher will call this again. */
  show(tables: readonly Table[], positions: ReadonlyMap<string, Point>): void {
    this.rowSizes.disconnect()
    this.boxes.clear()
    this.boxLayer.replaceChildren()
    this.tables = tables

    for (const table of tables) {
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
        // A table whose file did not parse holds less in memory than on disk,
        // and the server refuses to write it (ADR 0013). Refusing the drag here
        // is the same refusal, said before the developer has moved anything.
        draggable: table.complete,
      })
      placeElement(element, position)
    }

    for (const box of this.boxes.values()) {
      measure(box)
      this.rowSizes.observe(box.element)
    }

    this.rebuildEdges()
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
    element.classList.toggle('selected', this.selected === next.name)
    placeElement(element, box.position)
    this.rowSizes.unobserve(box.element)
    box.element.replaceWith(element)
    box.element = element
    box.draggable = next.complete
    measure(box)
    this.rowSizes.observe(element)
    this.tables = this.tables.map((table) => (table.name === next.name ? next : table))
    this.rebuildEdges()
  }

  select(table: string | null): void {
    if (this.selected === table) return
    this.selected = table
    this.markSelection()
    this.handlers.onSelect(table)
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

  /** Show everything, or reset the view when there is nothing to show. */
  fit(): void {
    const content = boundsOf(this.boxRects().values())
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
    const element = event.target instanceof Element ? event.target.closest('.box') : null
    const name = element instanceof HTMLElement ? (element.dataset['table'] ?? null) : null
    const box = name === null ? undefined : this.boxes.get(name)

    // Capture on the canvas rather than on the box: one element receives every
    // move and the pointerup, wherever the pointer goes, including outside the
    // window. Everything below then reads from `this.drag` and never from what
    // the event happens to be over.
    this.host.setPointerCapture(event.pointerId)
    this.select(name)

    // A table whose file did not parse is still selectable, so the developer
    // can read what is wrong with it; the background drag it falls through to
    // pans, which is what it would have done anyway.
    if (name === null || box === undefined || !box.draggable) {
      this.drag = {
        kind: 'pan',
        pointerId: event.pointerId,
        last: { x: event.clientX, y: event.clientY },
      }
      this.host.classList.add('panning')
      return
    }

    const at = toModel({ x: event.clientX, y: event.clientY }, origin, this.view)
    this.drag = {
      kind: 'box',
      pointerId: event.pointerId,
      table: name,
      grab: { x: at.x - box.position.x, y: at.y - box.position.y },
      origin,
      moved: false,
    }
    box.element.classList.add('dragging')
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag
    if (drag === undefined || drag.pointerId !== event.pointerId) return

    if (drag.kind === 'pan') {
      this.setViewport(panBy(this.view, event.clientX - drag.last.x, event.clientY - drag.last.y))
      drag.last = { x: event.clientX, y: event.clientY }
      return
    }

    const box = this.boxes.get(drag.table)
    if (box === undefined) return
    const at = toModel({ x: event.clientX, y: event.clientY }, drag.origin, this.view)
    // The grab offset is in model units, so this is the same arithmetic at every
    // zoom level and there is no scale factor anywhere else to get wrong.
    box.position = { x: at.x - drag.grab.x, y: at.y - drag.grab.y }
    drag.moved = true
    placeElement(box.element, box.position)
    this.scheduleEdges()
    this.handlers.onMove(drag.table, round(box.position))
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

    const box = this.boxes.get(drag.table)
    if (box === undefined) return
    box.element.classList.remove('dragging')
    if (!drag.moved) return
    // Snap to what will be written, so the picture and the file agree. The
    // fractional position was only ever for the pointer to track smoothly.
    box.position = round(box.position)
    placeElement(box.element, box.position)
    this.drawEdges()
    this.handlers.onMove(drag.table, box.position)
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
      })
    }
    return rects
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
   */
  private scheduleEdges(): void {
    if (this.frame !== undefined) return
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined
      this.drawEdges()
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

  private markSelection(): void {
    for (const [name, box] of this.boxes) {
      box.element.classList.toggle('selected', name === this.selected)
    }
    this.edges.forEach((edge, index) => {
      this.edgePaths[index]?.classList.toggle(
        'related',
        this.selected !== null &&
          (edge.from.table === this.selected || edge.to.table === this.selected),
      )
    })
  }
}

// --------------------------------------------------------------------------
// Rendering one table.
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

function renderColumn(column: Column): HTMLElement {
  const row = document.createElement('li')
  // How `measure` finds this row again. By name rather than by position,
  // because an edge is about a named column and a list that has had a column
  // inserted into it would otherwise silently renumber every anchor below it.
  row.dataset['column'] = column.name
  if (column.pk === true) row.classList.add('pk')
  if (column.ref !== undefined) row.classList.add('fk')

  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = column.name

  const type = document.createElement('span')
  type.className = 'type'
  type.textContent =
    column.ref === undefined
      ? column.type
      : `${column.type} → ${column.ref.table}.${column.ref.column}`

  row.append(name, type)
  return row
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

function edgeTitle(edge: RoutedEdge): string {
  const said = `${edge.from.table}.${edge.from.column} references ${edge.to.table}.${edge.to.column}`
  if (edge.unanchored.length === 0) return said
  return `${said}. Drawn at the table's name because there is no ${edge.unanchored.join(' and no ')}.`
}

function placeElement(element: HTMLElement, position: Point): void {
  element.style.transform = `translate(${position.x}px, ${position.y}px)`
}

function round(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) }
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
