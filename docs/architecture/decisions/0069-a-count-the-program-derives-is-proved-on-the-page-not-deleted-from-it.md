# 0069. A count the program derives is proved on the page, not deleted from it

## Context

`README.md`'s `dbmd query --engine <id>` entry showed this as the command's
output:

    $ dbmd query --engine postgres > introspect.sql
    The PostgreSQL introspection query, 9827 characters, on stdout.

It is 12403. SQL Server is 12900. The page was off by about a quarter, on the
front door, in the block that shows a first-time reader their first command, and
it had been off for long enough that nobody could say when it stopped being true
(dbmd-53w).

Nothing caught it because the fence is bare. [ADR 0056](0056-a-block-in-the-readme-is-a-run-or-a-sketch.md)
defines four tags for this page and `test/docs/readme.test.ts` acts on them; an
untagged fence is none of the four. [ADR 0066](0066-a-json-payload-on-a-page-is-a-run-and-is-compared-as-a-value.md)
added `test/docs/payloads.test.ts` the same day and it reads `--json` payloads on
four pages, which this line is not.

**This project deleted five hand-kept numbers on 2026-09-07** rather than
correcting them: two counts in `AGENTS.md`, a test count and a merged-pull-request
count in the handoff, and a count of red builds. The reason was the same every
time and it is a good one. A number in prose that nobody re-derives is a number
that goes wrong. dbmd-53w recommended the same treatment here.

## Decision

**This number stays on the page and is proved on every build.** It is not the
same kind of number as the five that were deleted, and the difference is where
it is computed.

**The five deleted counts were maintained by hand.** Nothing but a person's
memory stood between the sentence and the truth, so removing the sentence
removed the whole failure.

**This one is derived by the program.** `runQuery` builds it from the SQL it has
just printed, `test/cli/query.test.ts` already holds the narration to that
length, and `--json` carries it as `characters`, which
[`docs/import-format.md`](../../import-format.md) documents as `sql`'s own
length. The number in the program cannot drift. Only the page's transcription of
it could, and it did.

**So taking it off the page would not have been a deletion, it would have been a
doctored quote.** "The commands" opens by promising that every block below it is
output. The command prints the count. A block reading
`The PostgreSQL introspection query, on stdout.`, or one silently missing the
first line of the narration, shows a reader something the command does not
print. That is the defect ADR 0056 exists to end, arriving as the fix for a
smaller one.

**ADR 0056 already says what to do here, in its own revisit list:** *a block
outside the walkthrough goes stale... the answer is to widen it rather than to
fix the block.* Its first revisit fired the same way and was answered by
widening the assertion with a fourth tag rather than by editing the block. This
is that move again, for a narration block instead of a file block.

**The mechanism is a table in `test/docs/readme.test.ts` naming the command over
the block.** The `$` line is written out beside the argument list, the block's
remaining lines are compared to what the run wrote to stderr, and the exit code
and the fact that stdout carried something are asserted with it.

**It is not a fifth tag.** A tag buys exhaustiveness, and exhaustiveness over
this page's remaining fences is exactly what ADR 0056's first revisit declined:
most of them are prose, and demanding a tag on every one would be a rule about
markdown rather than about evidence. Naming the command in the test is what
ADR 0066 does over a plain `json` fence, and it costs the page nothing.

**It covers one block, and the boundary is a property rather than an appetite.**
`dbmd query` takes no directory, opens no file and binds no socket, so it runs
here with no sandbox and no working directory. Every other block on the page
outside the walkthrough needs one of those.

## Consequences

- **Changing an introspection query turns the build red with a diff**, and the
  page is updated with it. That is the intended cost. Unlike `layout:`, which
  ADR 0056 exempts because dragging a box would otherwise break a build, an
  introspection query is changed on purpose by a person who is already editing
  SQL, and a page that quietly stops describing it is the thing being paid to
  avoid.
- **The guard has been seen to fail, as [ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md)
  requires, in both directions.** Putting `9827` back fails with a diff naming
  README.md:238 and showing `9827` against `12403`. Lengthening the comment at
  the top of `src/import/providers/postgres.ts` by eighteen characters fails the
  same way, with `12403` against `12421`, which is the direction that actually
  matters, because it is a person changing the SQL rather than a person
  mistyping the page. The second demonstration is written as a character count
  rather than as "a few more words" on purpose: a reader reproducing it has to
  add exactly as many characters as the number here moves by, and a vague
  instruction beside a precise number is the shape of claim this record exists
  to stop making.
- **The block keeps its redirect and reads as a shell session.** The page shows
  `> introspect.sql` because stdout is the SQL and the four lines under it are
  the narration that went the other way, which is the whole lesson of the entry.
  The redirect is also why the block cannot simply be tagged `dbmd-run`:
  `sessionIn` would hand `>` to `parseArgs` as a directory, and `dbmd query`
  rejects a positional on purpose.
- **README.md's only change is one number.** The owner has uncommitted work near
  the top of this file, and the smallest possible diff two hundred lines below
  it is the neighbourly form of this fix.
- **The other blocks on the page are still unasserted, and were read by hand.**
  On 2026-09-07 the `dbmd init` block, the `dbmd check examples/shop` block and
  the `dbmd check` error block with its `echo $?` were each run and matched what
  the page shows, byte for byte, including the exit code. The `dbmd studio`
  block prints a port the kernel chose and matched in every line but that one.
  That is a sweep, not a guard, and it is recorded here so the next person knows
  when it was last true.
- **A third mechanism now reads fenced blocks on this page.** ADR 0056 said a
  third page carrying output blocks would be the moment to lift the parser out
  of the tests that copy it. This is a third *reader* rather than a third page,
  and it parses nothing: it looks a literal line up in the page and takes the
  fence around it. That is deliberately too small to be worth sharing.

## Revisit when

- **A second command earns an entry in the table.** One row is a table with a
  boundary; three rows with three sandboxes between them is the walkthrough's
  machinery being rebuilt in the wrong file, and at that point the two should
  become one.
- **A block on this page outside the walkthrough goes stale again.** The sweep
  above is the last time the uncovered ones were known to be right, and a second
  failure among them is the argument for a sandbox here that the single-command
  boundary currently refuses.
- **`characters` gets a caller.** `docs/import-format.md` records it as the one
  field in that payload with none. A caller would make the number a contract
  rather than a courtesy, and the page would then be quoting an interface.
- **The narration stops carrying the count.** If `dbmd query` ever stops saying
  how long its query is, this guard should go with it rather than be pointed at
  the sentence that replaced it.
