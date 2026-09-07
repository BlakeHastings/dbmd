/**
 * The colours a note or a group can be, as names.
 *
 * ADR 0005 writes `color: amber` on a note and `color: violet` on a group, and
 * the reason is a diff: a reviewer reading `color: amber` learns something, and
 * a reviewer reading `color: "#fbbf24"` learns that somebody used a colour
 * picker. So the studio offers names and never a hex value, and this list is
 * the whole of what it offers.
 *
 * **The names are the studio's, and the format's rule is wider than they are.**
 * `docs/format.md` says `color` is carried through and not validated, which is
 * deliberate: a model written by hand, or by a tool that is not this one, may
 * say `color: seafoam`, and refusing to open it would make the studio a
 * narrower reader than `dbmd check`. So a name that is not in this list is
 * drawn plainly, kept exactly as the file spells it, and named in the inspector
 * so the developer knows why the box is grey. Nothing here ever rewrites it.
 *
 * **Seven names and no more.** A palette that grows to twenty is a palette
 * where nobody can remember which one they used, and every extra name is one
 * more pair of shades that has to be legible in a light theme and a dark one.
 * The pairs live in one place, `index.html`, as `.tint-<name>` rules, for the
 * same reason: a component that invented its own shade would be the one that is
 * unreadable at night.
 */

/** The names, in the order a picker shows them. */
export const PALETTE: readonly string[] = [
  'amber',
  'rose',
  'violet',
  'blue',
  'teal',
  'green',
  'slate',
]

/** What a colour that is not one of ours is drawn as: the surface, plainly. */
export const PLAIN_TINT = 'tint-plain'

export function isPaletteColor(color: string): boolean {
  return PALETTE.includes(color)
}

/**
 * The class that paints a box, for a `color` off a file.
 *
 * A class rather than an inline style, so the shades are declared once in the
 * stylesheet with a dark-theme block beside them, and so a screenshot of the
 * page in either theme is the same decision seen twice rather than two.
 */
export function tintClass(color: string | undefined): string {
  return color !== undefined && isPaletteColor(color) ? `tint-${color}` : PLAIN_TINT
}

/**
 * What the panel says about a colour it did not recognise, or nothing.
 *
 * Written here rather than in the panel because it is about this list: the
 * sentence and the list have to agree about what "one of the studio's colours"
 * means, and the moment they are in two files they stop agreeing.
 */
export function unknownColorNote(color: string | undefined): string | undefined {
  if (color === undefined || isPaletteColor(color)) return undefined
  return (
    `\`${color}\` is not one of the studio's colours, so this is drawn plain. ` +
    `The file keeps the name it has: dbmd carries \`color\` through and does not validate it. ` +
    `The studio's are ${PALETTE.join(', ')}.`
  )
}
