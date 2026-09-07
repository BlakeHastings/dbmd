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
 * The first check no longer spells the file-name rule out. It asks `isFileName`
 * in `src/model/paths.ts`, which is the writer's rule, and then adds the two
 * refusals that are the studio's own. ADR 0026 named that split and this is it:
 * one place decides what a file may be called, and the boundary is suspicious
 * on top of that answer rather than instead of it.
 *
 * What is not checked: symlinks. A `tables/` that is a link out of the tree
 * defeats a string comparison, and resolving links would mean resolving a parent
 * that does not exist yet for a file being created. The guard here is against
 * the web page, which can only choose names, and not against the developer, who
 * owns the directory and could have deleted it by hand.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path'
import { isFileName } from '../model/paths.js'

/**
 * Windows resolves these to devices wherever they appear, extension or not, so
 * writing `tables/nul.md` writes to the null device and reports success.
 */
const RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i

/** Windows silently strips either, so `orders ` and `orders` are one file there. */
const TRAILING_DOT_OR_SPACE = /[. ]$/

/**
 * Whether a name from a request can be exactly one path segment.
 *
 * Stricter than the writer's own check, on purpose, and stricter in exactly two
 * ways. The writer is handed names by a reader that got them from a directory
 * listing, so a name it refuses is one the filesystem refused before dbmd was
 * involved. This is handed names by a page, so it also refuses names the
 * filesystem here accepts and something else downstream may not.
 *
 * The two are a Windows device name, and a trailing dot or space. Both are
 * suspicion rather than measurement: on Windows 11 with Node 24 `tables/nul.md`
 * and `tables/orders .md` are ordinary files that read back what was written to
 * them, and dbmd's own writer creates them without a word. The server refuses
 * them because it cannot know which path handling the next reader of the
 * directory will use, and a name that is a file here and a device somewhere else
 * is the worst shape a portability bug comes in. They stay out of `isFileName`
 * for the reason ADR 0026 gives: refusing them there would mean a directory the
 * reader can read holding files the writer will not write back.
 *
 * Everything else is `isFileName`'s answer, including the length, which used to
 * be spelled here as 255 characters while the writer stopped at 210. A
 * 230-character table name was accepted over HTTP and then skipped by the
 * writer, which turned a refusal the client could show into a `WriteSkip`
 * nobody asked for.
 */
export function isSafeSegment(name: string): boolean {
  if (!isFileName(name)) return false
  if (TRAILING_DOT_OR_SPACE.test(name)) return false
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
