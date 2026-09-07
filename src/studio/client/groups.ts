/**
 * Where a group's box is, computed, every time, and never stored.
 *
 * This is the file ADR 0005 is about. A group has no coordinates: its box is
 * the bounding box of the tables that declared themselves members of it, plus
 * padding, worked out at the moment it is drawn. There is deliberately no cache
 * here and nothing that could be written to a file, because the failure that
 * record exists to prevent is a stored box that disagrees with its members: a
 * table dragged out of a group that still looks like it is in one, in a file
 * that says something false.
 *
 * It is arithmetic over plain values and touches no DOM, which is the point:
 * the thing a screenshot cannot prove about a group is where its edges are when
 * a member moves, and that is provable here without a browser.
 *
 * **A bounding box covers whatever is between its members, and this file says
 * which of that is not in the group.** ADR 0035. A box drawn over a table or a
 * note that never joined reads as though it had, and until now the only way to
 * find out was to click the thing and read `(no group)`. So the box is worked
 * out exactly as before, and then everything it covers that is not a member is
 * named and given a clearing: the fill is cut away around it, so the region
 * visibly flows past a stranger rather than washing over it. Nothing about the
 * geometry changed and no group gained a coordinate. What changed is that the
 * picture now says what the model says.
 *
 * **An empty group still gets a box.** A group whose last member left has
 * nothing to bound, and drawing nothing would tell the developer they had
 * deleted it, which they have not: the file is still there and `dbmd check`
 * still warns about it. So it gets a placeholder of a fixed size, in a
 * deterministic slot below everything else on the canvas, computed the same way
 * on every machine and every reload for the same reason `place.ts` puts an
 * unpositioned table on a grid. A placeholder has no members, so it can enclose
 * nothing on purpose and is never cut.
 */

import { boundsOf, type Rect } from './geometry.js'

/** How far a group's box stands off the members it encloses, in model units. */
export const GROUP_PADDING = 28

/**
 * The height of the label bar, which sits above the padded box.
 *
 * It is above rather than inside so that the bar never covers a member's top
 * row, and so the whole of the bar is a drag handle that cannot be confused
 * with the table under it.
 */
export const GROUP_HEADER = 26

/**
 * How far the clearing around a non-member stands off it, in model units.
 *
 * Smaller than the padding, because the clearing has to read as a hole in the
 * region rather than as a second region, and larger than a hairline, because a
 * table is opaque and sits in front of the group: a clearing exactly the size
 * of the box it excuses would be entirely hidden behind it and the picture
 * would be unchanged.
 */
export const GROUP_CLEARANCE = 16

/** A group with nothing in it, drawn at this size so it is visible and obviously empty. */
export const EMPTY_GROUP: { readonly w: number; readonly h: number } = { w: 240, h: 120 }

/** The gap below the content, and between one empty group and the next. */
const EMPTY_GAP = 48

/** Where the first empty group goes when there is no content at all to sit under. */
const EMPTY_ORIGIN = { x: 40, y: 40 }

/** The corner radius of the box, and of a clearing cut out of it. */
const BOX_RADIUS = 6
const CLEARING_RADIUS = 4

/** Something the box covers that never joined the group (ADR 0035). */
export interface Outsider {
  /** Which panel names it, and which sentence the header uses. */
  readonly kind: 'table' | 'note'
  readonly name: string
  /**
   * The clearing to cut out of the group's fill: the thing's own box grown by
   * `GROUP_CLEARANCE` and then clipped back to the group's box, because a hole
   * that escaped the shape it is a hole in would paint outside it.
   */
  readonly rect: Rect
}

export interface GroupBox {
  readonly name: string
  /** The padded box, in model coordinates. The header bar sits just above it. */
  readonly rect: Rect
  /** The members it was computed from, in the order given. Empty is not an error. */
  readonly members: readonly string[]
  /**
   * Everything the box covers that is not a member, tables before notes and
   * each in name order, so two draws of one arrangement say the same thing.
   */
  readonly outsiders: readonly Outsider[]
}

/**
 * A box for every group: the ones with members first, in the order the groups
 * were given, then the empty ones in their own row underneath.
 *
 * `rects` holds the boxes of the tables currently on the canvas, which during a
 * drag are where the pointer has put them rather than where their files say.
 * That is what makes a group follow its members as they move: the same function
 * runs on every frame with fresher input, and there is no second copy of the
 * answer anywhere to go stale. `notes` is the same for notes, which can never
 * be members and are therefore only ever strangers inside a box.
 *
 * A member the canvas has no box for is skipped rather than guessed at. It
 * means a table declared `group:` and the reader could not build it, and a
 * group that swelled to enclose the origin because one member was missing would
 * be a lie about where the group is.
 */
