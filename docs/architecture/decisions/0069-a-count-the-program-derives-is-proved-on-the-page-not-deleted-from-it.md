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

## The first revisit entry is answered by ADR 0076, and the second is answered on a branch

Appended rather than edited, the way `README.md` in this directory asks. The
decision stands: the count is still printed on the page and still proved by
running the command, rather than deleted from the page to stop it drifting.

**"A second command earns an entry in the table" fired, and the answer is ADR
0076.**
[ADR 0076](0076-a-block-a-sweep-found-exact-is-held-by-the-table-that-already-reads-the-page.md)
landed in #202 and says so in its own words at its line 85: "This answers ADR
0069's first revisit entry, and does not do what that entry says." This record
named it nowhere, which is why the entry has read as open work since #202 while
the work sat in the tree. The short version of what 0076 decided, for a reader
who does not need the argument: there are three rows and **one** sandbox rather
than the three this entry predicted, so the two mechanisms did not have to become
one. The reasoning is at 0076.

**"A block on this page outside the walkthrough goes stale again" fired, and the
answer is on a branch rather than on `main`.** This is the precise state as of
2026-09-08 and the distinction matters, because a note here saying the block is
fixed would be false until the branch lands.

- The block is the `dbmd refs addresses shop` sketch on `README.md`, around line
  471. It prints `shop has 2 errors in it. A file that did not load is missing
  from the model along with every ref written in it, so what follows may be
  short.`
- That is the wrong half of a choice the command stopped making that way in #223.
  `errorBanner` in `src/cli/refs.ts` now has three states, and the sketch's model
  is in the third: both of its errors are dangling refs, every file loaded, so
  the command prints `and every file in it loaded. Nothing is missing from what
  follows: the model disagrees with itself rather than failing to read.` The page
  shows a reader the opposite sentence to the one they will get.
- **Pull request #241, `docs/the-one-readme-block-that-went-stale`, is open and
  changes exactly those two lines and nothing else.** It is held on the owner's
  word rather than on anything mechanical.

So the entry has fired twice over: once because a block outside the walkthrough
did go stale, and once because the failure was found by a person reading the page
rather than by the gate. That second half is the argument this entry said a
second failure would be, and it is now available to whoever picks it up. Nothing
is claimed here about what should be built; the entry asked for the argument and
the argument now exists.

**The other two entries have not fired.** `characters` still has no caller:
`src/cli/query.ts` is the only place that writes it, at its line 164, and nothing
in `src/` reads it back. And the narration still carries the count, at
`src/cli/query.ts:157`, so the guard is still pointed at a sentence that exists.
