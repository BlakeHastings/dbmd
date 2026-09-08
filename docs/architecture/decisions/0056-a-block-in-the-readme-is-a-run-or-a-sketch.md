# 0056. A block in the README is a run or a sketch, and it says which

## Context

`README.md` opened "The commands" with a promise: *every block below is real
output*. Nearly all of them were, and that is what made the exception expensive.

Two blocks in the `dbmd import` walkthrough were written as runs of
`dbmd import --file next-release.json --dir shop-model`. Neither could have been
run. `next-release.json` is a database that changed between releases, which is
the right thing for a walkthrough to talk about and is not a file in this
repository. One of the two then answered "4 tables, nothing to change" over a
model the page had built four paragraphs earlier with two tables in it, and no
step between them added any (dbmd-wie).

Nothing on the page distinguished those blocks from the ones beside them, which
had been run and were exact. A block that was run and a block that was imagined
are the same six lines of monospace, so a reader had no way to know which
numbers to trust, and the honest ones were not evidence for anything.

`scripts/check-commands.mjs` already reads this page, and reads it for the thing
ADR 0036 and ADR 0043 decided: a backticked command is a claim that it exists,
and every command owes the README an entry. `dbmd import` exists and has an
entry, so both rules passed on a block whose output was invented.

**A second, quieter instance was found by writing the check.** The walkthrough
shows `shop-model/tables/orders.md` "in full", and the file dbmd writes says
`default: "0"` where the page said `default: '0'`. Nobody typed that: Prettier
formats the inside of a ` ```markdown ` block, and it had rewritten the quoting
of a file that was quoted the way `writeModel` quotes it. A page that is
reformatted is not a page that was run, and there was nothing to notice.

`docs/format.md` had already solved the general problem for itself. Its examples
are not illustrations, they are inputs: tagged in the info string, assembled and
read, and required to produce exactly the diagnostics the page claims. The info
string beyond the language is invisible on GitHub, so the page reads as prose and
still cannot lie.

## Decision

**A fenced block in the `dbmd import` walkthrough declares whether it was run,
and the build enforces the declaration.** `test/docs/readme.test.ts` is
`docs/format.md`'s mechanism applied to `README.md`, with three tags:

    ```dbmd-run
    ```markdown dbmd-file:shop-model/tables/orders.md
    ```dbmd-sketch

**`dbmd-run` is a shell session that is run.** Every `$ dbmd ...` line in it is
executed in order and the lines under it must equal what that command wrote to
stderr, which is where every command's narration goes. The exit code must be 0.

**`dbmd-file:` is a file the session above it wrote**, and must equal it byte for
byte.

**`dbmd-sketch` is not run, and the sentence above it calls it a sketch.** That
word is the only part of the mark a reader ever sees, and it is checked, because
the tag is invisible on GitHub and therefore tells a reader nothing on its own.

**The session runs from a sandbox rather than with absolute paths.** A command
prints the directory it was given (ADR 0006), so a run passing an absolute
`--dir` prints an absolute path, and the page shows `shop-model` because that is
what a reader types. The fixtures are copied to the path the page names, the
working directory moves there, and the command runs exactly as written. Editing
an absolute path back out of the output afterwards would make the assertion agree
with the page about a string neither of them ran.

**Only `test/import/fixtures/` is copied in.** A block naming a file outside it
fails to read that file, which is the question its author should be answering:
either it is a committed fixture, or the block is a sketch.

**Every fence in the walkthrough must carry one of the three tags.** The defect
was never the wrong number; it was that nothing said which blocks had been run.
An untagged fence is an author who has not answered that yet.

**The scope is the `dbmd import` entry, anchored on the entry convention** that
ADR 0043 already reads the page by, running to the start of the next entry. It
is not the whole README, and the two blocks left out of it on purpose are named
in the consequences below.

**The page says all of this in its own words**, under "The commands", because
the tags are invisible and a reader deserves to know which blocks are evidence.

## Consequences

- **A number in the walkthrough cannot go stale silently.** Changing
  `test/import/fixtures/postgres-raw.json` turns the suite red with a diff of the
  block against the run, which is the failure ADR 0034 asks a guard to have been
  seen to produce. It has been: a digit changed back to `4` was caught, and so
  was `default: '0'` restored.
