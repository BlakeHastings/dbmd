/**
 * Where a model directory keeps things.
 *
 * ADR 0005 puts a directory per kind under the model root, which makes the
 * mapping between a kind and a directory a fact the reader and the writer must
 * agree on exactly. It lives here so there is one of it: a writer that put
 * notes in `note/` while the reader looked in `notes/` would lose a file on
 * every save and say nothing.
 */

import type { ObjectKind } from './types.js'

/** The one file that is about the model rather than about an object on it. */
export const MODEL_FILE = '_model.md'

/** The directory decides the kind; the `kind:` key is a cross-check (ADR 0005). */
export const KIND_DIRECTORIES: ReadonlyMap<string, ObjectKind> = new Map<string, ObjectKind>([
  ['tables', 'table'],
  ['notes', 'note'],
  ['groups', 'group'],
])

const DIRECTORY_OF_KIND: ReadonlyMap<ObjectKind, string> = new Map(
  [...KIND_DIRECTORIES].map(([directory, kind]) => [kind, directory]),
)

export function directoryOfKind(kind: ObjectKind): string {
  const directory = DIRECTORY_OF_KIND.get(kind)
  // `ObjectKind` is closed and the map is built from the same source as the
  // reader's, so this is unreachable rather than defensive: it is here to keep
  // the return type a string instead of leaking `undefined` to every caller.
  if (directory === undefined) throw new Error(`no directory for kind ${kind}`)
  return directory
}
