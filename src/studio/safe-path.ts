/**
 * The one security property this tool has.
 *
 * The studio server writes files on behalf of a web page. Every name it acts on
 * arrived over HTTP: a table called `orders`, or a table called `../../etc/x`.
 * ADR 0004 says the server reads and writes one directory and nothing outside
 * it, and this file is where that sentence becomes true rather than intended.
 *
 * There are two checks and they are deliberately redundant, because they fail in
 * different directions. `isSafeSegment` rejects a name that cannot be one path
 * segment, which is a statement about the name. `resolveWithin` resolves the
 * path anyway and refuses anything that landed outside the root, which is a
 * statement about the result. A name the first check let through by an oversight
 * still has to survive the second, and the second is the one that cannot be
 * argued with, because it asks the path library where the file actually is.
 *
 * What is not checked: symlinks. A `tables/` that is a link out of the tree
 * defeats a string comparison, and resolving links would mean resolving a parent
 * that does not exist yet for a file being created. The guard here is against
 * the web page, which can only choose names, and not against the developer, who
 * owns the directory and could have deleted it by hand.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Separators, a drive or stream colon, and anything unprintable. */
const CONTROL_OR_SEPARATOR = /[\u0000-\u001f/\\:]/
/**
 * Windows resolves these to devices wherever they appear, extension or not, so
 * writing `tables/nul.md` writes to the null device and reports success.
 */
const RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i

/**
 * Whether a name from a request can be exactly one path segment.
 *
 * Stricter than `writeModel`'s own check, on purpose: the writer is given names
 * by a reader that got them from file names, and this is given names by a page.
 */
export function isSafeSegment(name: string): boolean {
  if (name === '' || name.length > 255) return false
  if (name === '.' || name === '..') return false
  if (CONTROL_OR_SEPARATOR.test(name)) return false
  // Windows silently strips a trailing dot or space, so `orders ` and `orders`
  // are one file there and two names here.
  if (/[. ]$/.test(name)) return false
  if (RESERVED_DEVICE.test(name)) return false
  return true
}

/**
 * The absolute path of `segments` under `root`, or `undefined` when resolution
 * put it somewhere else.
 *
 * `root` itself is refused too: every caller wants a file inside the directory
 * rather than the directory, and returning it would hand back a path the caller
 * would go on to write over.
 */
export function resolveWithin(root: string, ...segments: readonly string[]): string | undefined {
  const base = resolve(root)
  const target = resolve(base, ...segments)
  const step = relative(base, target)
  // An absolute `step` means another drive on Windows, which `..` cannot even
  // express, and an empty one means the target is the root itself.
  if (step === '' || isAbsolute(step)) return undefined
  if (step === '..' || step.startsWith(`..${sep}`)) return undefined
  return target
}