- **Prettier is held off the one block that is a file rather than prose.** A
  `<!-- prettier-ignore -->` sits above it with the reason written next to it.
  Formatting a block that claims to be a file byte for byte is formatting the
  file's author, and the claim is the one the test now checks.
- **The re-import example lost `next-release.json` and gained the fixture
  again.** "An unchanged database prints one line" is exactly a second run of the
  first command, so that block is now a run and its count is proved rather than
  corrected. The delta block keeps `next-release.json`, because the point of it
  is a database that changed, and inventing a second fixture to make it real
  would be a second thing to keep in step with the first.
- **The walkthrough's prose now carries a claim about the model behind the
  sketch**, which is that it holds more than the two tables above. Nothing checks
  that, and nothing can. It is there so the `event` table in the delta list is
  read as illustration rather than as a contradiction.
- **The other blocks on the page are not covered.** The studio's block prints a
  port the kernel chose, and the opening block showing
  `examples/shop/tables/shipments.md` carries that file's `layout:` line, so
  asserting it would turn dragging a box in the studio into a red build. Both are
  real reasons rather than an appetite for stopping, and both should be argued
  here before either is asserted or excused.
- **`process.chdir` is used, and it is global to the worker.** It is restored in
  an `afterAll` before the sandbox is removed. Vitest runs one file at a time per
  fork, so this is sound, and it is the only thing in this suite that assumes it.
- **A block needing a non-zero exit code has nowhere to say so yet.** The delta
  block exits 1 and is a sketch, so the case has not arrived. When it does, the
  tag should carry the code rather than the assertion quietly stopping checking
  it.
- **It costs about fifty milliseconds** and two imports of the CLI in process.

## Revisit when

- **A block outside the walkthrough goes stale.** That is the evidence that the
  region is drawn too small, and the answer is to widen it rather than to fix the
  block.
- **The studio's port or `examples/shop`'s layout stops being the reason** their
  blocks are excluded. A normalised port, or a block that quotes a file's prose
  rather than its frontmatter, removes the objection.
- **A third page starts carrying output blocks.** Two mechanisms reading fenced
  blocks by their info strings is already one more than ideal, and a third is the
  moment to lift the parser out of both tests rather than to copy it again.
- **Prettier's handling of fenced blocks changes.** The `prettier-ignore` above
  the file block is a workaround for one formatter's opinion, and if the
  formatter stops holding it the comment should go rather than linger.

## The first revisit entry fired the same day, and a fourth tag answers it

Appended rather than edited, because the consequence above naming the opening
block as uncovered was true when it was written and is the argument this section
answers. Everything the three tags decide is unchanged.

**The block that record named as excluded went stale, and it was already stale
when it was named.** `README.md`'s opening block claims to be
`examples/shop/tables/shipments.md`. The committed file has `on delete: restrict`
on `order_id`, from [ADR 0046](0046-a-key-may-say-what-the-engine-does.md), and
the block did not (dbmd-5pj). So the page's first illustration of the format was
missing a key the format has, on the page that opens by saying the picture and
the file are the same thing.

**The instruction on that entry was to widen the region rather than fix the
block, and it is followed with one correction.** Widening the *walkthrough*
region is not the move, because the walkthrough is not a region drawn around
blocks that can be checked. It is drawn around the sentence that promised every
block below was real output, and the rule that every fence inside it carries a
tag follows from that promise rather than from the mechanism. Widening it to the
whole page would demand a tag on every ` ```json `, ` ```bash ` and ` ```diff `
fence on it, most of which are prose.

**What widens instead is the file assertion.** A fourth tag,
`dbmd-head:<path>`, is looked for on the whole page rather than inside the
walkthrough, and the exhaustiveness rule stays where the promise was made.

    ```markdown dbmd-head:examples/shop/tables/shipments.md

**`dbmd-head:` is a committed file in this repository, quoted from the top.**
It differs from `dbmd-file:` in both halves of what a path means. A
`dbmd-file:` path is a file the session above it wrote, read out of the sandbox,
and asserted whole. A `dbmd-head:` path is a file in the repository, read from
the repository root, and asserted for as many lines as the block shows, because
a page quoting a file to make a point about it stops where the point stops. The
opening block was already a prefix, which is the page having half-arrived at
this on its own.

