# 0101. A tag two pages share is read by one function, and the fence loop under it is not

Answers the third revisit entry of
[ADR 0056](0056-a-block-in-the-readme-is-a-run-or-a-sketch.md), in a narrower way
than that entry predicted, and declines the rest of it on measurement rather than
on taste.

## Context

ADR 0056 decided `dbmd-run` for one page. Its third `Revisit when` entry said
that a third page carrying output blocks is the moment to lift the fence parser
out of both tests rather than to copy it again. That entry has now fired well
past its threshold: five pages carry blocks that a test reads, and five test
files read them, each with its own scanner.

| page | what is asserted | reader |
| --- | --- | --- |
| `docs/format.md` | ` ```markdown dbmd: ` and ` dbmd-error: ` blocks | `test/docs/format.test.ts` |
| `docs/import-format.md` | ` ```json dbmd-import: ` blocks | `test/import/docs.test.ts` |
| `README.md` | ADR 0056's four tags | `test/docs/readme.test.ts` |
| four pages | every plain ` ```json ` payload on them | `test/docs/payloads.test.ts` |
| `.claude/skills/dbmd/SKILL.md` | `dbmd-run` and two script tags | `test/docs/skill.test.ts` |

**The agent who wrote the fifth reader reported something the entry did not
predict, and it is the reason this record exists.** Having written one beside the
other four, in #251, it said that the duplication worth fixing first is not the
parser. It is `sessionIn`, the twenty-two lines that read a `dbmd-run` block into
commands and the output each one claims. `dbmd-run` had become a contract shared
by two pages while the function that reads it was copied, and two copies of that
function can drift while both suites stay green. Its words: two pages spelling
the tag identically while two tests read a session differently means a block that
passes on one page and would have failed on the other, and nothing would ever say
so.

**That was reproduced rather than believed.** The edit was chosen for being the
one an author actually makes: the first time somebody writes two commands in one
fence with a blank line between them, for the same reason a terminal has one, the
block fails, because the blank line is read as the first command's last line of
output. The fix is to drop a trailing blank line from a command's output, and it
was applied to `test/docs/skill.test.ts`'s copy alone, which is what an author
working on that page does.

All five doc suites stayed green. The two copies, sliced verbatim out of the two
files and handed the same block, then disagreed about it:

```
README.md reads it as: ["FAIL  dbmd refs customers examples/shop", "PASS  dbmd check examples/shop"]
SKILL.md  reads it as: ["PASS  dbmd refs customers examples/shop", "PASS  dbmd check examples/shop"]
```

The block is not on either page, which is exactly why nothing was red. It is a
block an author could write on either page tomorrow, and on that day one page
would accept it and the other would refuse it, with the tag spelled identically
on both.

## Decision

**`test/docs/sessions.ts` holds `DBMD_RUN` and `sessionIn`, and both pages'
readers import them.**

**A helper module rather than one reader exporting to the other.** The two
candidates were a module under `test/` and having `readme.test.ts` export to
`skill.test.ts`. The second is not available: a `.test.ts` file imported by
another registers its own describes a second time, and `readme.test.ts`
additionally reads `README.md` and computes the walkthrough's bounds at module
scope. The module also gives the contract somewhere to be written down that is
neither page's reader, which is the right home for a thing two pages promise an
author. `test/cli/harness.ts` and `test/model/helpers.ts` are the same shape and
came first.

**`sessionIn` takes the page as its first argument.** That is the whole of what
the two copies differed by: three error strings naming the file. Passing it keeps
every failure message byte for byte what it was, and it has to be a parameter
rather than something the module derives, because `readme.test.ts` also hands it
three plain fences that are outside the tagged region entirely.

**The tag is a constant and each reader builds its own opening regex from it.**
Neither page carries only `dbmd-run`: `README.md` has three more tags and
`SKILL.md` has two. There is nothing to share but the spelling of this one
alternative, so the alternation stays in each reader as a list with `DBMD_RUN` in
it. This buys less than `sessionIn` does, because a tag that stopped matching
fails loudly on the floor assertion each reader already carries. It is worth
having anyway: the constant is where an author now finds out what the tag means.

**The fence loop is not lifted, and the reason is a measurement rather than a
preference.** The case for lifting it is that it is the layer where a bug is
silent: an unterminated fence or a fence inside a fence would produce a quietly
wrong block set and a green suite. That was tested. All five scanners were sliced
out of their files and driven with both malformed pages.

An unterminated fence throws in every one of them, naming the page and the line:

```
readme.test.ts blocksIn      THREW: unterminated fence at README.md:2
skill.test.ts blocksIn       THREW: unterminated fence at .claude/skills/dbmd/SKILL.md:2
skill.test.ts payloadsIn     THREW: unterminated fence at .claude/skills/dbmd/SKILL.md:2
format.test.ts blocksIn      THREW: unterminated fence at docs/format.md:2
payloads.test.ts payloadsIn  THREW: unterminated fence at a page:2
```

A fence inside a fence truncates the block at the inner closer, and every one of
the five then resumes and finds the next real block. None of them drops it:

```
readme.test.ts blocksIn      returned 2 block(s): text "one", text "second block"
skill.test.ts blocksIn       returned 2 block(s): text "one", text "second block"
skill.test.ts payloadsIn     returned 2 block(s): text "one", text "second block"
format.test.ts blocksIn      returned 2 block(s): text "one", text "second block"
payloads.test.ts payloadsIn  returned 2 block(s): text "one", text "second block"
```

A truncated block is then compared against what the command actually printed and
fails with a diff. So the silent bug the lift was to be sold on does not exist:
the five scanners already agree, exactly, on both shapes, and both shapes are
loud. What is left to buy is one nesting rule instead of five identical ones,
which is tidiness, and tidiness is not what ADR 0056's entry claimed.

**What the available lift actually is, since the entry describes it as twelve
lines five times and it is not.** The five scanners take different input
(`format.test.ts` takes the page as one string, the rest take lines), match
differently (three match a regex over an info string, two match the exact line
` ```json `), disagree about whether the block's text gains a trailing newline
(three yes, two no), and return four different record shapes. The only honest
shared form is a `fencesIn(page, lines)` returning every fence with its info
string, its text and its opening line, with all four of those differences handed
back to five new filter-and-map call sites. Net lines are roughly flat. ADR 0056's
own note that a lift assuming one shape would have to give all five back is
correct, and giving them all back is most of the change.

