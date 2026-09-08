# Verified

What has actually been checked against reality, and how, so nobody spends an
afternoon finding it out again. Split off from `handoff.md` on 2026-09-07, when
four fifths of that file had become evidence and one fifth was where the work
stopped. Those are different documents with different readers and different
half-lives, which is the test.

**Two kinds of entry, and the difference matters.** The first half is what was
driven: somebody ran the thing, in a browser or against a real database, and
pasted what came back. The second half is what was audited by breaking it:
a guard neutered, a rule reverted, a fixture mutated, to find out whether the
check that is supposed to catch it does.

**An entry decays.** It says what was true on the day, against the code of that
day. Where it disagrees with the repository, the repository is right. When a
change makes an entry false, correct it rather than deleting it, and say what
moved: an entry that quietly vanishes takes the reason for the test with it.

## What has been driven, not just tested

The owner asked whether the studio was validated by actually interacting with
it. It was, on a copy of `examples/shop`, through a real browser, on
2026-09-07. Every one of these wrote the file named and left every other file
in the model byte-identical to where it started:

| Action | What it wrote |
| --- | --- |
| Drag a table | that table's `layout` line, and nothing else |
| Add table | a new file at the exact placement coordinates |
| Add column | one appended column, nameless, on the table's own file |
| Remove column | the column gone from that file |
| Delete this table | the file gone, behind a confirmation step |
| Drag a note | that note’s own file, including its `w` and `h` |
| Drag a group header | every member’s layout line, in one write, and nothing in the group file |

### The whole thing again on the day's twelfth merge, 2026-09-07

A regression pass after twelve merges, on `git archive HEAD examples/shop`,
which is what a stranger clones.

- `dbmd check`: 8 tables, 2 notes, 1 group, no problems.
- `dbmd refs orders`: both referrers with their marks and their `on delete`.
- The studio: **10 boxes, 13 edge paths, 0 clipped cells, 0 overlapping pairs**,
  and the group label reads `Written by the depot handheld` in full. The two
  visual defects found this afternoon are both gone from the shipped picture.
- A drag wrote **one file and one line**, `layout:` on the table dragged, and the
  model still validates.
- `dbmd export`, and the diagram it wrote **parses under mermaid**, which is a
  thing that could not be checked at all before this afternoon.

Nothing regressed. Recorded because twelve merges in a day is exactly when
something does, and the cheapest time to find out is before somebody else does.

### The whole journey against a live database, driven on 2026-09-07

Re-run after re-import landed, and this time following the **printed recipe**
rather than running the tool a way that happens to work. That distinction is the
one this project has already paid for: both engines' printed invocations were
wrong once and were found by following them.

PostgreSQL 16 in a container, three tables, a unique constraint, a referential
action, a descending index and an expression index. Then:

1. `dbmd query --engine postgres` on stdout, its narration on stderr.
2. The query header's own command, `psql -X -t -A -d db -f query.sql -o out.json`,
   run verbatim. It produced **exactly what the header promises**: one line,
   first character `{`, last `}`, no header, no padding, no row count.
3. `dbmd import` read it first try. `dbmd check` clean.
4. The expression index came through as `columns: [{ expression: lower(email) }]`
   and the unique constraint as `unique: true`, both from a real catalogue rather
   than a fixture.
5. Two paragraphs written into a table by hand, and its `layout:` moved.
6. **The real database altered**: a column dropped, a type widened, a column
   added, a table dropped with cascade.
7. Re-imported. The delta listed all four kinds against a live catalogue, wrote
   nothing, and named the prose that would go stale.
8. `--confirm` touched three files and no others. The two paragraphs and the
   coordinates came through untouched, and the model still validates.

**The prose scan is cleverer than it looks, and I nearly filed a false finding
against it.** A bare column name in backticks is only reported inside that
table's own file, because `qty` in another table's prose could mean anything.
The **qualified** spelling, `order_items.qty`, is reported wherever it appears in
the model. Both halves confirmed by putting each spelling in each place.

**One thing ADR 0046 predicted showed up for real.** A row of `dbmd refs` on an
imported model reads `key  required  on delete: cascade  on update: no action`,
four marks, two of which say nothing happened. With one referrer it reads fine.
The record already says where that cost gets paid if it stops reading fine: an
import option, not a rule about which facts are worth writing.

### And the same against SQL Server 2022, driven on 2026-09-07

The riskier of the two recipes, because it is the one that was outright broken
once: `sqlcmd` appended `(1 rows affected)` and the JSON was the first 2315 of
2333 bytes, so the import failed with a message saying the file was probably
truncated. It was too long.

Followed verbatim this time, `SET NOCOUNT ON;` in its own file and all:

```
sqlcmd -S server -d shop -y 0 -Y 0 -i nocount.sql -i query.sql -o model.json
```

One line out, `{` to `}`, no row count, imported first try, `dbmd check` clean.

Three things came through that a fixture would not have exercised:

- **A table literally called `Ledger [Entry]`**, created as `[Ledger [Entry]]]`.
  It writes to a real file on Windows, reads back, and the diagram quotes it as
  `"Ledger [Entry]"`. Brackets are legal in a Windows filename, so no refusal was
  needed, and none happened.
- **The engine's own type spellings**, `nvarchar(max)`, `datetime2(7)`,
  `uniqueidentifier`, and a default of `((0))` with SQL Server's own doubled
  parentheses, kept verbatim rather than normalised.
- **`on delete: no action` and `on update: no action`** written on a foreign key
  whose DDL said `on delete no action` and nothing about updates, which is the
  wall ADR 0046 predicted, seen for real.

### A file another program holds open, driven on 2026-09-07

The Windows case nobody had tried, and the one that found something. An
exclusive lock taken with `FileShare.None`, which is what an editor, OneDrive, a
backup agent or antivirus does routinely.

**The command line handles it exactly right.** `dbmd check` reports
`cannot read the file: the file is in use (EBUSY)` against that file, plus the
knock-on `ref-table-unknown` from the tables that pointed at it, and exits 1.
`dbmd export` refuses with an empty stdout, its narration on stderr, and exits 1.

**The studio refuses to write, which is also right, and then says the wrong
reason.** It answers the edit 200, writes nothing, and reports a conflict saying
the file "changed on disk after the studio read it". It did not change: I diffed
it afterwards and it was byte-identical throughout. Its advice, "make the edit
again", loops until the lock clears. That is **dbmd-e6e**, and it is worth
knowing that the studio has the true answer in its own diagnostics panel at the
same moment, two inches away.

Nothing is lost and nothing sticks: once the lock goes, the next edit writes.
And the page keeps all eight tables on the canvas while it happens, so a locked
file does not make a box disappear. I checked that specifically, having first
misread my own probe and nearly recorded the opposite.

### A prose body a naive writer would eat, driven on 2026-09-07

The format's central promise is that a body is carried byte for byte. Tested
with content chosen to break it: a line that is exactly three hyphens, which is
what closes frontmatter; a trailing space; a tab; `café`, `日本語` and an emoji;
a line reading `A line that looks like a key: kind: table`; and three blank
lines before the end.

`dbmd check` reads it clean. A studio edit then rewrote that file, and the diff
across the whole file is **one line**, the `layout:` it was asked to change.
Everything in the body survived, the bare `---` included.

### The note and group lifecycle, re-driven on 2026-09-07 after today's changes

Creating a note through the canvas writes a file with frontmatter and no body,
the prose box asks for the body with a sentence written for a note rather than a
generic one, and typing lands in the file. Moving a note rewrites its own file
and no other, with the rest of the model byte-identical.

**Deleting a group says exactly what it will leave behind.** The confirmation:

> 2 tables still declare `group: warehouse` and are not edited:
> tables/shipments.md, tables/stock_movements.md. dbmd will report each one as
> `group-unknown` until you change or remove that line.

It names the files and the diagnostic code a reader will meet. That is the
answer to a real question, because membership is declared by the member and the
group file never lists them, so a delete cannot tidy up on the member's behalf
without editing files the developer did not open.

**A `DELETE` straight at the API does it without that sentence**, and the model
is then invalid with two `group-unknown` errors. That is the confirmation being
in the page rather than in the server, which is where the studio puts every
other confirmation, and it is worth knowing before somebody scripts against the
API and is surprised.

**Two things about a note's bytes that look wrong and are not.** A note created
and typed in one go ends without a trailing newline, because the prose box is
carried byte for byte and never reflowed, and a writer that appended one would
be reflowing. It is stable: two more rewrites left the body untouched, and
`dbmd check` is clean. An existing note keeps its own trailing newline through a
rewrite.

### The index editor and the expression trap, driven on 2026-09-07

Added an index through the panel, typed `lower(email)` into its keys field, and
walked the whole path a person walks.

- The file gets `columns: [lower(email)]`, and both `dbmd check` and the studio's
  own footer say the index names a column the table does not have, and teach the
  spelling: `{ expression: lower(email) }`.
- **Typing that spelling into the field writes `["{ expression: lower(email) }"]`,
  a column with those characters in its name.** That is the trap ADR 0047
  describes, and the loop it used to create has an exit now: the diagnostic no
  longer offers to wrap it a second time, and says instead that the spelling is
  right but quoted, so remove the quotes.
- **The exit that matters is in the row, not the footer.** The editable index row
  itself says, as it is typed: *"that is how the file spells an expression key,
  but this field writes column names, so it has been written as a column called
  that; an expression key is a mapping this one-line field cannot make, so write
  that one in the file."* That sentence is attached to the field being edited,
  which is the only place it is actionable. The footer's "remove the quotes" is
  true and is not something a person can do inside the page.

ADR 0047's decision is implemented as written: the studio carries an expression
key it cannot author, and says so where it is being asked to author one.

### The CI contract and a re-import under an open page, driven on 2026-09-07

**`--strict` is what a team puts in a pipeline, so it was checked rather than
assumed.** On a model whose only problem is one column with no type:

| Command | Exit | `ok` |
| --- | --- | --- |
| `dbmd check` | 0 | true |
| `dbmd check --strict` | 1 | false |
| `dbmd check --strict --json` | 1 | false |

Under `--json` stderr is empty, the report is on stdout, and the envelope
carries `strict` so a consumer can tell which rule produced the answer rather
than inferring it from the exit code.

**A re-import under an open studio page behaves.** Imported a model, opened a
page on it, then re-imported a changed database with `--confirm` while the page
was up. The page picked the change up on its own: its revision moved, the
dropped column was gone from what it holds and the widened type was there. The
next edit from the page then landed normally with no conflict, so the import is
just another writer as far as the watcher is concerned and leaves nothing stuck.

### A branch switch under an open page, driven on 2026-09-07

The bulk file change people actually make. Two branches differing in **every**
table file, in both the frontmatter and the prose, with a studio page open on
the working tree.

`git checkout` of the other branch: the page converged in **one revision**, not
eight. All eight tables present, every new coordinate, every added paragraph.
Switching back moved it to revision 2 and the branch-one content was there. An
edit from the page then landed with no conflict.

So the watcher coalesces a burst rather than storming, and a checkout leaves
nothing stuck. The only diagnostic afterwards was `unknown-kind-directory` for
the `.git/` I had put inside the model directory to run the test, which is the
reader being right about a thing I did.

### A hundred and twenty tables, driven on 2026-09-07

Nobody had ever asked what a large model feels like, and the answer is: fine.
Generated 120 tables, 13 columns each, chained by a `ref:` with
`on delete: cascade` so there are 119 edges.

| What | How long |
| --- | --- |
| `dbmd check` | 0.36s |
| `dbmd export`, writing a 36 kB diagram | 0.36s |
| `dbmd refs` | 0.37s |
| `GET /api/model`, 287 kB of JSON | 0.012s |
| The page, opened in a real browser | 1.9s |

The page drew all 120 boxes and all 120 edges with **no console error**, and a
drag wrote **exactly one file**, one `layout:` line, with the other 119 tables
byte-identical. So the `only` set holds at scale rather than only on eight
tables.

Nothing to fix, and it is recorded so nobody spends an afternoon finding that
out again. The one thing not measured is whether GitHub renders a diagram that
size, which is a question about their limit rather than about this tool.

### The greenfield journey, driven on 2026-09-07

The user who has no database yet. `dbmd init` into an empty directory, then a
table built entirely through the canvas: **Add table** armed, a click placing it,
a name, two columns, a `ref:` typed as `accounts.id`, and `on delete: cascade`
chosen from the dropdown that appears once the ref is there. Then `dbmd check`
clean, `dbmd refs accounts` showing the cascade beside the other referrer, and
`dbmd export` drawing the new edge.

Every step wrote what it said and nothing else. Two things worth knowing:

- **The empty `type` a created column starts with is a warning**, and the studio
  shows that same diagnostic in its own panel straight away, so the page and the
  command line agree without anybody switching windows.
- **A studio-created table has no body at all**, where an imported one carries a
  line saying nobody has documented it yet. That is dbmd-6yo, and it is a
  decision to write down rather than a bug: in the studio you are already looking
  at the inspector and can type, so a prompt line might be noise.

### Spaces and accents, driven on 2026-09-07, and nothing is wrong

