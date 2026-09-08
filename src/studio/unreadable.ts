/**
 * The one question that tells a file nobody can read from a file that is wrong,
 * and the sentence said about the first of them.
 *
 * ADR 0019's second amendment stopped the write path guessing that a file
 * another program was holding open had been edited by a person, and its third
 * stopped a delete answering the same guess with a 500. Both did it the same
 * way: **ask the reader what it found, and repeat the clause it wrote**. The
 * third place the guess was still being made is what the page draws and what
 * the panel says about an object it is holding from memory, which is two files
 * in `src/studio/client/` and one refusal in `src/studio/edits.ts`.
 *
 * So the question lives here rather than in any of the three. It holds no
 * `node:` import and touches no DOM, which is what lets the server and the
 * browser bundle both have it, and is the whole reason it is a module: three
 * copies of this rule would be three chances for one of them to answer
 * differently, and the defect it exists for is exactly two surfaces disagreeing
 * about somebody's disk.
 */

import type { Diagnostic } from '../model/types.js'

/**
 * What the reader said about a file it could not read at all, or `undefined`
 * when the file is not one of those.
 *
 * The containing directory counts, and that is not a flourish: a `tables/` that
 * cannot be listed leaves every table missing from the read for exactly the
 * same reason one locked file does, and anything refused for that has the same
 * two candidate explanations. Its clause reads `cannot list the directory:` and
 * says so, and since ADR 0086 its location says `in: 'directory'` rather than
 * claiming to be a file, which is why both are asked for here. The set of
 * diagnostics this matches is the one it has always matched.
 *
 * Only `file-unreadable`, and deliberately. A file that is there and does not
 * parse is also missing from the read, and for that one "did not parse" is
 * true: the file says something the reader could not build the object from, the
 * diagnostics say where, and a person can go and fix it. The distinction this
 * draws is between a file whose contents are unknown and a file whose contents
 * are known and wrong, which is the distinction the reader already makes.
 */
export function saidAbout(diagnostics: readonly Diagnostic[], path: string): string | undefined {
  const directory = path.slice(0, path.lastIndexOf('/'))
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== 'file-unreadable' || diagnostic.at.in === 'document') continue
    if (diagnostic.at.path === path || (directory !== '' && diagnostic.at.path === directory)) {
      return diagnostic.message
    }
  }
  return undefined
}

/**
 * Whether the read this came from failed to open anything at all.
 *
 * The same question as `saidAbout` with the path taken off, and it is here
 * rather than beside its one caller for the reason the rest of this module is:
 * a second way of asking what counts as unreadable is a second chance for two
 * places to disagree about somebody's disk. Both answers come from the same
 * two lines, so a session that says "nothing here is unreadable" cannot be
 * holding an object whose refusal would say otherwise.
 *
 * Its caller is ADR 0061's recheck, which is allowed to re-read the model
 * directory only while this is true, and stops the moment it is not.
 */
export function anythingUnreadable(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic) => diagnostic.code === 'file-unreadable' && diagnostic.at.in !== 'document',
  )
}

/**
 * What a scene says in place of "did not parse", for the object whose file the
 * reader could not open.
 *
 * "Did not parse" is a lie about a file another program has open, and it is a
 * lie with an instruction attached: it tells somebody to fix a file that has
 * nothing wrong with it and to reload a page that is already up to date. That
 * is the third false reason dbmd-c7q was opened for, after ADR 0019's
 * amendments removed two.
 *
 * It names no cause, for the reason every other sentence about this names none:
 * a file is unreadable for whatever reason the operating system gives, and
 * "another program has it open" is right on Windows with an editor holding the
 * file and wrong the day the cause was a permission change. The reader has
 * already turned the errno into a clause a person can act on, so the honest
 * thing is to repeat it.
 *
 * `consequence` is the scene's own half, because the canvas and the panel are
 * stopped from doing different things by the same fact. The last clause is what
 * makes the whole sentence something a person can act on: there is nothing in
 * the file to fix and reloading does not help, so it names the condition
 * instead, which is the shape the write path's own refusal settled on.
 *
 * Deliberately not the same function as `edits.ts`'s `couldNotBeRead`, which is
 * a refusal said at the moment an edit was dropped and has a different job. The
 * clause they share is the reader's, and it is the reader's in both because
 * both ask `saidAbout` for it.
 */
export function couldNotBeReadNow(path: string, consequence: string, said: string): string {
  return (
    `${path} could not be read just now, so ${consequence}: ${said}. ` +
    `There is nothing in the file to fix; it comes back on its own once the file can be read.`
  )
}