## Consequences

- **The mutation that produced the divergence can no longer be made one-sided.**
  Applied to `test/docs/sessions.ts`, the same edit moves both pages together:
  the block above goes from `FAIL`/`PASS` split to `PASS` on both. An edit that
  breaks the reading turns both suites red at once, which was measured too:
  dropping one argument from every parsed command failed six tests across
  `readme.test.ts` and `skill.test.ts` together, where before this it would have
  failed only the file it was made in.
- **No suite changed what it asserts.** The same five files run the same 68
  tests, and every failure message is the string it was, because the page name
  the copies hardcoded is now the argument passed in.
- **The fence scanners are still five, and this record is the note saying that is
  a decision rather than an oversight.** ADR 0056's entry stays answered rather
  than open, which is what its 2026-09-07 append asked for and could not do from
  inside a sweep.
- **The opening regexes are now built rather than written.** `new RegExp` over a
  joined list reads less directly than a literal, and each reader gained a `TAGS`
  line to make the list legible. That is the price of the tag having one
  spelling, and it is charged in two files.
- **Nothing was measured about speed because there is nothing to measure.** One
  function moved between files.

## Revisit when

- **A third page starts carrying `dbmd-run`.** Two pages sharing an author-facing
  tag is what made a shared reader worth its module. A third is not a new
  argument, but it is the moment to ask whether the block's *fixture* wants a
  home too, which is the question #246 raised and nobody has answered: a marker
  language rich enough to carry a filesystem state is still undesigned.
- **A fence scanner is found to have dropped a block silently.** The measurement
  above says both malformed shapes are loud, and it was taken over synthetic
  pages rather than over every shape a page can take. A real instance is the
  evidence that the lift declined here should happen, and it should be recorded
  with the page that produced it.
- **A sixth reader is written.** Five was the count at which the duplication
  worth fixing turned out to be one function rather than the parser. A sixth
  author should read this record before deciding they have found the same thing,
  because the answer here was narrower than the question looked.
- **`readme.test.ts`'s untagged-fence check and its `blocksIn` are found to
  disagree.** The first toggles on any line beginning with three backticks and
  the second requires the closing line to be exactly three, so a fence closed
  with four would be a tagged block to one and an unterminated fence to the
  other. `blocksIn` throws in that case, so the disagreement is loud today and
  was left alone. If it ever becomes quiet, they should be one scanner.
