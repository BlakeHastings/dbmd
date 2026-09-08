# 0076. A block a sweep found exact is held by the table that already reads the page

## Context

[ADR 0069](0069-a-count-the-program-derives-is-proved-on-the-page-not-deleted-from-it.md)
put one block outside the `dbmd import` walkthrough under a guard: the
`dbmd query --engine postgres` block, whose transcription of a count the program
derives had drifted to 9827 while the command printed 12403. The mechanism is a
table in `test/docs/readme.test.ts` that names a command over a block, finds the
block by its literal `$ ` line, and compares the rest of the fence to what the
command wrote to stderr.

It drew its boundary at a property rather than at an appetite. `dbmd query`
takes no directory, opens no file and binds no socket, so it runs with no
sandbox and no working directory, and every other block on that page needs one
or the other.

**Its consequences then recorded a sweep.** On 2026-09-07 the `dbmd init` block,
the `dbmd check examples/shop` block, the `dbmd check` error block with its
`echo $?` and the `dbmd studio` block were each run by hand and matched the page.
That is a date, and a date is not a guard. It is also exactly what was true of the
`dbmd query` block until the morning somebody counted: a block that was right the
last time a person looked, with nothing between it and the next edit.

**A census of the pages on 2026-09-07.** Every `.md` file in the working tree
outside `node_modules`, `dist` and `.claude` was read, every fence opened by a
line beginning with three backticks and closed by the next line that is only
three backticks was counted, and the ones holding a line beginning `$ dbmd `
were listed. That is 178 fences across 143 files, of which 14 run
`dbmd` and print something back. Three of those are in decision records, which
describe what was true when they were written and are not maintained against a
run. Three are inside the import walkthrough and are held by
[ADR 0056](0056-a-block-in-the-readme-is-a-run-or-a-sketch.md)'s tags. The other
eight are on `README.md`, outside the walkthrough:

| block | what held it before this record |
| --- | --- |
| `README.md:216`, `dbmd init` | the hand sweep in ADR 0069 |
| `README.md:236`, `dbmd query --engine postgres` | ADR 0069's table |
| `README.md:383`, `dbmd studio examples/shop --no-open` | the hand sweep; excluded by ADR 0056 because it prints a port the kernel chose |
| `README.md:393`, `dbmd check examples/shop` | the hand sweep |
| `README.md:401`, `dbmd check` and `echo $?` | the hand sweep |
| `README.md:439`, `dbmd refs orders examples/shop` | nothing |
| `README.md:468`, `dbmd export shop --stdout` and `dbmd refs addresses shop` | nothing, and nothing can: `shop` is a model this repository does not have, and the first command in it exits 1 |
| `README.md:501`, the `dbmd export` pair | nothing |

**Two of those had never been checked by anything.** Both were run by hand on
2026-09-07 and both were exact to the byte, which is the position the
`dbmd query` block was in the morning of the day it was found wrong.

## Decision

**Both go into ADR 0069's table, and the table grows two properties rather than
becoming a second walkthrough.**

**A row is read as the shell session it is.** `sessionIn`, which the walkthrough
already uses, turns a fence into commands and the output each one claims, so a
fence holding two commands is two runs. That is what the `dbmd export` pair
needs and it is the whole point of that block: the second command answers
"already up to date" only because the first one wrote. `argv` stays on the row
for the one block whose `$` line cannot be parsed, because
`> introspect.sql` would reach `parseArgs` as a directory.

**A row may name `setup`: commands run first, in a fresh empty directory that the
block then runs from.** `dbmd export` with no argument writes
`db-model/README.md`, and the model it writes about is the one `dbmd init` makes,
which is what the page's prose says. A row without `setup` runs from the
repository root, which is what `dbmd refs orders examples/shop` needs, because
the directory the page hands it is committed here and the page prints the path a
reader types (ADR 0006).

**A row says whether its commands put anything on stdout.** `dbmd query` puts the
SQL there, which is why the page shows the redirect. The other two put nothing
there. That is a claim worth holding: a command that started writing to stdout
would turn the page's block into half a transcript, with the missing half
invisible on a terminal where both streams look the same, which is the mistake
[ADR 0011](0011-the-cli-writes-through-one-module.md) exists to prevent.

**The working directory is moved for the length of one test and put back in a
`finally`.** `process.chdir` is global to the worker, which the walkthrough
already depends on and already says so. The walkthrough holds it for a whole
describe because it is one ordered session across several tests. A narrated block
is one session in one test, so it holds it for one test.

