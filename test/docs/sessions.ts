/**
 * `dbmd-run`: the tag, and the one function that reads a block carrying it.
 *
 * Two pages spell this tag today. `README.md`'s import walkthrough uses it
 * (ADR 0056, which is where the tag was decided) and
 * `.claude/skills/dbmd/SKILL.md` reused it rather than inventing a second
 * spelling of the same idea. Until this module each page's test held its own
 * copy of the twenty-two lines below, and the copies were identical except for
 * the page name inside three error strings.
 *
 * WHY THIS ONE WAS LIFTED WHEN THE FENCE SCANNERS WERE NOT
 * The five readers under `test/docs/` and `test/import/` each scan a page for
 * fences, and those scanners differ from one another in ways that are about the
 * pages rather than about the scanning. This is the opposite case. `dbmd-run`
 * is a *contract with an author*, shared by two pages, and the author is
 * promised that a block written one way means the same thing on either page.
 * Two copies of the function that reads it can drift apart while both suites
 * stay green, which makes a block that passes on one page one that would have
 * failed on the other, with nothing anywhere saying so. That is a defect rather
 * than untidiness, and it is the reason this is a module and the fence loop is
 * not.
 *
 * The divergence is not hypothetical and was reproduced before this module was
 * written. Dropping a trailing blank line from a command's output, which is the
 * edit an author makes the first time they space two commands apart inside one
 * fence, was applied to `test/docs/skill.test.ts`'s copy alone. All five doc
 * suites stayed green, and a two-command session with a blank line between the
 * commands then passed against `SKILL.md` and failed against `README.md`. With
 * one copy that edit is either made for both pages or not at all.
 *
 * WHAT IS NOT HERE
 * The regular expression that finds the tag on a page stays in each reader.
 * Neither page carries only `dbmd-run` blocks: `README.md` has three more tags
 * and `SKILL.md` has two, so the alternation is each page's own and there is
 * nothing to share but the spelling of this one alternative, which `DBMD_RUN`
 * below is.
 */

/**
 * The info string that marks a shell session.
 *
 * Exported so that the two pages' readers cannot come to disagree about how it
 * is spelled while agreeing about what it means, or the other way round. A page
 * whose blocks stopped matching would fail loudly on the floor assertion each
 * reader carries; it is the reading that can drift quietly, and that is
 * `sessionIn`.
 */
export const DBMD_RUN = 'dbmd-run'

/** A command in a session, and what the block says it printed. */
export interface Step {
  readonly argv: string[]
  readonly expected: string
}

/**
 * As much of a block as reading a session needs.
 *
 * The two readers carry different `Block` types, because their pages carry
 * different tags, and both are assignable to this. `line` is here so that a
 * malformed session says where to look rather than only what was wrong.
 */
export interface SessionBlock {
  readonly text: string
  /** The line the fence opened on. */
  readonly line: number
}

/**
 * A shell session as commands and the output each one claims.
 *
 * A line opening with `$ ` is a command and everything under it up to the next
 * one is what it printed. The prompt is dropped, `dbmd` is dropped because that
 * is the name of the binary rather than an argument, and what is left is the
 * argument list `main` is given.
 *
 * `page` is the path the failure should name. It is a parameter rather than
 * anything this module works out, because a block can be handed here from a
 * region of a page that this module has no business knowing about:
 * `test/docs/readme.test.ts` reads three plain fences with it that are not
 * tagged at all.
 */
export function sessionIn(page: string, block: SessionBlock): Step[] {
  const session: { argv: string[]; output: string[] }[] = []
  for (const line of block.text.split('\n').slice(0, -1)) {
    if (line.startsWith('$ ')) {
      const words = line.slice(2).trim().split(/\s+/)
      if (words[0] !== 'dbmd') {
        throw new Error(`${page}:${block.line} runs \`${words[0] ?? ''}\`, and only dbmd runs here`)
      }
      session.push({ argv: words.slice(1), output: [] })
      continue
    }
    const current = session.at(-1)
    if (current === undefined) {
      throw new Error(`${page}:${block.line} has output above its first command`)
    }
    current.output.push(line)
  }
  if (session.length === 0) throw new Error(`${page}:${block.line} runs nothing`)
  return session.map(({ argv, output }) => ({
    argv,
    expected: output.length === 0 ? '' : `${output.join('\n')}\n`,
  }))
}