Recorded because it is a plausible Windows failure a successor would otherwise
spend an hour ruling out. A model at `My Models/café shop` works everywhere:
`check`, `refs`, `export` and the studio all read and write it, and the studio
renamed `customers` to `clientèle`, wrote `tables/clientèle.md`, edited the
three referring files and left the model clean. The accented name comes through
the mermaid diagram quoted, and `refs` prints it with the referential actions
intact.

One thing that looks like a bug and is not. Launching the studio through
PowerShell's `Start-Process` with an `ArgumentList` splits a path on its spaces,
so `dbmd` answers `takes at most one directory, and got 3`, and reading its
redirected stderr in the default encoding renders `café` as mojibake. Both are
artifacts of that launcher. Quote the path, or start it from bash.

### Two people editing at once, driven on 2026-09-07

A studio page open on a model, and a file edited by hand on disk underneath it.
Every part of this behaved:

- **A hand edit to a file the page was not writing survived untouched.** The
  studio wrote the one table it was asked to and left the other seven files
  byte-identical, the hand-typed paragraph included.
- **A hand edit to the file the page then tried to write won.** The server
  refused with 409, nothing was written, the paragraph stayed, and the page
  re-read and reverted its own field to what the disk said. The next edit landed
  normally.

**The status bar says so**, which I nearly filed as missing because I searched
the page for the wrong words and looked after a later edit had already replaced
the message. Its wording is the one thing wrong here and it is dbmd-c5g: it
tells a person to read the model API, in a URL, then gives the same advice
again in English. The behaviour underneath it is right and is not to be touched.

### The rename, driven end to end on 2026-09-07, after the fix

`orders` renamed to `purchase_orders` in a real browser, on a copy of
`examples/shop`, with two refs pointing at it: `order_items.order_id` carrying
`on delete: cascade` and `shipments.order_id` carrying `on delete: restrict`.

**Both actions survived the rename**, which is the data-loss bug dbmd-45 found
and fixed in `withRefsRetargeted`. Until then that path rebuilt the ref from its
two halves and would have dropped the cascade from every referring file, and
nothing would have said so: the model validates clean either way and only a
delete against a real database would have shown it. A unit test held it; this is
the first time it was proved through the product.

The rename touched **exactly four files**: one edited line in each of
`order_items.md` and `shipments.md`, `orders.md` deleted, `purchase_orders.md`
written. Every other file in the model was byte-identical afterwards, including
`_model.md`, both notes and the group, so the `only` set that `writeModel` takes
is doing its job. The `layout:` line came through the rename untouched.

The confirmation panel said what it was about to do before doing it, and named
the prose it was leaving behind: **"6 mentions of `orders` in backticks stay as
they are"**, listing the four files. That is the narrow prose scan that shipped
for rename, seen working rather than asserted.

**Edges leave and arrive at the rows of the two columns, and stay on those rows
when a box moves.** That was the owner's first complaint and it is the half that
is hard.

**`Add table` is a two-step mode, and a reviewer who does not know that will
report it broken.** The button arms placement, the next click on the canvas is a
coordinate, and a small form then asks for a name. A single click on the button
looks like nothing happening, and the only visible signal is the button's
pressed state and a crosshair cursor.

**Notes and groups draw**, as of dbmd-34 landing on 2026-09-07, so the three
documents that promised them are true again.

**A note can sit on top of a group’s header**, because notes render in front and
groups behind. The next person to try dragging a group will find it does not
move and will file a defect. It is the note. Move it and the drag works.

### What `dbmd import` does with nothing to read, driven on 2026-09-07

dbmd-i2u reported that `dbmd import` with no arguments prints nothing and never
returns. Driven three ways against `dist/cli.js` built from the branch, because
the three are different file descriptors and only one of them was ever measured.

| standard input | exit | what it said |
| --- | --- | --- |
| `< /dev/null` | 1 | `there was nothing in standard input`, and the recipe to run |
| a terminal | 2 | `standard input is a terminal, so there is nothing there to read` |
| a pipe nobody writes to | none | nothing, killed after eight seconds |

**The terminal case has been answered since 05:08 that day**, by dbmd-f3p, and
the report predates or misses it. The terminal was reached by defining
`process.stdin.isTTY` on the real process and calling `main`, because no test
runner and no agent harness has a terminal to lend.

**The third row is the one a probe measures**, and it is not a defect. A process
spawned with Node's default `stdio` holds file descriptor 0 open and writes
nothing to it, which is the same value as a pipe about to be written to slowly.
ADR 0063 is why it stays, and `dbmd import --help` now says so where the caller
who did it is looking.

**Nothing outside a fake seam demonstrated any of this until now.** Every test
of the refusal replaced `processStdin`, and the tarball smoke drove
`import --help` and nothing else, which is exactly how a fixed behaviour gets
re-reported as live. The smoke now drives `dbmd import` with the pipe closed.

**One measurement to save the next person the same hour.** The third row is not
the same on every path into the binary. `node dist/cli.js import` with Node's
default `stdio` waits, and so does the same line through `cmd /c`. The npm
`.bin\dbmd.cmd` shim on Windows does **not**: an unwritten pipe reads there as
end of input, and the command answers immediately with the first row's sentence.
Closing the pipe is what makes the smoke's case mean the same thing everywhere:
left open, it would pass on Windows for a reason that has nothing to do with the
command. That was found by leaving it open on purpose and watching the case pass
when it should not have.

## Audited on 2026-09-07, so a successor need not redo it

All clean unless a line says otherwise. Each was checked by breaking something
rather than by reading.

- **The whole check, run locally on `main` at the end of 2026-09-07**, after
  forty-odd merges in one day. This is the command `release.yml` runs through
  `prepublishOnly`, so it is the nearest thing to a rehearsal of the publish that
  does not touch the registry.

   what                                  | result
  ---------------------------------------|--------------------------------------
   exit code                             | 0
   test files                            | 43
   tests                                 | 1,093 passed, 1 skipped
   tarball                               | 77 files, 241.3 kB packed, 811.7 kB unpacked
   commands driven from the installed binary | 16
   pack guard rounds that refused        | both

  **The installed binary is driven through sixteen commands**, which is the line
  worth reading rather than the count: `--version`, `--help`, every command's own
  `--help`, then `init`, `check`, `check --strict`, `export --stdout`,
  `refs accounts`, `query --engine postgres`, and `import` with nothing on
  standard input. Six of the seven commands are exercised for real; `import` is
  the seventh and its refusal is what is checked, because a real import needs
  JSON only a live database produces.

  **Both guard rounds refuse.** One mutates `files` so the studio bundle is not
  in the tarball; the other puts the development overlay back on the release
  entry point. A tarball that is still 77 files under the second mutation is why
  that guard reads bytes rather than counting files.


- **The studio's HTTP surface, attacked on 2026-09-07 rather than read.** A
  studio on a copy of `examples/shop`, and every case below was sent by hand.
  **Nothing was found**, which is worth recording precisely because the next
  person to wonder should not have to redo it.

  **Malformed requests, six shapes, all refused with a code and a sentence:** a
  table that does not exist (404 `unknown-table`), a mutation with no revision
  header, a revision of `banana`, a body that is not JSON, a table name
  containing a slash, and a name that walks up out of the model directory. None
  leaked a path and none returned a 500.

  **Hostile table names, ten of them.** The Windows device names `CON`, `PRN`,
  `NUL`, `AUX` and `COM1` are all refused, and so is `orders:stream`, which is
  the alternate-data-stream colon this project has been bitten by before.
  `orders ` with a trailing space is refused, because Windows strips it; `
  orders` with a leading one is a legal file name and correctly falls through to
  `unknown-table` instead. `...` is refused.

  **YAML injection through a write, three attempts, none successful.** A column
  name containing a newline, a type containing `\n- injected`, and an empty name
  were all accepted with 200 and all **quoted and escaped on disk**:
  `type: "uuid\n- injected"` is what the file holds. The model still parses
  afterwards, and `dbmd check` reports the semantic damage the writes did rather
  than a parse error. A non-numeric and an infinite `layout.x` are both refused
  at the door with `layout.x must be a finite number`.

  **The two ways a column can have no name are both caught, and they say
  different things.** `name: ""` gives "`name` is empty, so this column has no
  name", and `name: "  "` gives "`name` is only whitespace, so this column has no
  name". A column named two spaces is worse than one named nothing, because it
  looks named, and the validator does not lump them together.

  **What this says about the design.** The studio is an editor and `check` is the
  gate, so a 200 on a hostile value is correct as long as the bytes on disk stay
  parseable and the validator says what is wrong. That held in every case.


- **The two flaky watcher cases, diagnosed by reproduction rather than by
  reading, and neither fixed by waiting longer.** The burst case was the test's
  own assumption: `ModelWatcher` promises one wake-up per burst, where a burst
  is events no further apart than the window, so two changes further apart are
  two bursts and are owed a wake-up each. `expected 2 to be 1` was the right
  answer to a question the case did not mean to ask. The debounce is now a
  `Burst` class a test drives directly, because a burst driven by `fs.watch` is
  not a burst the test made, it is one the test hoped for.

  The checkout case was waiting on the wrong event. `writeFile` truncates before
  it writes, so a wake-up landing inside a `git checkout` reads an empty file;
  the studio carries the last good version forward as `complete: false`, and
  that still moves the revision, so a wait on `revision > written.revision` was
  satisfied on the way to the checkout. The patch then hit an incomplete object,
  was refused 409, and the flush wrote nothing.

  **Verified independently**: the old wait put back into the new deterministic
  case fails with `expected 409 to be 200`, and the file as delivered passes 38
  of 38. #144.

- **The timeouts under contention were never that race, and the measurement says
  so.** Under five concurrent copies of the suite, `runs to the end when nothing
  changes underneath it` failed 35 times in 48 while the burst case failed 0 in
  48. The first contains no wait, no watcher poll and no sleep, so it cannot lose
  a race. Opposite signatures, and one of them is a machine running out of
  capacity.

- **Both `until` helpers used a 5000ms deadline against vitest's 5000ms
  default**, and vitest's clock starts first, so no wait in either studio test
  file had ever been able to name what it was waiting for: the framework gave up
  a moment before the helper would have said which wait it was. Every timeout in
  the CI record for those files was less informative than it needed to be. Now
  4000ms, documented as a diagnosis fix rather than a timing one.

- **The publish path, driven as far as it can be driven without pushing a tag.**
  Pushing one is the step `release.yml`'s own header says no agent here may
  take, so everything below stops short of it deliberately.

  **The registry name is free.** `dbmd` returns 404, and so do `db-md`, `db_md`,
  `dbMd` and `dbmd.js`, so npm's too-similar rule has nothing to catch on.

  **The tarball holds what it should and nothing else.** From
  `npm pack --dry-run --json --ignore-scripts`: 77 files, 230 kB packed, 773 kB
  unpacked. Everything is under `dist/` except `LICENSE`, `README.md` and
  `package.json`, which npm forces in. No TypeScript sources, no test files, no
  `.map` files, and the studio client bundle is present at 132 kB with its page
  at 26 kB, which is the thing `check-pack-guard.mjs` exists to notice the
  absence of.

  **The version comparison step, driven under `bash -e`** against five tag
  shapes, which is the shell GitHub Actions uses for `run:`:

   `GITHUB_REF_NAME`  | outcome
  --------------------|-------------------------------------------
   `v0.1.0`           | passes, which is the tag the owner will push
   `v0.2.0`           | refused, naming both numbers
   `v0.1.0-rc.1`      | refused, naming both numbers
   `0.1.0`            | passes, and is unreachable: the workflow triggers on `v*`
   `refs/tags/v0.1.0` | refused, and is unreachable: `GITHUB_REF_NAME` is the short name

  The two unreachable rows are why it was worth driving rather than reading. The
  workflow uses `GITHUB_REF_NAME` and not `GITHUB_REF`, which is the correct one
  of the pair, and the last row is what it would look like if that were ever
  changed by mistake.

  **The ancestry step, driven the same way**, in three repository states: on
  `main` it passes, off `main` it refuses naming the tag, and with
  `refs/remotes/origin/main` deleted it refuses naming the checkout. That third
  message is new in #147; before it, the same state told somebody with a correct
  tag to go and tag one on `main`.

  **What is still unobserved, and cannot be observed from here.** Whether
  `actions/checkout@v7` with `fetch-depth: 0` populates
  `refs/remotes/origin/main` on a tag push. It is the only thing in the whole of
  CI that reads a remote-tracking ref, and no tag has ever been pushed. The
  failure is safe either way, because a missing ref exits 128 rather than 0 and
  nothing is published.