**This answers ADR 0069's first revisit entry, and does not do what that entry
says.** The entry reads: *a second command earns an entry in the table. One row
is a table with a boundary; three rows with three sandboxes between them is the
walkthrough's machinery being rebuilt in the wrong file, and at that point the
two should become one.* The condition fired and the prediction did not. There are
three rows and **one** sandbox, because only one of the two new blocks writes
anything. The row that does not write needs a working directory, not a sandbox,
and that is one line rather than a fixture tree.

**Folding the export pair into the walkthrough's sandbox would be wrong on the
page rather than merely inconvenient.** That sandbox holds a copy of
`test/import/fixtures` and runs the walkthrough's blocks as one sequence, so the
`dbmd export` block's output would become true only after `dbmd import` had run
in the same directory. The page does not say that and a reader cannot check it.
The block's claim is about a fresh directory after `dbmd init`, and that is what
it now runs in.

**Neither block is tagged.** ADR 0056's first revisit declined to demand a tag on
every fence on this page, because most of them are prose, and ADR 0069 chose
naming the command in a test over a fifth tag. Nothing has changed about that
argument. The page reads exactly as it did.

## Consequences

- **`README.md` is unchanged.** Both blocks were already right, so this record
  buys the property that they stay right rather than a correction. The owner has
  uncommitted work near the top of that file and the best diff against it is
  none.
- **The guards have been seen to fail, as
  [ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md)
  requires, in six shapes across the two blocks.** For `dbmd refs`: changing
  `2 refs` to `3 refs` on the page fails with a diff naming README.md:440, and
  changing `on delete: cascade` to `on delete: set null` in
  `examples/shop/tables/order_items.md` fails with the same diff from the other
  direction, which is the one that matters, because it is a person editing the
  model rather than a person mistyping the page. For `dbmd export`: changing
  `2 tables` to `3 tables` on the page fails naming README.md:502; changing
  `is already up to date` to `is up to date` in `src/cli/export.ts` fails the
  same way; and **swapping the block's two output lines fails**, which is the
  demonstration this block needed most, because it is the proof that the second
  command's answer is being held to the fact that the first one ran. The stdout
  property was watched too: adding `out.data(after)` to `runExport` fails with
  "what `dbmd export` put on stdout, which the block does not show".
- **A change to what `dbmd init` writes turns the page red.** The export block
  says "2 tables, 1 relationship" about the model `dbmd init` creates, so a fifth
  starter file with a table in it is now a change to `README.md` as well. That is
  the intended cost and it is small: the page is making a claim about that model
  and the claim should move with it.
- **Three blocks on the page are still held only by the sweep**, and that is now
  written in two places rather than one. `dbmd init`, `dbmd check examples/shop`
  and the `dbmd check` error block each want a directory in a known state, so
  each is a sandbox, and each is a row this table could take. They are left out
  because the argument for taking them is "we could" rather than a defect, and
  because the next person deserves to inherit a table with a reason in it rather
  than a habit. `dbmd studio` keeps ADR 0056's exemption unchanged: it prints a
  port the kernel chose.
- **The `shop` block at `README.md:468` cannot be taken by this mechanism at
  all.** It is one fence holding two commands over a model this repository does
  not have, and its first command exits 1, which the table assumes never happens.
  It is a sketch in the ADR 0056 sense without carrying the tag, because the tag
  rule stops at the walkthrough. The prose above it says what it is.
- **It costs about thirty milliseconds and one temporary directory** on top of
  what the file already spent.

## Revisit when

- **A fourth row wants a sandbox of its own.** One sandbox in this table is a
  property of one block. Three would be the walkthrough's machinery rebuilt in
  the wrong file, which is the thing ADR 0069 predicted and this record avoided
  rather than refuted, and at that point the two mechanisms should become one.
- **One of the three swept blocks goes stale.** That is the evidence that a hand
  sweep recorded in a decision record is not enough, and the answer is a row
  rather than a correction, for the reason ADR 0056 and ADR 0069 both give.
- **`README.md:468` stops being a sketch.** A committed `shop` fixture, or a
  block whose commands all exit 0, removes both objections at once, and the
  second of them is a row property this table does not have yet.
- **The page stops promising that its blocks are output.** "The commands" opens
  by saying every block below it is real output. Five of the fourteen blocks
  that run `dbmd` are now proved on every build and four more were proved once by hand.
  If that sentence ever goes, the reason for all of this goes with it.