**`layout:` is compared as a key and not as a value, and that exception is the
whole reason this is a second tag rather than `dbmd-file:` with a wider scope.**
The consequence above is right: asserting that line byte for byte would turn
dragging a box in the studio into a red build. That is intolerable twice over.
`examples/shop` exists to be arranged, and ADR 0003 calls `layout:` the line a
reviewer learns to skip, so a test built on it would make the one line nobody
reads the one line that can break a build. The exception is one regular
expression over one key, named in the test, and adding a second key to it needs
the argument this one has: a value a person changes on purpose does not belong
there, because then the page can be wrong about it and nothing says so.

**Everything else in the block is held to the byte, including the prose.** The
frontmatter minus the coordinates is a claim about the model, and the two
paragraphs quoted under it are the half of the format ADR 0003 says is the
point. If somebody edits that body, in the studio or in the file, the build
goes red and the page is updated with it. That is the intended cost and it is
the difference between a coordinate and a sentence.

**The guard has been seen to fail, as ADR 0034 requires**, in the three shapes
that matter. Removing `on delete: restrict` from the block, which is the defect
this section exists for, fails with a diff of the block against the file.
Changing a column's type in `examples/shop/tables/shipments.md` fails the same
way. Moving that table's `layout:` to `{ x: 1240, y: 180 }` passes, which is the
property the exception is for.

**The rule is about any block showing a file, not about this one.** A future
block anywhere on the page that quotes a committed file takes the tag, and
`docs/media/` aside, that is now the whole of the page's exposure to this kind of
rot. The `<!-- prettier-ignore -->` over the block is there for the reason the
walkthrough's is, and the same comment says so.

**One thing on the page was corrected without a tag, because nothing covers its
shape.** The `diff` block under "What a change looks like" is a diff of the same
file and its hunk header said `@@ -28,6 +28,9 @@`, one line out for the same
missing `on delete:` line. It now says `-29`, regenerated rather than counted. A
tag that runs a diff against a file is a bigger mechanism than one block earns,
and this is the note that says the block is uncovered so the next person does not
have to work that out.

**The second revisit entry is unchanged and still stands.** The studio's block
still prints a port the kernel chose and is still excluded, and `examples/shop`'s
layout has not stopped being volatile: it has been contained rather than
removed as an objection.

## The third revisit entry fired, and the parser was copied rather than lifted

Appended rather than edited, as part of a sweep of every record's **Revisit when**
list on 2026-09-07, and appended below the section about the first entry so the
two read in the order they happened. The three tags and the fourth are unchanged.

**"A third page starts carrying output blocks."** Four do, and four test files
read fenced blocks out of them:

| page | what is asserted | reader |
| --- | --- | --- |
| `docs/format.md` | ` ```markdown dbmd: ` and ` dbmd-error: ` blocks | `test/docs/format.test.ts` |
| `docs/import-format.md` | ` ```json dbmd-import: ` blocks | `test/import/docs.test.ts` |
| `README.md` | this record's four tags | `test/docs/readme.test.ts` |
| those three and `docs/ci.md` | every plain ` ```json ` payload on them | `test/docs/payloads.test.ts` |

**The entry says a third is the moment to lift the parser out of both tests
rather than to copy it again, and it was copied again.** ADR 0066 is the record of
the fourth reader and it argues for the mechanism rather than against sharing:
those blocks carry no tag, they are claimed by page and by command, and the
exhaustiveness a tag buys is bought there by counting every plain `json` fence on
the four pages. The question this entry actually raises, whether four readers
should share one block parser, was not asked.

So the entry fired and is only half answered. Lifting a shared parser is still
available, it is a refactor with no decision in it, and it is on the owed backlog
list in `docs/process/handoff.md` rather than being done here, because this sweep
records what happened to conditions and does not change what was decided.

**One thing worth writing down for whoever does it.** The four readers do not read
the same thing. Three match an info string and one matches a bare `json` fence on
a named page, and ADR 0069 added a fifth assertion inside `readme.test.ts` that
reads a narration block against a command's stderr. A lift that assumed one shape
would have to give all five of those back.

**The second and fourth entries are unchanged and still stand**, and the first is
answered in the section above.
