# Handoff

A snapshot with a decay note. Where this disagrees with the repository, the
repository is right: `bd ready`, `bd blocked`, `git log` and the decision records
are the source of truth and this is only where the work stopped.

**As of 2026-09-07, with two agents in flight and no pull request open.**

## Where the work is

Seventy-nine pull requests have merged, all through `merge-pr.mjs`, and the
provenance audit is clean across every commit on `main`. **64 items closed, 9
open.** Five of the seven epics are closed. Of what is left, two are dispatched,
two wait on the owner, and one is an epic nobody has started.

From a checkout, the tool now does the whole loop, and the first command is new
as of today:

```bash
node dist/cli.js query    # prints your engine's introspection SQL, for you to run
node dist/cli.js import   # the JSON that returns becomes a model directory
node dist/cli.js init     # scaffolds a model directory
node dist/cli.js check    # validates it, exits 1 on an error, --strict promotes warnings
node dist/cli.js export   # a mermaid diagram GitHub renders in a pull request
node dist/cli.js studio   # a canvas: drag, edit, rename across files, add and delete tables
```

**The journey runs end to end for the first time.** `dbmd query` prints the SQL,
you run it with the client you already trust, and `dbmd import` reads what came
back. It was proved against a PostgreSQL 16 container: query, run, import,
`dbmd check` clean. No credential and no driver is ever this tool's business.

Until 2026-09-07 that journey had no first step. `dbmd query` was named by four
error messages, the format page, ADR 0007 and `AGENTS.md`, and did not exist.
**The tool told people to run a command it then rejected**, and there was no
backlog item to build it. Look for that shape: a thing referred to so
consistently that nobody checks it is there.

**It is not published to npm** and `package.json` is `"private": true` on purpose.
`AGENTS.md` and `README.md` both say so. Two files claimed otherwise for a day and
that false claim is why a CI recipe invented a version number.

**The owner has a studio open on `examples/shop`**, started before today's studio
work, so it has neither the file watcher nor the staleness guard. Restarting it
picks both up. Four files are modified, one `layout` line each; the model checks
clean. Do not commit or revert them.

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

## What a successor would otherwise have to reconstruct

- **The guard is loaded.** `scripts/guard-merge.mjs --probe` was refused. Ask it
  again after every harness restart, alone on the command line.
- **`bd` needs `--ignore-schema-skew`** on this machine and is not on an agent's
  PATH. `.git/factory/machine.md` has the story, and a brief has to hand agents
  the full path.
- **An agent in a worktree sees committed files and nothing else.** Put the brief
  in the dispatch message.
- **Merge on the report, not on a checks listing.** Both merge-timing rules are
  in `orchestrating.md` with what each one cost. The second was found today and
  put a reverted commit onto `main`.
- **Close items when their branch lands**, in the same motion as the merge.

## In flight

- **dbmd-80**, a skill that teaches an agent to drive dbmd. It became
  dispatchable only because a day of using the tool answered three of the four
  questions its refinement was waiting on.
- **dbmd-95n**, a symlinked model file inside a kind directory, which is the
  `Dirent` problem one level down.
- **dbmd-4cp**, the sqlcmd recipe the SQL Server query prints, which does not
  work.

## What proved out, and is easy to lose

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
  `.scene >` is the convention now; dbmd-3ip is the check.

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
  shape survives one level down for a linked `.md` file, which is dbmd-95n.

- **Following the instruction the tool prints is a different test from running
  the tool.** `dbmd query --engine sqlserver` ships a copyable `sqlcmd` command
  for saving its result. Run it verbatim against a real SQL Server 2022 and
  `dbmd import` refuses the file: sqlcmd appends its row-count line, so the file
  is 2333 bytes of which the JSON is the first 2315. **The payload is perfect and
  the instruction is wrong**, and the parse error a user gets says "the usual
  cause is a paste that stopped early", which sends them hunting a truncation
  that did not happen. Filed as dbmd-4cp with a proven one-line fix. The Postgres
  query has no such command, so it cannot be wrong in this way and gives less
  help; whether that asymmetry is right is part of the item.

## Audited on 2026-09-07, so a successor need not redo it

All clean unless a line says otherwise. Each was checked by breaking something
rather than by reading.

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


## What is waiting on the owner

- **Publishing to npm.** Asked three times, never answered, and nothing depends
  on it. The package is ready; removing one line is the whole decision.
- **The beads schema recovery.** One destructive statement, refused by the
  harness, backup taken. The stopgap has carried every backlog write today.