export function groupBoxes(
  groups: readonly string[],
  members: ReadonlyMap<string, readonly string[]>,
  rects: ReadonlyMap<string, Rect>,
  notes: ReadonlyMap<string, Rect> = new Map(),
): GroupBox[] {
  const boxes: GroupBox[] = []
  const empty: string[] = []

  for (const name of groups) {
    const held = members.get(name) ?? []
    const found = held
      .map((table) => rects.get(table))
      .filter((rect): rect is Rect => rect !== undefined)
    const bounds = boundsOf(found)
    if (bounds === undefined) {
      empty.push(name)
      continue
    }
    const rect = {
      x: bounds.x - GROUP_PADDING,
      y: bounds.y - GROUP_PADDING,
      w: bounds.w + GROUP_PADDING * 2,
      h: bounds.h + GROUP_PADDING * 2,
    }
    boxes.push({ name, rect, members: held, outsiders: outsidersIn(rect, held, rects, notes) })
  }

  // Below everything, left to right, in the order the groups came in, which the
  // reader sorts by name. Two reads of the same directory therefore put the
  // same placeholder in the same place, which is what stops an empty group
  // wandering across the canvas every time the page reloads.
  const content = boundsOf([...rects.values(), ...boxes.map((box) => box.rect)])
  const top = content === undefined ? EMPTY_ORIGIN.y : content.y + content.h + EMPTY_GAP
  const left = content === undefined ? EMPTY_ORIGIN.x : content.x
  empty.forEach((name, slot) => {
    boxes.push({
      name,
      rect: { x: left + slot * (EMPTY_GROUP.w + EMPTY_GAP), y: top, ...EMPTY_GROUP },
      members: [],
      outsiders: [],
    })
  })

  return boxes
}

/**
 * What `rect` covers that is not in `held`.
 *
 * The test is overlap rather than containment, and that is the point rather
 * than a looseness: what misleads a reader is the group's fill lying under
 * something, and the fill lies under every pixel of overlap. A table half in a
 * box reads half in the group, which is a worse thing to be than a table wholly
 * in one, not a better one.
 */
function outsidersIn(
  rect: Rect,
  held: readonly string[],
  rects: ReadonlyMap<string, Rect>,
  notes: ReadonlyMap<string, Rect>,
): Outsider[] {
  const members = new Set(held)
  const found: Outsider[] = []
  for (const kind of ['table', 'note'] as const) {
    const source = kind === 'table' ? rects : notes
    const names = [...source.keys()].sort()
    for (const name of names) {
      if (kind === 'table' && members.has(name)) continue
      const other = source.get(name)
      if (other === undefined || !overlaps(rect, other)) continue
      found.push({ kind, name, rect: clip(grow(other, GROUP_CLEARANCE), rect) })
    }
  }
  return found
}

/** Whether two rectangles share any area at all. Touching edges do not count. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function grow(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 }
}

/** `rect` with anything outside `within` trimmed off. Never negative. */
function clip(rect: Rect, within: Rect): Rect {
  const x = Math.max(rect.x, within.x)
  const y = Math.max(rect.y, within.y)
  return {
    x,
    y,
    w: Math.max(0, Math.min(rect.x + rect.w, within.x + within.w) - x),
    h: Math.max(0, Math.min(rect.y + rect.h, within.y + within.h) - y),
  }
}

/**
 * The group's box as one SVG path, in coordinates local to the box's top-left.
 *
 * One path with `fill-rule="evenodd"` rather than one element per piece, so the
 * clearings are genuinely absent from the fill rather than painted over in the
 * page's background colour. Painted-over would look identical on an empty
 * canvas and wrong the moment two group boxes overlap, where it would erase the
 * other group's wash as well as its own.
 *
 * The top-left corner is square because the label bar sits against it, which is
 * the same shape `border-radius: 0 6px 6px 6px` drew before there was a path.
 * The half-pixel inset is the stroke: a one-pixel line centred on the boundary
 * of the element is half outside it and clipped away.
 */
export function groupPath(box: GroupBox): string {
  const { w, h } = box.rect
  if (w <= 1 || h <= 1) return ''
  const outer = roundedRect(0.5, 0.5, w - 1, h - 1, [0, BOX_RADIUS, BOX_RADIUS, BOX_RADIUS])
  const holes = box.outsiders
    .map((outsider) =>
      roundedRect(
        outsider.rect.x - box.rect.x,
        outsider.rect.y - box.rect.y,
        outsider.rect.w,
        outsider.rect.h,
        [CLEARING_RADIUS, CLEARING_RADIUS, CLEARING_RADIUS, CLEARING_RADIUS],
      ),
    )
    .filter((hole) => hole !== '')
  return [outer, ...holes].join(' ')
}

/** A closed rounded rectangle, radii clockwise from the top-left corner. */
function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: readonly [number, number, number, number],
): string {
  if (w <= 0 || h <= 0) return ''
  const most = Math.min(w, h) / 2
  const fit = (radius: number): number => Math.max(0, Math.min(radius, most))
  const [tl, tr, br, bl] = [fit(radii[0]), fit(radii[1]), fit(radii[2]), fit(radii[3])]
  const arc = (radius: number, toX: number, toY: number): string =>
    radius === 0 ? '' : `A${n(radius)} ${n(radius)} 0 0 1 ${n(toX)} ${n(toY)}`
  return [
    `M${n(x + tl)} ${n(y)}`,
    `H${n(x + w - tr)}`,
    arc(tr, x + w, y + tr),
    `V${n(y + h - br)}`,
    arc(br, x + w - br, y + h),
    `H${n(x + bl)}`,
    arc(bl, x, y + h - bl),
    `V${n(y + tl)}`,
    arc(tl, x + tl, y),
    'Z',
  ]
    .filter((part) => part !== '')
    .join(' ')
}

/** Two decimal places at most, and no trailing zeroes, so the attribute is readable. */
function n(value: number): number {
  return Math.round(value * 100) / 100
}
