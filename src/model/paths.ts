/**
 * Where a model directory keeps things, and what a file in it may be called.
 *
 * ADR 0005 puts a directory per kind under the model root, which makes the
 * mapping between a kind and a directory a fact the reader and the writer must
 * agree on exactly. It lives here so there is one of it: a writer that put
 * notes in `note/` while the reader looked in `notes/` would lose a file on
 * every save and say nothing.
 *
 * `isFileName` is here for the same reason. The writer needs it to refuse a
 * name rather than let the filesystem throw, the studio needs it as the first
 * half of its own stricter check, and an importer needs it because a name a
 * database catalogue accepts is not automatically a name a file can have. Three
 * callers and one rule. ADR 0026.
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

/** Path separators, what Windows refuses in a name, and anything unprintable. */
const NOT_IN_A_FILE_NAME = /[\u0000-\u001f<>:"\/\\|?*]/

/**
 * The longest one path component may be on ext4, APFS and NTFS alike.
 *
 * In UTF-8 bytes rather than characters: ext4 counts bytes and NTFS counts
 * UTF-16 code units, and a string is never fewer bytes in UTF-8 than it is code
 * units in UTF-16, so counting bytes answers both at once.
 */
const MAX_FILE_NAME_BYTES = 255

/**
 * What an object's name has to leave room for besides itself.
 *
 * Three for `.md`, and 42 for the temporary file `write.ts` opens beside the
 * target before renaming it over: a leading dot, a separating dot, a
 * 36-character UUID and `.tmp`. The longest name an object causes to exist is
 * that one and not its own, so a name that fits as `orders.md` and not as
 * `.orders.md.<uuid>.tmp` opens the second and throws, which is dbmd-23's bug
 * one layer down, found by writing this rule and then testing the boundary it
 * claimed. `test/model/write.test.ts` writes a name either side of it, so the
 * budget and the writer cannot drift apart in silence.
 *
 * What is deliberately not counted is the model directory's own path. A deep
 * enough checkout exceeds Windows' 260-character limit whatever dbmd calls its
 * files, and that is a fact about where the user put the directory rather than
 * about a name in their model.
 */
const RESERVED_FOR_THE_WRITER = '.md'.length + 42

/**
 * Whether an object called `name` has a file it can be written to.
 *
 * The question is narrow on purpose. It is not "is this a sensible name" but
 * "will `open` accept `<name>.md` on every machine this model will be checked
 * out on", because that is exactly the question whose wrong answer becomes an
 * exception instead of a `WriteSkip`. ADR 0026.
 *
 * The set refused is the union across platforms and not the local one. POSIX
 * refuses only `/` and NUL, so a table called `Ledger: Entry` imported on Linux
 * is a file nobody can check out on Windows, and a writer whose answer depended
 * on where it ran would break ADR 0006's rule that the output is deterministic.
 *
 * Measured on Windows 11 with Node 24: `<`, `>`, `"`, `|`, `?`, `*` and every
 * character below U+0020 fail `open` with `ENOENT`, and so does a file name of
 * 256 characters. `:` is worse than a failure: `orders:draft.md` opens an NTFS
 * alternate data stream on a file called `orders`, so a plain
 * `writeFile` reports success while the bytes appear in no directory listing
 * and no `git diff`; through the writer's temporary file it fails on the rename
 * with `EINVAL` instead, and leaves a stray `.orders` behind.
 *
 * What is *not* refused is as deliberate. A trailing dot or space and the
 * Windows device names (`nul`, `con`, `com1`) all wrote and read back as
 * ordinary files in the same measurement, so refusing them here would mean a
 * directory the reader can read holding files the writer will not write back.
 * `src/studio/safe-path.ts` refuses them one layer up because it takes names
 * from a web page rather than from a directory listing, which is suspicion
 * rather than duplication, and `docs/format.md` documents both layers.
 */
export function isFileName(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false
  if (NOT_IN_A_FILE_NAME.test(name)) return false
  const bytes = new TextEncoder().encode(name).length
  return bytes + RESERVED_FOR_THE_WRITER <= MAX_FILE_NAME_BYTES
}