- **Every red run on `main`, in all three workflows, with the listing limit set
  above the run count.** Do it that way or the answer is a window: I first read
  `--limit 100` against a branch with 140 runs and reported four failures when
  there were seven.

   workflow          | runs on `main` | failed
  -------------------|---------------|--------
   `check.yml`       | 140           | 7
   `model.yml`       | 107           | 0
   `provenance.yml`  | 140           | 1

  **`model.yml` has never gone red on `main`.** Not once in 107 runs.

  **`provenance.yml`'s single failure is the repository's own birth** and needs
  no further investigation. Run `32798428416`, 2026-08-25T01:40Z, at
  `30726ead`. Its log shows `PROVENANCE_BEFORE: 0000000000000000`, which is
  GitHub's way of saying this was the first push to the branch, so all six
  commits in it arrived without a pull request because there was no repository
  to open one against. `BASELINE` in `check-main-provenance.mjs` is set to
  `30726ead`, the last of those, so everything after the bootstrap is judged
  and nothing was excused after the fact. The script's own warning, "do not
  silence this by moving the baseline forward", has been obeyed.

  **`check.yml`'s seven split four to three.** Four are the flush race that
  `60f0279` (#44) fixed, all of them before it landed. Three are live and all
  three are in `test/studio/watch.test.ts`. `dbmd-056`.

- **The studio's four defences, probed rather than read, on 2026-09-07.** Each
  was attacked from outside the page and each refused:
  - **Bound to loopback only.** The socket says `127.0.0.1:7314`, not `0.0.0.0`.
  - **A spoofed `Host` gets 403**, with a code and a sentence naming the host it
    was asked for. A browser reaching a developer's machine through a DNS name
    it controls is the attack this closes.
  - **Anything but `application/json` gets 415**, including the content types a
    cross-site HTML form is allowed to send without a preflight. That is the
    layer doing the real work, because the form post is the request no browser
    will stop.
  - **No CORS headers on any response**, and a preflight `OPTIONS` gets 405 with
    none either, so a cross-origin write cannot be negotiated.
  - **No path traversal**, over five encodings, and **the model directory is not
    served at all**: a `.env` dropped beside `_model.md` is a 404, as is
    `_model.md` itself. The page gets the model from `/api/model` as JSON and
    the server hands out nothing else.

- **`--json` is consistent across all seven commands**, audited on 2026-09-07 by
  running each one. Every one accepts it, every one answers with a `schema` and
  an `ok`, and every one exits 1 on a directory that is not there rather than
  reporting a failure through the envelope alone. `dbmd studio --json` reports a
  startup refusal that way and otherwise starts the server, which is the only
  sensible reading for a command that does not end. **Two of the seven do not
  mention the flag in `--help`**, `import` and `export`, which is a smaller thing
  than it looked and is why there is no item: `docs/ci.md`, `docs/format.md`,
  `docs/import-format.md` and the skill all document it, and `--help` is not
  where this project has promised to be exhaustive.
- **The studio's API answers its error paths precisely**, probed on 2026-09-07
  with a request each. Malformed JSON is `bad-request` naming the position; an
  unknown key is `bad-request` listing the keys a patch does take; deleting a
  table that is not there is `unknown-table`; creating one that is gives
  `table-exists`; a five megabyte body is `413 too-large`. **A name the writer
  refuses is `unsafe-name` rather than a `201 Created` that writes nothing**,
  which is the bug that shipped once and is the reason this was worth probing
  rather than assuming.
- **The suite was mutation-tested on 2026-09-07, on seven load-bearing
  properties, and caught all seven.** This repository has three recorded
  instances of a test that stopped testing, so the question is a live one here
  rather than a formality. Each mutation was a one-line change to make the
  behaviour wrong in a way that still compiles, run against the whole suite, then
  reverted:

  | What was broken | Tests that failed |
  | --- | --- |
  | `writeModel` ignores its `only` set and writes every file | 8, across 3 files |
  | `isFileName` stops refusing a name a file cannot hold | 16 |
  | The frontmatter writer pads the body instead of concatenating | 10 |
  | `dbmd import` treats every delta as confirmed | 5 |
  | `--strict` stops promoting a warning | 3 |
  | `ref-column-unknown` stops being raised | 3 |
  | The diagram stops marking a primary key | 2 |

  The `only` set and the file-name refusal are the two that matter most, because
  the first is what stops a whole-model write clobbering a file nobody edited and
  the second is what stopped the studio answering `201 Created` for a table it
  never wrote. Both are covered several times over.

  **The two newest behaviours were deliberately included.** The delta's confirm
  gate landed the same day, and thin coverage on a day-old feature is the normal
  place for this to go wrong. It did not.
- **The delta module was mutation-tested separately**, on the same day it landed,
  because it is 678 lines old and it deletes files. Four one-line breaks, all
  caught:

  | What was broken | Tests that failed |
  | --- | --- |
  | Every table is rewritten, changed or not | 7 |
  | A vanished table is listed and its file never deleted | 3 |
  | A changed type is never noticed | 5 |
  | A changed `ref:` is never noticed | **1** |

  **The last row is the thin one.** A single test stands behind the ref
  comparison, where the others have three to seven. It is caught, so this is not
  a gap and there is no item for it; it is recorded because a single test is the
  one that can be rewritten without anybody noticing what it was for, and this
  repository has three recorded cases of exactly that.
- **Every relative markdown link in the repository resolves**, checked on
  2026-09-07: 122 tracked markdown files, 82 relative links, **zero broken**.
  Checked because `scripts/check-commands.mjs` covers several kinds of reference,
  each a claim that a thing exists, and a link is one more of the same shape. The
  count is left out on purpose: it was three when this was written and a bare
  path into `scripts/` became a fourth later the same day, so a number here is a
  number that goes stale in the file whose subject is things going stale. ADR
  0036 carries the current list. **No check was added and
  that is deliberate.** A gate that has never caught anything is a maintenance
  cost pretending to be safety, and this one would not even have caught the thing
  that prompted the look: ADR 0028's stale reference was to a *section heading in
  prose*, which no link checker reads. Recorded so the next person who has the
  idea can see it was had, measured and declined, rather than having it again.
- **The release path was checked short of publishing, on 2026-09-07.** It has
  never run, and a workflow that has never executed is a guess, so as much of it
  as can be exercised without uploading to a public registry was:
  - **GitHub accepts it.** `release` is registered and `active` alongside
    `check`, `model` and `provenance`, so the file parses and the `tags: ['v*']`
    trigger is understood. That is the class of failure a first release finds
    out about at the worst moment.
  - **The version gate behaves.** `v0.1.0` passes against `package.json`'s
    `0.1.0`; `v0.2.0` is refused, naming both numbers. A bare `0.1.0` would pass
    the gate and can never reach it, because the workflow only triggers on `v*`.
  - **No `NPM_TOKEN` secret exists yet**, so a tag pushed today would reach the
    publish step and fail there unauthenticated. That is the owner's step and it
    is the first of the two.
  - **Nothing is on the registry**: `https://registry.npmjs.org/dbmd` answers
    404, and no tag has ever been pushed to the repository.
  - **Not checked, and fail-safe if wrong**: whether `origin/main` exists in a
    tag checkout for the ancestry gate. `actions/checkout` with `fetch-depth: 0`
    creates `refs/remotes/origin/*`, and the workflow's own comment says that is
    why the depth is there. If it were wrong, `git merge-base --is-ancestor`
    errors, the step fails and nothing is published, which is the right way round.
- **The import layer was mutation-tested too**, on 2026-09-07, because it is the
  seam between somebody's real database and their files and a wrong answer there
  is written down rather than displayed. Three one-line breaks, all caught:

  | What was broken | Tests that failed |
  | --- | --- |
  | The SQL Server import never marks an index unique | 93 |
  | An import writes the normalised vocabulary instead of the engine's spelling | 7 |
  | The Postgres import never writes an `on delete` | 4 |

  The first number is large because a unique index is load bearing in three
  places at once: the `UK` mark in the diagram, the relationship operator, and
  what `dbmd refs` says. That is coverage rather than fragility.

  **One thing this settled that had been left open.** Reading `typeText` while
  mutating it explains the `numeric(2)` I produced this afternoon from a
  hand-made fixture with a scale and no precision: that is the
  fractional-seconds path, which both engines write as one number, and a real
  catalogue cannot report a numeric scale without a precision. The case was
  correctly declined as unreachable, and now there is a reason on the record
  rather than a judgement.
- **A re-run erases the evidence that a check ever failed**, which makes a flake
  unmeasurable from run history. `test/studio/watch.test.ts` failed the merge
  gate twice on 2026-09-07, on two unrelated branches an hour apart, with the
  same assertion word for word and neither branch anywhere near the watcher.
  **Only one of the two is in the run listing.** `gh run rerun --failed` updates
  the run in place, so the conclusion became `success` and the failure went with
  it. The listing says one failure in sixty runs; the truth is at least two, and
  the gap is the size of everybody's habit of pressing re-run.
  So: **before re-running a red check, read the log and write down what it
  said**, because after the re-run nobody can. dbmd-056.
- **The same test passes eight times out of eight on a quiet machine.** It needs
  contention, which is why CI sees it and a laptop does not, and why a fix
  claimed without a before-rate under load is a guess. Measured at 64% memory
  with nothing dispatched.
- **Every enforcement guard fails when neutered.** Now a suite rather than an
  afternoon: `test/guards/broken-on-purpose.test.ts` and ADR 0034.
- **Every diagnostic code is emitted and exercised.** The last two exceptions,
  `file-unreadable` and `import/empty-value`, were closed on 2026-09-07 by
  dbmd-f3p, dbmd-ft5 and dbmd-lof.
- **Every `npm run`, every `scripts/*.mjs` and every `dbmd` subcommand named in
  markdown exists.** The only unreal one is a future `dbmd fmt`.
  <!-- hypothetical: dbmd fmt -->
  This one is no longer a sweep: `scripts/check-commands.mjs` repeats it on every
  run, and ADR 0036 says how it tells a real reference from a hypothetical one.
- **Every relative link and every anchor in 101 markdown files resolves.**
- **The studio's five security properties hold**, checked with raw sockets
  because `fetch` rewrites the `Host` header: loopback bind only and unreachable
  on the LAN address, an unknown `Host` refused, no `Host` refused, a form post
  refused, and no CORS headers on a preflight. All five have tests.
- **The CI recipe in `docs/ci.md` runs**, with the local substitution the page
  itself tells you to make.
- **`dbmd export` is idempotent** and writes only between its markers.
- **`dbmd check --json` is machine-independent.** Its `directory` field echoes
  what you typed rather than resolving it, so two machines agree.
- **The whole journey, against real databases rather than fixtures.** A
  PostgreSQL 16 container, a schema with an enum type, identity primary keys, a
  cascading foreign key, a composite unique constraint, an index on
  `lower(note)`, and comments on a table and a column. Then the four steps:
  print the query, run it through `psql`, import what came back, check it. Clean,
  and clean under `--strict`. What survived is the interesting part: the enum
  kept its own spelling and its `'draft'::shop.order_state` default, the
  expression index came through as `{ expression: lower(note) }`, `timestamp
  with time zone` and `timestamp without time zone` stayed distinct where the
  normalised vocabulary would have collapsed them, and the table with a comment
  got it as prose while the table without one got the prompt line instead. The
  studio then drew both with the arrow on `orders.account_id` pointing at
  `accounts.id` rather than at the box.

- **The dbmd skill works when somebody other than its author follows it.** I ran
  its canonicalise recipe verbatim: a column added in flow style with the wrong
  key order passed `dbmd check` with **zero diagnostics**, the nine-line script
  rewrote exactly that one file, a second run reported `unchanged`, and nothing
  else in the model moved. Then its rename recipe, all five steps: the query in
  step one printed exactly what the skill shows, moving the file without fixing
  the refs produced the two `ref-table-unknown` errors and the `name-mismatch`
  it promises as a safety net, and the finished rename checked green. **The
  prose hazard is real and table-specific**: `_model.md` names `subscriptions`
  in backticks, so renaming that table leaves the sentence false with a green
  check, and renaming `addresses` leaves nothing behind. That is why the skill
  ends the recipe with a sweep rather than a rule.

- **`dbmd refs` honours the output contract the others do**, checked because it
  is the newest public surface: `schema: 1`, valid JSON on stdout alone, and
  byte-identical output from two different directories for the same relative
  input, because `directory` echoes what you typed rather than resolving it.
  Its incoming list is sorted and its outgoing list is in **column order**,
  which is ADR 0006 read correctly rather than ignored: sort where the order is
  arbitrary, keep it where it means something.
- **The studio is safe to open on a model that does not fully parse**, which is
  the case a person is in when they reach for it. With one file carrying a tab
  in its frontmatter: the page serves, the eight tables that parsed are served,
  the one diagnostic is reported, and editing a **different** table wrote only
  that table's file and left the broken one byte-identical. That last part is
  the data-loss path staying closed, since a whole-model write would have
  replaced the unparseable file with a model that does not contain it.

- **The contributor path works as written**, tested the way the skill and the
  query recipes were: `npm run studio -- --no-open --port 8080` builds, binds to
  the port asked for, prints the URL, opens no browser, serves 200, and writes
  nothing to the model it is serving. The npm 11 note is still accurate and still
  relevant: npm here is 11.17.0 and `npm ci` does warn about esbuild's install
  script, and the build works anyway.
- **The gate costs about 41 seconds**, measured after a day of adding checks to
  it: typecheck 3.7s, format 3.3s, the four static checks 0.6s each, tests 9.8s,
  build 2.1s, `check:pack` 8.5s, `check:guards` 8.4s. **Two thirds of it is the
  tests and the two that pack a tarball**, and the four static checks together
  are under three seconds, so the cheap end has room and the expensive end does
  not.

- **Two studios on one model directory is safe, and the loser is told why.** Both
  bind, both serve. A edits `orders` and flushes. B, which still holds the old
  revision and has not noticed, edits the same table: its `PATCH` is accepted at
  B's own revision, and then B's watcher sees the file changed on disk, reloads,
  and **drops B's edit rather than writing over A's**. B's status carries the
  conflict and the sentence a person needs: `the studio has reloaded the file and
  dropped its own edit to it; make the edit again if you still want it`. The file
  keeps A's value and only that one file differs from the original. That is
  ADR 0019's protection working against a second **writer** rather than a hand
  edit, which is the case `wire.ts` says the revision exists for.

- **The whole note and group lifecycle, driven, and the model came back
  byte-identical.** A note created by pointing, named, recoloured, given a
  markdown body and deleted; a group created with a label and a colour, a table
  joined from its own panel, the table taken out again, the group deleted. After
  each, only the files that should have changed had. After both, `diff -rq`
  against the original found nothing.
  - **The group file never gains a member list or a coordinate.** Membership is
    one `group:` line in the member's own file, and the group file carries `kind`
    and `color` and stops. Joining a table changed `tables/customers.md` and not
    `groups/billing.md`.
  - **A group whose last member leaves draws a dashed placeholder** rather than
    vanishing, and `dbmd check` warns `group-empty` with the sentence that names
    the likely cause: an empty group is usually a rename that missed a file.
  - **A note the studio writes is canonical.** It has no blank line after the
    frontmatter where the committed notes do, which looks wrong and is not: the
    blank line belongs to the body, bodies are preserved byte for byte, and the
    canonical writer reports the file `unchanged`.
  - Each colour swatch's tooltip is the line it writes, down to
    `no colour: the file has no \`color\` key`.

- **The index editor writes what you type, and the error teaches the rest.**
  `Add index` appends a nameless, columnless row and writes it immediately, which
  produces two `empty-value` warnings that the panel also shows inline where you
  are editing. Typing an expression into the columns field writes a bare column
  name, and the resulting error is one of the best in the tool: it names the
  column, says the table does not have it, and **tells you to write
  `{ expression: lower(email) }` instead.** The studio cannot author an
  expression key, but it **carries one it did not write**: with that key on
  `customers`, moving the table wrote only the `layout:` line and the key came
  through byte-identical. Filed as a P4 because the asymmetry is real and the
  workaround is one message away.

- **The diagram markers refuse rather than guess, and one message forgot the
  slashes.** A file carrying `<!-- dbmd:diagram -->` without its closing pair is
  exit 1 with a message naming both markers; a file carrying neither gets the
  section appended. Both are what `docs/format.md` promises. But that error
  prints a Windows path where the same report's `--json` and the two success
  lines all print a slashed one, three lines apart in the same file, whose helper
  carries a comment explaining exactly why that matters. **`slashed` is
  export-only and it is one missed call site rather than a pattern**: every other
  command already prints forward slashes. Filed as a P3.

- **The output contract holds on a model that fails**, which is the case CI
  depends on. A dangling ref gives exit 1 in both forms; `--json` carries
  `schema: 1`, `ok: false`, the counts, and a diagnostic with its code, severity
  and file; and **stderr is empty in `--json` mode**, so a job capturing stdout
  gets the envelope and nothing leaks past it. No ANSI escapes when piped, with
  `NO_COLOR`, or with `--no-color`. Colour is not dead code either: `output.ts`
  detects a TTY per stream and `test/cli/output.test.ts` exists to pin the three
  inputs to that one decision, which is the part a pty-less session cannot drive.

- **The studio hides things with `[hidden]`, which any class rule beats, and
  there is exactly one place that mattered.** The page defines no `[hidden]` rule
  of its own and relies on the browser's, whose specificity is the lowest there
  is, so a rule setting `display` on a class beats it and the element stays
  visible. dbmd-45's agent hit that with `#inspector .flags` while driving its
  own change. I then checked the whole stylesheet against every element the
  client hides: **nine selectors set `display`, six things get hidden, and
  `.flags` is the only overlap.** So it is one instance rather than a pattern,
  and `check:scenes` cannot see this class of thing because the name is used by
  one scene rather than two.


- **Every referential action reaches markdown from a live database, and the
  command you would ask about them does not mention them.** A PostgreSQL 16
  schema with all five actions plus `on update` imported clean: `cascade`,
  `set null`, `set default`, `restrict`, and an undeclared foreign key written
  explicitly as `no action`. Strict clean, round trip `unchanged`. But
  `dbmd refs`, whose own record says you ask it immediately before a delete, lists
  the five referrers and says nothing about which of them cascade, in prose or in
  `--json`. **Two features that each work, with an empty seam between them**,
  because `refs` shipped first. Filed.


- **The referential actions are editable in the studio and the editor honours the
  distinction the format makes.** Driven on a copy of `examples/shop`: the panel
  shows two selects on a column that has a `ref`, carrying the five actions plus
  an empty option, and the empty one is **not** `no action`. Setting `cascade` to
  `restrict` wrote one line in one file. Setting it to the empty option **removed
  the key** rather than writing `no action`, which is ADR 0046's distinction
  between absent and declared surviving into the editor. Clearing the `ref:`
  itself took the action with it rather than leaving an orphan the validator
  would then reject. Every step left the model clean under `--strict`, and no
  file but the edited one changed.


## What proved out, and is easy to lose

Ways this codebase and this platform have actually broken, each found the
expensive way, plus what looked like a break and was not. **`AGENTS.md` has the
Gotchas section**, and it is deliberately short: an entry earns a place there by
having bitten twice, and it is deleted once something enforces the fix. This
list is looser. Most of these happened once, to somebody who went looking, which
makes them evidence rather than a rule to remember.


- **A studio started from a backgrounded shell gets reaped, and it looks like a
  crash.** Start one with the tool's background flag and it serves fine, then
  disappears minutes later with a clean log and no error. I nearly filed that as
  the studio dying when a directory is deleted underneath it. It is the harness
  reclaiming the shell's children. `nohup node dist/cli.js studio ... &` with
  `disown` survives, and the same studio then sat through a `tables/` delete for
  eighty seconds without noticing. **Reproduce before believing a crash**, and
  reproduce detached.
- **`/api/model` carries only the reader's diagnostics, not the validator's.**
  Its `diagnostics` array is empty for a dangling `ref:` or an empty group, and
  the page still shows both, because the client derives them from the model it
  was sent. I nearly filed that as the studio hiding errors. **Look at the page,
  not at the endpoint**, before saying what a person is told.
- **A rule written from what a grammar seemed to allow was wrong for months, and
  nothing could see it.** The mermaid renderer rewrote a word that opened with a
  digit, on the reasoning that a digit opens a number to the lexer. True, and not
  the rule: `-`, `.`, `[`, `]`, `(`, `)` and `,` are all legal mid-word and all a
  parse error at the front. So a column typed `[int]`, which is the SQL Server
  catalogue's own spelling, drew a diagram GitHub renders as a blank box, with
  `dbmd check` clean and every test green. Fixed by dbmd-7s6, which put mermaid's
  own parser behind the tests. **The general shape: a hand-derived rule about
  somebody else's grammar is a guess until their parser has seen the output.**
- **A published grammar can get looser, and that is worse than it getting
  stricter.** ADR 0023 measured `order items {` as a parse error and quoted every
  entity name because of it. In mermaid 11 that same line parses, as an entity
  plus an alias. So the failure mode for dropping the quotes moved from a blank
  box, which somebody notices, to a confident picture of a table nobody has,
  which nobody notices. **Re-measure a dependency's refusals, not only its
  acceptances**, when you are relying on one.
- **A screenshot of the working tree is not a screenshot of the product.** I
  measured `examples/shop` in a real browser, found two notes covering three
  tables with `shipments` 28,457 square pixels hidden, filed it, and told the
  owner it was the first picture anybody sees. It was **their own uncommitted
  arrangement**: four `layout:` edits they had made that morning, moving two
  tables up under notes that had been placed to sit exactly above them.
  `git archive HEAD examples/shop` renders **zero overlaps** between the ten
  boxes. The lesson is not "check git status", which I had done and knew about;
  it is that **a working tree with somebody else's edits in it is a different
  program**, and a measurement of it says nothing about what ships. Render from
  the committed tree when the claim is about the product.
- **What survived that correction is worth as much as what did not.** The clipped
  ref, 7 of 64 rows overflowing with no `title` to recover the text, measures the
  same on the committed tree, because it is a property of the stylesheet rather
  than of anybody's layout. Re-measuring separated the two findings; assuming
  would have thrown away the real one with the false one.
- **A "Revisit when" entry can half-fire, and nothing looks.** Every decision
  record here ends with conditions that should send somebody back to it, and 54
  of the 55 have one. When the owner decided to publish, three records' entries
  were about that event and **one got its correction**. The other two now
  describe work already carried out: ADR 0028 tells a release-day reader to
  remove a section of `docs/ci.md` that came out this morning and to replace a
  placeholder version that stopped being one, and ADR 0039 tells them to rewrite
  a skill section that has already been rewritten. `check:adr` checks numbering
  and `check:commands` checks that commands resolve; **neither reads a record
  against the tree it describes**, and a revisit entry is the part most likely to
  rot because it is written about a future that then happens.
  Found by grepping every revisit list for the words of things that changed that
  day, which took two minutes and is worth repeating after any decision the
  records anticipated. dbmd-7b6.
- **The instruction that caused it was mine.** I told the agent "0024, 0028 and
  0039 are not edited, per the superseded-records-stay rule", which was right
  about not editing and wrong about not appending, and they followed it exactly.
  **A brief that names files to leave alone should say what to do to them
  instead**, or the agent has been told half a rule.
- **The provider seam is real.** SQL Server landed with **zero lines** changed in
  `src/import/contract.ts` and `src/import/provider.ts`, and `import` then landed
  on top of both without touching either.
- **An imported model writes the engine's own type, with its modifier.** Not the
  normalised vocabulary, because a model file is read by a person holding it
  against a real database where `string` is not a type any engine has. ADR 0029.
- **A colon in a table name does not fail on Windows.** It writes an alternate
  data stream: success reported, content invisible to every listing and to `git`.
  `src/model/paths.ts` now refuses it.
- **A test can stop testing without breaking.** Three instances now, and the
  third was a fence that never fenced: a `GET` that a comment called a barrier is
  answered from a snapshot and never awaits the write behind it. That one test
  helper produced a P0 that looked like three different bugs.
- **A matrix doubles the chance of seeing a flake and dresses it as the
  version-specific break the matrix was added to find.** Read the failing leg
  before believing the shape of the failure.
- **The parser's first error is not its most useful.** Neither emission order nor
  printed order finds the tab; character position does.
- **A guard that fires only on the case nobody hits is worse than no guard.**
  The test behind `docs/format.md` slices its list of diagnostic codes at the
  first blank line, so a blank line put in to space out a doc comment drops
  codes from the check. There is a length guard, and it catches a blank line
  near the top of the list and not one near the bottom. That is why nobody
  looked again for months. Fixed by dbmd-8ms, which also found that the check
  matched a bare mention anywhere on the page rather than a table row.
- **A boundary looser than the writer reports success for a write that never
  happens.** The studio's name check refused four characters and the writer
  refuses nine, so `POST /api/table` with `a<b` answered **201 Created**, wrote
  nothing, and the very next read of the model did not contain it. The page is
  told the table exists and the disk never hears of it. Found by asserting the
  two rules against one list, which is the only way it was ever going to
  surface: each half was correct about itself.

- **One stylesheet for two scenes broke the page twice in a day.** The studio's
  canvas and its inspector panel share one style block, so a bare class selector
  matches both. `note` collided with `#inspector .note` and stacked every
  explanatory sentence in the page corner. Hours later `.notes` collided the same
  way, and because the unscoped rule was `position: absolute; top: 0; left: 0`
  and neither inspector rule set `position`, **every red validation paragraph had
  been rendering behind the toolbar**, including one the create form relies on
  being read. Singular and plural, one character apart, found by two agents who
  did not know about each other. Neither was visible in a diff or a test. Both
  were found by driving the page and noticing something in the wrong place.
  `.scene >` is the convention now and `npm run check:scenes` enforces it: a
  class name both files write must have every rule anchored to one scene.

- **An invariant with a comment and no test is a comment.** `messageOf` in the
  reader threw the system message away because ADR 0006 forbids an absolute path
  in output, and said so above itself. Nothing asserted it, and the path it
  guarded was reachable only from two catch blocks no test had ever entered. The
  test that fixes it is the shape worth copying: **read the same input from two
  different directories and demand the same bytes**, which fails for a path no
  test names.

- **An item written from somebody else's observation can have its premise
  backwards.** dbmd-c8p said the watcher's filename filter reliably ignored a
  `.tmp` on Windows. Measured over twelve rounds, the same file in a **freshly
  copied** directory woke it 0 times and in a **long-lived** one 11 times. The
  quiet was an artifact of the test harness handing every case a directory the
  watcher had only just attached to, which is never the shape a running studio
  is in. The right outcome was a corrected comment and a renamed test, and
  nothing in the watcher moved.

- **A `Dirent` cannot say whether that is a directory.** A junction or a symlink
  answers `isDirectory() === false` whatever it points at, so a model whose
  `tables/` was a link had its tables **never read**, and `dbmd check` reported
  `0 tables, 0 notes, 0 groups, no problems`. Not a malformed model: a correct
  one the tool refused to read and then called healthy. Found by measuring the
  symlink case while answering a much smaller question, and it is the reason
  "leave it alone, it is none of dbmd's business" was the wrong answer. The same
  shape survived one level down for a linked `.md` file and is fixed too; both
  now say `a link that resolves to a directory looks exactly like this`.

- **A recipe the tool prints is code, and nothing was running it.** The `sqlcmd`
  command `dbmd query --engine sqlserver` shipped produced a file ending
  `(1 rows affected)`, so the JSON was the first 2315 of 2333 bytes and the
  import failed **with a message saying the file was probably truncated**. It was
  too long. Then the same question asked of Postgres: its query gives no
  invocation at all, and the obvious `psql -f q.sql -o out.json` writes a header,
  a padded column and a `(1 row)` footer, which fails one position earlier with a
  worse message. **So the asymmetry was never "Postgres is safe", it was
  "Postgres is silent".** Both found by following the instructions rather than by
  running the tool, which is a different test and nothing had been doing it.

- **Distance is what goes stale, not counts.** `AGENTS.md` has carried a correct
  count of the commands through five arrivals, because its count and its list
  are one sentence. `README.md`'s heading counted entries two hundred lines below
  it and was wrong twice in three chances. So the heading stopped counting and
  the entries got a check, which is the split worth copying: **a count is
  something a person maintains, and an entry is content that has to exist.** A
  check that reads a heading is the check whose job a rewrite removes.


## 2026-09-07, evening: four things measured before anybody pushes a tag

- **The overlay is on the page in a real browser, not just in the bundle.** The
  startup banner claims it and a banner is a claim. Chromium at 1600x1000 against
  the running dev studio reports `document.getElementById('agentation-host')` is
  not null, with 8 tables, 58 edge segments, no console errors and no page
  errors. The served `main.js` carries 241 occurrences of `agentation`, 22 of
  `Agentation`, 6 of `createRoot` and the literal `4747`. The release bundle is a
  different file built from a different entry, which is what ADR 0064 and
  `check:guards` are about.

- **The annotation server answers plain HTTP and needs no MCP registration.**
  This was believed to require a session restart, and the handoff said so. It
  does not. `POST /mcp` with an `initialize` call returns an `mcp-session-id`
  response header; after `notifications/initialized` all nine tools answer.
  Read by hand this way: two sessions belong to this studio and the rest of the
  store belongs to another project on this machine, most of them on port 4300.
  Both of ours held no annotations. **The store is shared between projects**,
  which is the thing a reader of that store has to handle rather than discover.

- **The clipped ref target is fixed, measured rather than assumed.** The visuals
  epic recorded 7 of 64 column rows overflowing their box, the worst by 61
  pixels, with no `title` to recover the hidden text. The same measurement now
  returns 0 of 64. The row count matching at 64 is what says the two measurements
  looked at the same population.

- **The npm name is free and so are the spellings that could crowd it.** npm
  refuses a new name that is too close to an existing one, and that refusal
  arrives at the last step of a publish, after a token has been minted and a tag
  has been pushed. `dbmd` returns 404 from the registry, and so do `db-md`,
  `db.md`, `db_md`, `dbmd-cli`, `dmbd`, `bdmd` and `dbm-d`. That is seven
  neighbouring spellings rather than a claim about npm's rule, which is not
  written down anywhere this project can read.

- **What is still unobserved is still unobserved.** `release.yml` says in its own
  comments that whether `actions/checkout@v7` populates `refs/remotes/origin/main`
  on a tag push has never been seen, because no tag has ever been pushed here.
  Nothing above changes that. It stays unobserved on purpose: settling it needs a
  tag push, that is the one act no agent here may take, and the failure is safe
  and names the checkout rather than the tag.

## 2026-09-07, later: the feedback loop was run rather than assumed

- **An annotation written to the studio's session comes back over MCP.** One was
  posted to `POST /sessions/mtrxatwq-nia6dq/annotations`, read back through
  `agentation_get_pending`, and then deleted through
  `DELETE /annotations/:id`. The session is empty again and holds nothing that
  was not the owner's. What came back carried the comment, the element label and
  `elementPath`, with `intent`, `severity`, `nearbyText` and `reactComponents`
  all null. **So the half of the loop this project depends on is proved**, and
  the only unproved link left is whether the toolbar opens under a real mouse.
- **The server has a plain REST surface as well as the MCP one.**
  `GET /health`, `GET /sessions/:id`, `POST /sessions/:id/annotations`,
  `PATCH /annotations/:id` and `DELETE /annotations/:id`. `GET /sessions/:id`
  returns a session with its annotations and needs no handshake, which makes it
  a smaller thing for a script to depend on than nine tools behind a session id.
- **A write is rejected three times before it is accepted**, each time with a
  raw SQLite message. `comment`, `element` and `elementPath` are named together;
  then `NOT NULL constraint failed: annotations.x`; then the same for
  `timestamp`. Recorded because it is an argument for a reader that never
  writes.
- **A scripted click did not open the toolbar and that is not evidence it is
  broken.** Playwright's actionability check refused, and a raw mouse click at
  the launcher changed no DOM and sent no request. Headless Chromium driving
  somebody else's React portal is a weak instrument, so this is recorded as an
  open question for the owner rather than as a defect.

- **The keyboard work was driven and every clause of its help text is true.**
  Tab reaches `article#table-addresses`; ArrowRight moves to `table-order_items`
  and then `table-products`; ArrowDown reaches a note; ArrowLeft comes back;
  Home and End reach the first and the last object; Enter opens
  `aside#inspector` with `stock_movements` as its heading. No page errors
  throughout. **What the help text does not say is how to reach the panel it
  opens**, and that takes nine presses of Tab, which is the one thing recorded
  as owed rather than done.

## 2026-09-07, evening: what the npm page will actually show

**Raised as a defect and then measured away.** The README's headline picture is a
relative path, `docs/media/studio-shipments.png`, and `npm pack` does not carry
`docs/`: the tarball's only top-level files are `LICENSE`, `README.md` and
`package.json`. That looked like a broken image on the first screen of the
package page, and it is not.

**npm rewrites relative paths in a README to the repository's raw content.**
Settled by looking at a published package rather than at documentation, which
does not say. `chalk`'s README contains `![](media/screenshot.png)`, its tarball
contains no `media/`, and the rendered page serves it as
`https://raw.githubusercontent.com/chalk/chalk/HEAD/media/screenshot.png`.

Applied here, and both checked rather than assumed: the repository is public,
its default branch is `main`, and
`https://raw.githubusercontent.com/BlakeHastings/dbmd/HEAD/docs/media/studio-shipments.png`
and `https://raw.githubusercontent.com/BlakeHastings/dbmd/HEAD/docs/ci.md` both
return 200. So the picture and the sixteen relative links to `docs/` and
`CONTRIBUTING.md` will resolve on the package page, and nothing has to change
before a publish.

**`HEAD` is the rewrite, so the picture tracks the default branch** rather than
the released version. A reader of an old version's page sees today's screenshot.
That is the usual behaviour for every package on the registry and is recorded
here so nobody rediscovers it as a bug.

**The rest of what a stranger downloads was read at the same time and is
complete**: name, description, seven keywords, MIT, repository, homepage, bugs,
`engines.node >=22`, the `dbmd` binary and three export paths, with `LICENSE` and
`README.md` both in the tarball. 77 files, 236 kB packed.

## 2026-09-07, night: five paths driven in a browser, and the one that lies

Driven against a studio pointed at a **copy** of `examples/shop` in a temporary
directory, because four of these write files. Nothing tracked was touched.

- **Creating a table works and the status line then lies about it.** Arm with
  `Add table`, click the canvas, type a name, press `Create`: the box appears,
  the panel follows it, and `tables/roast_batches.md` lands on disk carrying
  `layout: { x: 835, y: 915 }` and one `id` column. **The status line says
  `Creating tables/cupping_notes.md.` and never stops saying it.** Measured at 3
  seconds and again at 15, unchanged; a drag of an unrelated box then replaced it
  with `Wrote tables/customers.md at 8:09:11 PM.` The write is right and only the
  sentence is wrong. Dispatched, and **fixed the same night by ADR 0074**, which
  is why this entry is corrected rather than left standing: a create, a note and
  a rename now each end by saying what they did, measured the same way at 3
  seconds and at 15. Driving it also found two more paths with the same hole that
  this entry did not reach. `createNote` had it. So did a rename of a table
  nothing points at, which reaches the writer for nothing, while a rename of a
  referenced table clears the sentence part-way through and ends by showing
  `Wrote tables/<some referrer>.md`, a true sentence about the least interesting
  file the act touched.
- **A rename does everything it says it will do.** It shows the plan first:
  *"This writes tables/buyers.md and deletes tables/customers.md. 3 refs point
  here and will be moved with it, which edits 3 other files."* Confirmed, and the
  requests were exactly that plan in order: `POST /api/table`, then a `PATCH` and
  a flush for each of the three referrers, then `DELETE /api/table/customers`. On
  disk afterwards: `buyers.md` present, `customers.md` gone, three files saying
  `ref: buyers.id`.
- **A delete says what it will leave broken.** *"This deletes
  tables/customers.md and edits no other file. 3 refs in 3 other files will be
  left pointing at nothing: addresses.customer_id, orders.customer_id,
  subscriptions.customer_id."* The asymmetry with rename is deliberate and both
  sentences say which one they are.
- **An edit made in another program reaches the page.** A column added to
  `customers.md` on disk appeared within 3 seconds, the row count going 6 to 7.
  That is ADR 0004's promise and it holds.
- **A file that becomes unreadable is named within 3 seconds**, on an open page
  as well as a fresh one, while the last good version of that table stays drawn.

**Four of the five were nearly reported as defects and were not.** `Add table`
appearing to do nothing is an arm-then-place interaction. `Rename` appearing to
do nothing is arm-then-confirm, like delete. The unreadable file appearing to go
unnoticed was a break condition in the test that fired on diagnostics which were
already there. Each was settled by reading the source or fixing the instrument
rather than by filing. **The one that survived that treatment is the one worth
having**, and the difference between the four and the one is that the one was
checked against what the code says it does: `standing` is cleared in exactly one
place, and the create path does not go through it.

- **A sixth path, and the one that would matter most if it were wrong.** Two
  writers, one model: a box was held mid-drag while `tables/orders.md` gained a
  column from outside, and the drag was then released, which is when the page
  asks to write the layout it is holding. The write was **refused**, in these
  words:

  ```
  1 edit was dropped rather than written over a change on disk.
  tables/orders.md `tables/orders.md` changed on disk after the studio read it,
  so writing over it would lose that change.
  ```

  The column written from outside survived on disk and the page then showed it.
  So the thing that was lost was a layout nudge and the thing that was kept was
  somebody's column, which is the right way round. Tone `bad`, named file, and
  no page errors.

- **A seventh path, groups, driven after the other six.** `Add group` goes
  straight to a form rather than arming a placement, because a group has no
  coordinates of its own. Creating one settles at 3 and 12 seconds on a sentence
  that is both true and useful: *"Created groups/roastery.md. Nothing is in it
  yet, so it draws as an empty box and dbmd reports group-empty: put a table in
  it from that table's panel."* That sentence predates ADR 0074 and is the shape
  the other paths were changed to follow.

  Moving `shipments` out of `warehouse` and into the new group through the
  panel's `Group` select wrote `group: roastery` into `tables/shipments.md`, said
  so by name, redrew both group shapes, and left `dbmd check` reporting
  `8 tables, 2 notes, 2 groups, no problems`. The `group-empty` diagnostic that
  the new group had while it was empty went away when the table joined it, which
  is the same read feeding the canvas, the panel and the footer.

## 2026-09-07, night: the dash is already taken, and I had offered it

**This corrects a picture the owner was sent.** Four edge-marker options were
rendered on the live diagram to make the visuals epic's open question something
they could answer by looking. The fourth was a dashed line for a cascading
delete. **It is not available.**

`.edge.unanchored` in `index.html` sets `stroke-dasharray: 5 4`, and its comment
says why: an end that could not find its column is drawn at the table's name and
has to be readable as that rather than as an ordinary arrow. Found by removing
`customers.id` in a browser, not by reading the stylesheet: three of the eleven
edges went dashed at that moment and eight stayed solid, and each dashed one's
tooltip ended *"Drawn at the table's name because there is no customers.id."*

**The other two channels are taken as well.** `.edge.related` paints the edges of
a selected table in the accent colour at `stroke-width: 2.5` against the ordinary
`1.5`. So colour and weight both already mean "these are the ones you are looking
at".

**That gives the epic's recommendation a second and better reason.** It said
prefer a marker to colour because colour stops working in print and for a
colour-blind reader, which is true and is about readers. The stronger reason is
about the canvas: of the three channels an edge has, two are spoken for and the
third is a dash that already means something else. A marker at an end is the only
one left.

**And the marker slot itself is free, which was worth checking rather than
assuming.** An edge uses one marker, `dbmd-arrowhead`, on `marker-end`, and it is
the only `<marker>` defined anywhere on the page. `marker-start` and `marker-mid`
are unset on every edge. So a mark at the child end costs nothing that is
currently in use, and the two surviving options are identical in what they take:
the choice between them is which shape and which case it marks, and nothing
else.

## The same night: removing a referenced column, and reordering one

- **A column that other tables point at is not removed quietly.** Taking `id` off
  `customers`, which three tables reference, asks first and offers
  `Remove anyway` beside `Cancel`. Taken, the footer names all three:
  `` `ref: customers.id` on column `customer_id` names no column of `customers` ``
  for `addresses`, `orders` and `subscriptions`, plus the primary key warning
  that follows from it. `dbmd check` reports 3 errors and 1 warning across 4
  files, and the three edges go dashed while the other eight stay solid. **The
  edge ids survived the removal**, which is what ADR 0072 needed them to do.
- **Reordering a column writes the file in the new order.** Moving `cancelled_at`
  up one in the panel put it above `paused_until` in `tables/subscriptions.md`
  and on the canvas box in the same beat, and the status named the file it wrote.
  The index in that file, `subscriptions_due_idx`, stayed where it was.

## 2026-09-07, night: the last two, and what is now covered

- **A note's body is edited in the panel and reaches the file byte for byte.**
  The panel for a note carries one textarea holding its 764 characters. Typing at
  the end wrote `notes/the-copies-are-deliberate.md`, said so by name, and the
  canvas showed the new text. The file's tail afterwards was
  `"r-history page.\n\n\nORCHESTRATOR WAS HERE."`: the two blank lines are the two
  newlines that were typed and the third is the file's own, so the promise the
  panel makes about carrying what is typed, LF endings and all, held.
- **Resizing a note writes its size, corrected for zoom.** The grip is the only
  element on the page with `cursor: nwse-resize`. Dragging it 90 by 60 took the
  box from 340 by 233 on screen to 421 by 286, and `layout:` went from
  `w: 380, h: 260` to `w: 470, h: 320`. Those agree once the 90% zoom is taken
  out, which is the arithmetic that would be wrong if the writer used screen
  pixels.

**Every interactive surface has now been driven.** Creating a table, a note and a
group; renaming with and without referrers; deleting a table; removing a
referenced column; reordering a column; moving a table between groups; editing a
note; resizing one; the watcher; a file that becomes unreadable; two writers on
one model; and the keyboard from the first Tab into the panel and back out.

**One defect came out of all of it, and it turned into two.** The status line
after a create, which was also true of a rename and worse there. Everything else
held, including every case where the tool has to say what it is about to break
rather than break it quietly.

**The instrument was wrong far more often than the product.** Six times: an
arm-then-place button read as dead, an arm-then-confirm button read as dead, a
stopping condition that fired on diagnostics already present, an Escape pressed
in the one field that answers Escape itself, a synthetic click that does not
select where the keyboard does, and a resize checked against the wrong file while
the status line was naming the right one. Each was cheap because it was caught
before anything was filed. That ratio is the argument for reading the source
before believing the page, which `orchestrating.md` now carries as a rule.

## 2026-09-07, night: the re-import, which is the owner's own words

The one feature on this project specified by the owner in their own sentence:
*"it sounds like you are asking about a delta. When we import, we warn the user
about the changes 'database table removed' in an itemized list for them to
scroll through. Then they can confirm the change."* Driven end to end against a
real payload rather than a fixture-shaped one, because it is the feature they
care most about and nothing had run it as a person would.

A first import wrote two tables. A sentence was then added to
`tables/orders.md` by hand, to stand in for a person's documentation. The
payload was edited to drop one table and add one column, and re-imported:

```
Re-importing ... from postgres would make 2 changes:

tables/order_line.md
  database table removed
      `order_line` is in the model and not in this import, so
      tables/order_line.md is deleted.
      Its prose goes with it, and the last commit is where that survives.
      A table nobody dropped on this list usually means an import over fewer
      schemas than the last one.

tables/orders.md
  database column added
      `orders.cancelled_at` is text in the database and is not in the file, so
      it is added at the end of `columns:`.

dbmd: nothing has been written, because nothing above has been confirmed.
```

**The owner's phrase is the literal heading**, the list names the file each
change is about, and the removal says both what is lost and what usually causes
it. Nothing was written until `--confirm`, and with it: `order_line.md` gone,
`cancelled_at` added at line 26, exit 0.

**The sentence written by hand survived.** That is the property the whole design
turns on, and it is why the promise at the foot of the list, that prose bodies,
layout and group membership are not touched either way, is worth more than the
list above it.

**An unchanged re-import is one line and exit 0**, as the help claims, so it is
safe in CI: *"already says what this postgres import says: 1 table, nothing to
change."* `dbmd check` on the result reports no problems.

## 2026-09-07: every revisit condition in every decision record, read once

**Nothing had ever read one.** `check:adr` refuses two records claiming a number
and nothing else in the tree looks at a record's contents, so a **Revisit when**
entry is written about a future and then nobody goes back. This is the first
sweep, and its point is to make the lists countable: a list nobody sweeps is one
that quietly stops being read.

**What was read.** 73 records, `0001` to `0074` with no `0053`, and **263
bulleted conditions** between them. Every bullet was read and judged.

| | conditions |
| --- | --- |
| already recorded as fired, by an appended section written before today | 13 |
| **found fired and now recorded, in this sweep** | **15** |
| read and ruled out | 235 |

The 13 that were already handled are the reason this was not a blank sheet.
Records 0001, 0005, 0013, 0024, 0028, 0029, 0034, 0036, 0039 and 0056 each
already carried a section saying which of their entries had fired, and 0043
carries two sections examining an entry and concluding it had not. That habit is
what this sweep extends rather than invents.

**The 15, and where each is written up.** Each is in the record it belongs to,
appended below the original rather than edited into it, per the directory's own
README.

| record | entry | what happened |
| --- | --- | --- |
| 0002 | the owner asks for the GitHub repository | fired 2026-08-24; the backlog stayed in beads by drift rather than by decision, which is the thing the entry asked to avoid |
| 0010 | deleting becomes something a caller needs | fired; `Edits.removeObject` is the only place that deletes and `writeModel` still never does, which is where the entry said it belonged |
| 0015 | something other than a table becomes draggable | fired twice: a note is dragged and resized, and a group drag writes several files |
| 0016 | a rule the page needs is not one the validator has | fired; a second and a third appeared, and all three now have a reader `empty-value` behind them since ADR 0027 |
| 0016 | the watcher lands | fired; the harder sentence is built and was driven |
| 0016 | something other than a table gets a panel | fired; notes and groups each have one, through the same `fields.ts` |
| 0018 | the inspector rewrites a box's rows in place | fired; a column reorder moves a row with no size change, and the explicit trigger was already there |
| 0018 | groups arrive | fired; ADR 0035 answers where the measurement lives, on the same code path |
| 0021 | notes and groups arrive | fired; the mode names a kind, one layer above where the entry looked, and a group is deliberately outside it |
| 0025 | something other than a table gets a panel, or a group drag moves several tables | fired on both halves; the answer stayed one revision per file rather than one per gesture |
| 0034 | `check:guards` grows a second slow mutation | fired; the arithmetic is redone below |
| 0056 | a third page starts carrying output blocks | fired; four pages and four readers, and the parser was copied rather than lifted |
| 0065 | the canvas becomes operable by keyboard | fired; a roving tabindex rather than the `aria-activedescendant` the entry named |
| 0065 | a fourth kind of object joins the canvas | half fired; an edge took an id and no label |
| 0071 | the canvas becomes operable by keyboard | had already fired when the record was written, twenty pull requests earlier |

### What was driven rather than reasoned

A studio on `--port 0` against a copy of `examples/shop` in a temporary
directory, in a worktree, with Playwright. Nothing tracked was touched.

- **A table changing on disk under an open panel with a caret in it.** Body
  textarea holding 1581 characters, caret at 392, focus in the field. A different
  file gained a column, then the open file's own did. Length, caret, focus and
  panel heading were identical after each, and the status read *"The model changed
  on disk. This page is still showing what you were working on, and will catch up
  when you are between edits."* The canvas did not redraw either, which is that
  sentence being honest rather than a second defect.
- **A ref-carrying column reordered so a row moves and the box does not.**
  `orders.subscription_id` moved three places down. Box height 239px before and
  after, so no `ResizeObserver` entry could fire, and **exactly 1 of the 11 edges
  moved**, the one whose row moved. The other ten paths were byte-identical.
- **A group drag.** One drag of the `warehouse` header wrote
  `tables/shipments.md` and `tables/stock_movements.md`, the status named both in
  one sentence, and `groups/warehouse.md` gained no `layout:` key.
- **The keyboard, and what is not on it.** `Tab` reaches a canvas object in one
  press; the arrows, `Home` and `End` walk the eleven; `Enter` opens the panel, a
  second `Enter` lands on its `h2` and `Escape` comes back. **0 elements on the
  page carry `aria-activedescendant`**, 1 of 11 objects carries `tabindex="0"`,
  and **0 of the 11 edges carry either a `tabindex` or an `aria-label`**.
- **Panels for the other two kinds.** The note panel carries `color`, `body` and
  `layout` and one textarea; the group panel carries `label`, `color`, `members`
  and `body` and one textarea.

No page errors in any of it.

### The gate's arithmetic, redone because ADR 0034 asked

One run of each, in a worktree on this machine, on 2026-09-07. The left column is
what ADR 0034 wrote down when it was measured earlier the same day.

| | ADR 0034 | now |
| --- | --- | --- |
| `npm test` | 9.4s | 15.1s |
| `npm run check:pack` | 7.9s | 9.3s |
| `npm run check:guards` | 8.1s, one mutation | 18.5s, two rounds |
| `npm run check` | 26.5s, and ~34.6s predicted | 54.9s |

`check:guards` is now the largest single item in the gate, at about a third of
it. Nothing is proposed on the strength of that: the two things ADR 0034's
decision rests on, that `npm test` stays outside it and that the gate is paid
once per push, are both unchanged.

**The orchestrator ran the gate independently the same night and got 1m0.2s**,
which is their measurement and not this one. Two runs an hour apart on one
machine differing by five seconds is roughly what a single run of anything is
worth, and the useful part is that both are more than double the 26.5s ADR 0034
recorded earlier the same day.

### One thing the sweep found that was not a revisit condition

**A brief's premise, and the correction is the useful part.** This sweep was
briefed as "no condition has ever been examined after it was written". That is
wrong in a way worth keeping: eleven records already carried an appended section
doing exactly this, and 0028's carries the general note that a revisit entry "is
the part of a record most likely to rot, because it is written about a future that
then happens", with the advice to grep them after any decision the records
anticipated. The habit existed. What did not exist was a sweep of all of them at
once, which is what makes the ones nobody happened to be looking at findable.

## 2026-09-07, night: what it does with six hundred tables

Nobody had pointed this at more than eight. Synthetic payloads of 8, 100 and 600
tables, each table shaped like `order_line` in
`test/import/fixtures/postgres-raw.json` and chained by a `ref:` so there is an
edge per table, imported with `dbmd import` and opened in Chromium at a 1600 by
947 window. The canvas is 1600 by 798 of that; the rest is the header, the
toolbar and the status bar.

**Before**, with the grid five columns wide whatever the count:

| Tables | Layout written | Zoom after Fit | Boxes on screen | Status line said |
| --- | --- | --- | --- | --- |
| 8 | x 40..1240, y 40..300 | 100% | 8 of 8 | `Nothing written this session.` |
| 100 | x 40..1240, y 40..4980 | 25%, clamped | 70 of 100 | `Nothing written this session.` |
| 600 | x 40..1240, y 40..30980 | 25%, clamped | 70 of 600 | `Nothing written this session.` |

Six hundred tables is five columns and a hundred and twenty rows: about 1424 by
31172 model units, which at 25% (`MIN_SCALE`, the furthest the studio zooms out)
is 356 by 7793 screen pixels. Ten screenfuls of a ribbon four boxes wide, and
**nothing anywhere said the fit could not fit**. The selection line was empty and
the status line was the ordinary one.

**The drawing itself was never the problem.** 600 boxes and 599 edges drew with
no console error and the page was interactive.

**After**, with the width taken from the count and a sentence when Fit clamps
(ADR 0075):

| Tables | Layout written | Zoom after Fit | Boxes on screen | Status line said |
| --- | --- | --- | --- | --- |
| 8 | x 40..940, y 40..300 | 100% | 8 of 8 | nothing new |
| 100 | x 40..3340, y 40..2120 | 30% | 100 of 100 | nothing new |
| 600 | x 40..8740, y 40..4980 | 25%, clamped | 264 of 600 | the notice below |

> Fit is as far out as this page goes, and it was not far enough: 264 of the 600
> objects on the canvas are on screen and the rest are past the edges. The zoom
> stops at 25% so that a box still says what it is, so the way to the others is
> the arrow keys, which walk to one object at a time and bring it into view.

**A hundred tables now fit, which is the number that matters**, because a
hundred is an ordinary database. Six hundred still do not and cannot: 600 boxes
at this pitch want about 47 million square model units and a canvas at 25%
offers about 20 million. No arrangement fixes that, which is why the sentence
exists.

**The count in the sentence was wrong the first two times it was measured and
both causes were the page, not the arithmetic.** The load-time fit ran before
the diagnostics list and the status line rendered, and those sit under the
canvas, so it was fitting to a canvas 128 pixels taller than the one the page
kept. And the sentence is three lines where the ordinary status is one, so
saying it takes another 16 pixels and makes its own count too generous: 308
said, 286 on screen. Both are fixed and the number now agrees with the page on
the first draw and on every press.

**The re-import onto an arrangement, driven rather than reasoned about.** Eight
tables imported, then `t0` and `t5` dragged in a real browser to (177, 101) and
(256, 533), which wrote those two files and nothing else. A payload with six new
tables re-imported: the itemised list showed six `database table added` and
nothing else, and after `--confirm` all eight existing layouts were unchanged to
the pixel, including the two dragged, and the six arrivals landed three wide at
y 793 and y 1053, one row pitch below the lowest thing already placed. Reopened
in the browser: 14 boxes, all on screen at 58%, no console error.

**Re-driven on the rebased build, and one more thing found.** Same payloads
against the tree with the revisit sweep under it: 100 tables at 30% with 100 of
100 on screen and no notice, 600 at 25% with the notice saying 264 and 264
counted off the DOM, on load and again after pressing Fit, no console error in
either. And **the count goes stale if the window is resized**: a page fitted in
one window and then resized to 1600 by 947 said 180 while 286 boxes were on
screen. Nothing re-fits on a resize, on purpose, so the sentence is about the
moment it was said and pressing Fit again makes it true. ADR 0075 names it under
both **Consequences** and **Revisit when** rather than fixing it, because the
fix is a decision about what a resize should do to the view.

## 2026-09-07, later: the sweep got one wrong, and ADR 0075 is what found it

**The count above is sixteen rather than fifteen**, and the sixteenth was found
by somebody else's change landing an hour later. It is written here rather than
edited into the section above because a sweep that quietly fixes its own
arithmetic is a sweep nobody can audit.

**ADR 0021's second revisit entry had fired and the sweep said it had not.** The
entry is *"Something other than the studio creates a table. `dbmd import` writes
a whole directory and has no pointer, so every table it makes has no `layout` and
is laid out on the grid. That is correct today and stops being obviously correct
the moment somebody wants an import to arrive readable."* The sweep's own
sentence about it repeated the entry's description as though it were a
measurement, and the description is false:

- **`dbmd import` writes a `layout:` on every table and always has.**
  `src/import/model.ts` sets one on each table it builds, and ADR 0029 decided
  that in #45, the pull request the import landed in. ADR 0021 landed in #29,
  sixteen pull requests earlier, so its sentence was a prediction about a command
  that did not exist and the prediction was wrong. Nothing ever re-read it.
- **And somebody has now asked for an import to arrive readable.** ADR 0075 is
  that, landed the same night, and the section above it on this page carries the
  numbers.

**Two lessons, and the second one is the one worth keeping.**

The cheap one is that ADR 0021's entry is the shape ADR 0071's turned out to be:
a record born describing a future, never read against the future when it
arrived. That is two out of sixteen, from seventy-three records, which is a rate
rather than a coincidence.

The one that costs more is that **the sweep believed a record instead of the
tree**. Every other "not fired" verdict in it was reached by reading the code or
by driving the page. This one was reached by reading the sentence in the record
and agreeing with it, which is precisely the failure the sweep was carried out to
find, committed by the sweep, in a section whose whole subject is records going
stale. `orchestrating.md` already carries the rule this breaks, that the source
is read before the page is believed, and a decision record is a page.

Both corrections are appended to the records themselves, ADR 0021 and ADR 0029,
in the same shape as the others.
## 2026-09-07, night: the tarball rendered, not just fetched

`check:pack` packs the tarball, installs it elsewhere, drives every command and
asks the running studio for its page, its client bundle and its model. **Nothing
had ever rendered that page.** A fetch proves the bytes are served; it does not
prove they run.

So the tarball was packed, installed into an empty directory with `npm init -y`
and `npm install ./dbmd-0.1.0.tgz`, given a copy of `examples/shop`, and its
studio was opened in Chromium. What a person who ran `npm install dbmd` would
see:

```
title                kettleback-shop · dbmd studio
tables               8
edges                11, all 11 carrying an id
notes                2
groups               1
tooltips saying      11 of 11 name what a delete does
what a delete does
overlay on the page  none
React on the page    none
body background      rgb(246, 246, 244), so the stylesheet applied
failed requests      none, and no 4xx
console errors       none
page errors          none
```

**The two `none` rows are the owner's constraint, proved from the strongest
possible place.** ADR 0064 argues the feedback overlay cannot reach the release
bundle and `check:guards` proves the tarball refuses to carry it. This is the
same claim checked from the other end: the page a stranger's browser actually
executes has no `#agentation-host` and no React on it.

Everything else in that list is a thing built today arriving intact through a
pack, an install and a render: the delete rules in the tooltips, and the edge
ids that make feedback on a relationship name the relationship.

A full-page screenshot of the installed studio is line for line the development
one, minus the toolbar in the corner, which is the difference there is supposed
to be.

## 2026-09-07, night: what it does with six hundred tables

The example model has eight tables and nothing had ever been pointed at a real
database's worth. A synthetic payload was built from the import fixture's own
table shape, so the columns, indexes and check constraints are the fixture's
rather than something invented, with a foreign key on every third table.

| | 120 tables | 600 tables |
| --- | --- | --- |
| `dbmd import` | 0.41s | 1.28s |
| `dbmd check` | 0.33s | 0.76s |
| `dbmd export --stdout` | | 0.76s, 165 kB |
| re-import, unchanged | | 0.79s, one line |
| studio first paint | 564ms | 577ms |
| boxes drawn | 120 | 600 |
| edges, all with unique ids | 40 | 200 |
| fit then zoom in | 885ms | 912ms |
| console and page errors | none | none |

**First paint did not move between 120 and 600**, and neither did anything else
much. `Tab` lands on the first box and the arrows walk one box per press at both
sizes, with exactly one box holding `tabindex="0"` and no duplicate id anywhere
on a page carrying six hundred of them.

**One thing worth an eye rather than a number.** Fitting six hundred tables puts
the zoom at 25%, which is the same figure it picks for eight, so it is the floor
rather than a computed fit. Whether a box is worth reading at 25% is a question
about the visuals phase and not a defect.

**The importer refuses a malformed payload precisely.** A first attempt at the
synthetic file put the foreign keys under the wrong key, and rather than writing
junk it said
`$.tables[101].foreignKeys[0].referencedSchema [import/empty-value]` and named
the empty field. The JSON path is what made the mistake obvious in one read.

- **Two more things that hold at the edges, recorded so nobody re-checks them.**
  Every table file was moved out from under an open studio: the canvas went to
  zero boxes with no console or page errors, and putting them back brought all
  eight straight home. And the footer's diagnostics list is
  `overflow-y: auto`, so two hundred of them scroll inside a 53 pixel footer
  rather than growing the page.

  A third could not be tested on this platform, which is worth saying rather than
  leaving as an untried idea: **renaming the model directory out from under a
  running studio fails with `EPERM` on Windows**, because the watcher is holding
  it. So the case a person actually meets is files changing under the directory,
  not the directory going away, and that case is covered above.

- **The command line refuses cleanly and says what to run next.** Five error
  paths, with their real exit codes read from an unpiped run: `check` on a
  directory that is not there and `check` on a file both name the errno and the
  diagnostic code and exit 1; `export` over a model with an error says there is
  nothing safe to draw and points at `check`, exit 1; `refs --dir` says the
  option does not exist and lists what that command does take, exit 2;
  `query --engine oracle` says **"no engine goes by \"oracle\", and this build
  knows postgres, sqlserver"**, exit 2. `check examples/shop` exits 0. So a
  model problem is 1 and a usage mistake is 2, which is the distinction a script
  would want and nothing had checked.

- **A name with a space in it, which is the weak point of the edge ids added
  tonight.** `order items` is a legal table name and `order id` a legal column
  name: `dbmd check` reports `2 tables, 0 notes, 0 groups, no problems` on a
  model built from them, and the ref between them resolves. So the id on the edge
  really does contain spaces, `edge-lines.order id->order items.id`, and so does
  the box id, `table-order items`, which has been true since ADR 0064 rather than
  since tonight.

  **It still works, and the reason is that nothing builds a selector by
  concatenation.** `agentation`'s builder runs its id through `CSS.escape` and
  produced `#edge-lines\.order\ id-\>order\ items\.id`, which resolves to exactly
  one element. On our side the client never writes `'#' + id`: `getElementById`
  is the only lookup, in two files, and it takes any string. The keyboard pair
  works on `table-order items` too.

## 2026-09-07, night: where the sixty seconds of the gate goes

The revisit sweep found that ADR 0034 priced `npm run check` at 26.5s and
predicted about 34.6s, and measured 54.9s. Run here end to end it is **1m0.2s**.
Each step timed on its own, same machine, one run each:

| step | time |
| --- | --- |
| `check:guards` | 19.3s |
| `test` | 17.6s |
| `check:pack` | 9.9s |
| `typecheck` | 4.8s |
| `format:check` | 4.0s |
| `build` | 2.5s |
| `check:scenes` | 1.1s |
| `check:reviewable` | 0.8s |
| `check:commands` | 0.8s |
| `check:adr` | 0.7s |

**Packing accounts for 29.2 seconds of the 61.5**, because `check:guards` is
`check:pack` run twice more against a mutated copy of the tree. That is the price
ADR 0034 chose knowingly, and the two rounds are independent of each other: each
copies the tree, breaks it its own way, and asserts its own refusal.

Nothing is proposed here. This is the measurement whoever looks at it next would
otherwise have to take, and it is recorded so that a proposal can be argued
against numbers rather than against an impression that the gate feels slow.

- **Two studios on one model directory, which is two terminals and a plausible
  accident.** Both start, both serve, and neither knows about the other. A drag
  in the first wrote `tables/orders.md` and named it; the second saw the change
  through the watcher and caught up; a drag in the second then wrote from the
  updated position rather than from its own stale copy, so nothing was lost and
  nothing was refused. No page errors on either.

  The refusal path is the one measured separately above, where a page holding a
  model the files had moved on from tried to write and was told
  `1 edit was dropped rather than written over a change on disk.` **So the two
  cases are the same mechanism seen from either side**: catch up and the write
  lands, do not and it is refused.

## 2026-09-07, night: the edge nobody can tab to already says everything elsewhere

The revisit sweep left three things open and the largest was **"an edge is the
one thing on the canvas a keyboard cannot reach"**, which four records' entries
fire on. It is true of the drawn line and it is not true of what the line says,
and the difference decides whether anything should be built.

Driven with the keyboard only, no pointer: Tab to a box, arrows to `orders`,
Enter, Enter into the panel, then Tab through it. Every reference that table
makes, and every delete rule on one, is a focusable control with a real name:

```
input   ref (table.column)   "customers.id"
select  on delete            "restrict"
input   ref (table.column)   "addresses.id"
select  on delete            "restrict"
input   ref (table.column)   "subscriptions.id"
select  on delete            "restrict"
```

**So the tooltip added in ADR 0071 is a second way to learn a delete rule and not
the only one.** A keyboard user reaches all three of `orders`'s references, their
targets and their actions, through a walk ADR 0073 shortened to two presses of
Enter.

What is genuinely unreachable is the **path element**: 0 of 11 carry a `tabindex`
or an `aria-label`, measured on the page. So the open item is *a drawn object is
not focusable* rather than *this information cannot be had*, and anybody picking
it up should weigh a keyboard walk over eleven lines against a panel that already
names them. Recorded here so the weighing happens before the building.

## 2026-09-07, night: every block on every page that runs dbmd and shows output

ADR 0056's third revisit entry fired into four pages with four readers and no
shared parser, and the question behind it is whether anything a page claims is
output has gone unchecked. Counted rather than guessed: **173 fenced blocks
across the documentation, 29 carrying a `dbmd` tag and 17 plain `json`.** Most of
the rest are shell commands, configuration and illustrative markdown, which
ADR 0056 declined to make exhaustive on purpose.

The subset that can rot is narrower and countable: **a block that runs `dbmd` and
prints something back. There are eleven and every one is now accounted for.**

- **Three are in decision records** (0041, 0049, 0054), which describe what was
  true when they were written and are not claims about today.
- **Four in `README.md` were swept by hand and the sweep is recorded** in
  ADR 0069: `dbmd init`, `dbmd check examples/shop`, the `check` error block with
  its `echo $?`, and the `studio` block whose port the kernel chooses.
- **One is guarded by a test**, the `dbmd query` block, which is what ADR 0069
  built.
- **Two are sketches of a model that does not exist here**, the pair at
  `README.md:467` showing `shop` with two errors in it. They illustrate a failure
  rather than quote a run, which is what `dbmd-sketch` is for.
- **Two had never been checked by anything, and both are right.** Run here:
  `dbmd refs orders examples/shop` at `README.md:438` matches the page byte for
  byte across all nine lines, and the pair at `README.md:500` prints
  `Wrote db-model/README.md: 2 tables, 1 relationship.` and then
  `db-model/README.md is already up to date: 2 tables, 1 relationship.`, both
  exactly as shown.

**So nothing on any page is currently wrong, and two blocks are one edit away
from being wrong with nobody to notice.** That is the same position the query
block was in this morning before its count drifted by 2576 characters. The
machinery to fix it exists and is one table entry each in
`test/docs/readme.test.ts`, which is a smaller change than lifting a parser
four ways.

- **A third run of the gate, and the owner's uncommitted edit passes it.** 55.1s
  on `6cf5b36`, with 1137 tests rather than the 1124 the second run measured, so
  it did not grow when the last three changes added tests to it. Three runs now
  stand at 54.9s, 60.2s and 55.1s against the 26.5s ADR 0034 recorded, which
  settles the question the second run raised: the five seconds between the first
  two were variance, and the doubling is not.

  **The run included the owner's uncommitted `README.md` edit**, which had never
  been put through the gate. It passes, so the shortened attribution paragraph
  they are part way through writing is safe to commit whenever they want it.

## 2026-09-07, night: the publish path, checked from the parts nobody looks at

- **The claim `release.yml` rests on is true.** Its header says there is no
  separate test step because *"`npm publish` runs `prepublishOnly`, which is
  `npm run check`"*. Read off `package.json`: `prepublishOnly` is
  `npm run check` and `prepack` is `npm run build`. So the tarball is only
  uploaded if the whole gate is green on the tagged commit, which is what that
  argument claims and nothing had confirmed.
- **Workflow token permissions are already the safe setting.** `release.yml`
  declares `contents: read` and `provenance.yml` and `aftermath.yml` declare
  theirs per job. `check.yml` and `model.yml` declare none, which would matter if
  the repository default were write. It is not: the API reports
  `default_workflow_permissions=read` and pull request approval off. So the two
  undeclared workflows inherit read-only and there is nothing to harden.
- **`model.yml` writes nothing to the repository.** It runs `check` and
  `export --stdout` into the runner's temporary directory and uploads the result
  as an artifact, so the workflow that draws the picture cannot touch the model
  it drew it from.
- **`npm publish --dry-run` was deliberately not run.** It would add almost
  nothing over the `npm pack --dry-run` already recorded above, which is where
  the file list came from, and the cost of one mistyped flag is a publish that
  cannot be undone. On the night an agent merged a pull request from a command it
  had labelled a placeholder, that trade is not close.

## 2026-09-07, night: the shape of the thing, measured and not judged

Entropy accounting is one of the three lenses this project reviews against and
nobody had put a number on the tree itself. These are measurements, with no
proposal attached, so that whoever next thinks about the shape argues against
figures rather than against an impression.

| | lines | files |
| --- | --- | --- |
| `src` | 20229 | 50 |
| `test` | 19466 | 46 |
| `docs` | 16822 | 82 |

**Test lines and source lines are within four per cent of each other**, and the
documentation is not far behind either.

The eight largest source files:

```
1854  src/studio/client/canvas.ts
1740  src/studio/client/inspector.ts
1497  src/model/read.ts
1108  src/import/contract.ts
1080  src/studio/edits.ts
 966  src/studio/client/main.ts
 875  src/cli/import.ts
 683  src/import/delta.ts
```

**Thirty five per cent of `src` is comment**, 7135 lines against 11624 of code.
That is the habit this project is built on rather than a smell: the comments here
carry decisions and their reasons, and several of tonight's findings came from
reading one rather than from reading code. It also means the two largest files
are closer to 1200 lines of code apiece than to 1800.

**Nothing is proposed.** Two files above a thousand lines of code is worth
noticing and is not worth churning working, tested, heavily explained code over
with no defect driving it. The number is here so that the question, when somebody
asks it, starts from a fact.


## 2026-09-07, night: which guards have been seen to fail, and one that lies about itself

ADR 0034 says a guard is not believed until it has been seen to fail, and nothing
checks that the rule was applied to every guard. Checked by hand: **eight of the
nine scripts under `scripts/` that guard something are exercised by
`test/guards/broken-on-purpose.test.ts`**, which is 98 cases. The two that are not
are `report-merge-aftermath.mjs`, a detector built the same day that has never
fired because nothing has gone red, and `check-setup.mjs`, which ADR 0057
explicitly declines to extend because it is a portable asset from the plugin.

**The second of those turned out to report coverage it does not have, and tonight
proved it.** `check-setup.mjs` prints of the guard hook:

```
[ ok      ] 2. The guard hook
             covers an agent merging its own PR. Does not cover a session that
             never loaded it, or a human at a terminal
```

The hook is real and was working: `.claude/settings.json` is tracked, so it loads
in agent worktrees too, and `guard-merge.mjs` denies `gh pr merge`, a merge
through `gh api`, and eleven prefixed spellings of the same command. **What it
permits, by name and on purpose, is `node scripts/merge-pr.mjs`**, which is the
route the project tells everybody to use and therefore the only one an agent
would reach for. The agent that merged its own pull request was never refused,
because it never typed the refused thing.

So the first clause of that line is wrong for the path an agent actually takes,
and the two exceptions it names are not the one that bit. What layer 2 covers is
an agent merging **around** the wrapper. What it does not cover is an agent
merging **through** it, and ADR 0078 is what closes that.

Filed upstream as a comment on `b-fac` issue 189, because the text is the
plugin’s rather than this repository’s.


- **The format reference documents every diagnostic, and something already
  keeps that true.** All 34 codes declared in `src/diagnostics.ts` appear in
  `docs/format.md`, and `test/docs/format.test.ts` imports the type and reads the
  page, so a new code with no entry fails the build. **I went looking for that
  guard expecting it to be missing and was wrong**, which is the tenth time in one
  night an assumption of mine was the defect rather than the product, and the
  first time I checked before dispatching an agent at it.

## 2026-09-08: a model built to be awkward, and the notice that generalised

Six hundred tables was a synthetic shape. This is the other kind of awkward: two
tables, one of them three hundred columns wide and one of them named
`kundenaufträge`.

- **`dbmd check` reads it clean**, `2 tables, 0 notes, 0 groups, no problems`.
- **The studio draws 301 rows in one box**, 1469 screen pixels tall at 25% zoom,
  first paint in 571ms, no console or page errors.
- **The non-ASCII name survives every layer.** The box id is
  `table-kundenaufträge`, the edge id is
  `edge-kundenaufträge.wide_id->wide.id`, and `agentation`'s own selector rule
  returns `#edge-kundenaufträge\.wide_id-\>wide\.id`, matching exactly one
  element with no duplicate id anywhere. So a person annotating a relationship in
  a German schema gets the same thing an English one gets.
- **`dbmd export` produces valid mermaid.** 311 lines, all three hundred columns,
  the name quoted, and `mermaid.parse` accepts it, run in this repository so the
  parser resolves.

**The finding is the Fit notice, and it is better than the thing it was built
for.** ADR 0075 added a sentence for when Fit cannot fit, measured against six
hundred boxes. Here it fires on **two**:

```
Fit is as far out as this page goes, and it was not far enough: 1 of the 2
objects on the canvas are on screen and the rest are past the edges.
```

Because the condition it tests is the drawing not fitting rather than the count
being large. One table with three hundred columns is about 5900 model pixels
tall, which no zoom this canvas offers can bring into a 798 pixel viewport. **A
notice written for a synthetic six hundred table import turns out to be the one a
person meets on their second real table**, and nothing about it needed changing
to do that.

- **The supply chain is one dependency.** `npm audit` reports 0 vulnerabilities
  with and without dev dependencies, and the only runtime dependency is `yaml`.
  Somebody installing this gets the package and a YAML parser.
- **`gh pr checks` exits non-zero while anything is pending**, so a script that
  waits on it throws instead of waiting unless it catches. Two attempts at a
  wait loop died on that tonight before the third caught it.

## 2026-09-08: the reference shapes that would break a simpler naming scheme

The edge identities added on 2026-09-07 name an edge by the two columns it joins.
The obvious cheaper scheme names it by the two tables. These are the shapes that
separate them, and all of them hold.

Sixteen tables in one model, no problems reported, no console or page errors, no
duplicate id anywhere on the page:

- **Two tables that point at each other.** `left.right_id` at `right.id` and
  `right.left_id` at `left.id` produce two distinct ids and two distinct edges.
  A by-table scheme gives both the same name.
- **Two columns of one table pointing at the same table.**
  `edge-twice.from_id->left.id` and `edge-twice.to_id->left.id`. A by-table
  scheme gives these the same name too, and this is the common one: a `from` and
  a `to` on one row is an ordinary shape.
- **A self reference.** `edge-twice.self_id->twice.id`, which is the case
  `examples/shop` already has once and which a by-table scheme reduces to a name
  that is the same word twice.
- **A chain twelve deep**, drawn without incident.
- **A table with no columns at all.** Draws as a box with zero rows, and
  `dbmd check` says nothing about it. **That silence is deliberate and
  documented** in `validate.ts` and in `docs/format.md`: a table with columns and
  no `pk: true` is a warning, and a table with no columns is somebody part way
  through writing one, where telling them their primary key is missing would be
  telling them their table is empty in the least useful available words. I went
  looking for an inconsistency against `group-empty` and found a decision.

## 2026-09-08: a stranger clones it and builds it

The tarball has been packed, installed elsewhere and rendered in a browser. The
repository itself had never been cloned fresh and built, which is the other thing
a person does with a public project.

Cloned from GitHub into a temporary directory, at `6e167c7`:

```
npm ci        8.3s
npm run check 56.6s, exit 0
```

Every step green, including both deliberate breaks of the pack guard. The gate
time matches the four measurements taken on this machine tonight, which stand at
54.9, 60.2, 55.1 and 55.6 seconds.

**The one warning a newcomer sees is already explained and the explanation is
right.** `npm ci` on npm 11.17.0 ends with `npm warn allow-scripts esbuild@0.28.2
(postinstall: node install.js)` and an invitation to approve it. `CONTRIBUTING.md`
says to ignore it, because esbuild ships its platform binary as an optional
dependency that npm installs either way. **That claim is now measured rather than
asserted:** the postinstall did not run, and the build, the client bundle and the
packed tarball are all fine.

So the answer to "can somebody else pick this up" is yes, in about a minute, with
one warning that the guide already tells them to ignore for the right reason.

## 2026-09-08: the studio in a second browser

Every measurement of the studio in this file was taken in Chromium, because that
is what Playwright installs by default. **This tool's entire interface is a local
web view and nobody had opened it in anything else.** The `README.md` says "a
local web view" and names no browser, so a Firefox user is a user the page makes
a promise to.

Firefox 153 installed for the purpose, driven against a copy of `examples/shop`:

```
title              kettleback-shop · dbmd studio
boxes              8
edges              11, all 11 carrying an id
tooltips saying    11 of 11
what a delete does
zoom               90%
body background    rgb(246, 246, 244), so the stylesheet applied
console errors     none
page errors        none
```

**The keyboard works too**, which is the part most likely to differ between
engines: `Tab` reaches `table-addresses`, `ArrowRight` moves to
`table-order_items`, and `Enter` twice lands on the panel's heading inside
`#inspector`. That is ADR 0067's roving tab stop and ADR 0073's second `Enter`,
both built and measured in Chromium.

**And it writes.** A box dragged in Firefox took `tables/orders.md` from
`layout: { x: 480, y: 340 }` to `{ x: 480, y: 418 }`, and the status line named
the file it wrote. So the whole loop, pointer to disk, works in a browser nothing
here was developed against.

Reasoned rather than measured, and worth saying separately: the client uses no
engine-specific API. Grepped for `scrollIntoViewIfNeeded`, `checkVisibility`,
`showPicker`, vendor prefixes and `requestIdleCallback` and found none, and the
only modern CSS in `index.html` is `inset:`. So the result above is what the code
predicts rather than a surprise, which is the least interesting kind of good news
and the kind worth having in writing.

## 2026-09-08: the third engine

Firefox was the second. WebKit is the third and last one a person can be using,
and it is the one most likely to differ, because the drawing is SVG and the ends
of the lines are an SVG `<marker>`.

WebKit 26.5, driven against a copy of `examples/shop`:

```
title              kettleback-shop · dbmd studio
boxes              8
edges              11, all 11 carrying an id
tooltips saying    11 of 11
what a delete does
zoom               90%
body background    rgb(246, 246, 244)
console errors     none
page errors        none
```

**The SVG half specifically**, since that is the reason to bother: the arrowhead
resolves through `marker-end: url(#dbmd-arrowhead)`, the computed stroke is
`rgb(138, 143, 152)` at `1.5px` exactly as in the other two, `getTotalLength()`
answers 378 on the first edge, and all eleven have a bounding box with extent. So
the geometry, the marker and the stylesheet all land the same way.

**The keyboard and a write, both again.** `Tab` reaches `table-addresses`,
`ArrowRight` moves on, `Enter` twice lands on the panel heading, and a drag took
`tables/orders.md` from `layout: { x: 480, y: 340 }` to `{ x: 480, y: 418 }` with
the status naming the file.

**All three engines now, and none of them was the one it was built in.** Chromium
is where every measurement in this file was taken until tonight. Firefox and
WebKit were each installed for the purpose and each behaved identically, which is
what a client using no engine-specific interface predicts and is now measured
rather than predicted.
