# 0081. A runtime belongs to a machine, so a page cites it rather than quoting it

## Context

`CONTRIBUTING.md` said this about `npm run check:pack`:

    It takes about six seconds and it is the only thing here that looks at what a
    user would actually get; ADR 0024 says why that is worth six seconds on every
    run.

Measured in a worktree on the machine this is developed on, on 2026-09-07:
**9.4s**, and the orchestrator measured 9.1s and 9.9s the same night. The number
on the page had drifted by more than half, on the file a first-time contributor
reads before their first change.

It had also stopped being the last step. `npm run check` runs ten things and
`check:pack` is the ninth. `check:guards` arrived with
[ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md), runs
after it, and is now the largest single item in the gate. The sentence saying
"the last one" was written when it was true and nothing noticed when it stopped
being.

**This project has answered a drifted number twice this month and answered it
differently each time.** On the morning of 2026-09-07 it deleted five hand-kept
counts rather than correcting them, and `docs/process/verified.md` records the
reason under *distance is what goes stale, not counts*: `AGENTS.md` keeps a
correct count of the commands because its count and its list are one sentence,
and `README.md`'s heading counted entries two hundred lines below it and was
wrong twice in three chances. Later the same day
[ADR 0069](0069-a-count-the-program-derives-is-proved-on-the-page-not-deleted-from-it.md)
refused deletion for the length of an introspection query and guarded it
instead, on the ground that the program derives it, so the number cannot drift
and only the page's transcription of it could.

**A runtime is a third kind and neither answer reaches it.** It is not
maintained by a person, so deleting the sentence does not remove a failure that
lived in somebody's memory. And it is not derivable by the program, so there is
nothing for a guard to compare the page against. A duration is a property of the
machine that ran the command: the disk, the antivirus, the Node version, whether
`node_modules` was warm. There is no value that is correct for every reader, so
there is no assertion to write. `check:pack` really did take about six seconds,
on some machine, on some day, and the sentence carried neither.

The third possible answer, a timing guard, is refused outright. A test that
asserts a duration fails on a loaded laptop and passes on a broken one, and this
gate already costs about a minute.

## Decision

**A runtime is recorded once, in `docs/process/verified.md`, with the date and
the machine on it. Every other page cites that entry and states the shape rather
than the seconds.**

The three parts each answer a different failure.

**Recorded once, because distance is what goes stale.** The measurement and the
conditions that make it mean anything are one entry, the way `AGENTS.md`'s count
and its list are one sentence. A figure copied into a second file is a figure
two hundred lines from the thing that justifies it, which is the shape that was
wrong twice in three chances.

**Dated and attributed, because that is what makes it re-derivable.** ADR 0034's
revisit entry already works this way and says so in its own words: the
arithmetic was redone rather than carried forward, the orchestrator's independent
run is named as theirs and not the sweep's, and the table ends *with the numbers
dated so the next person redoes them rather than quoting these.* This record
makes that habit the rule instead of one record's good manners.

**Cited with a shape, because the shape is what the reader needed.** Somebody
about to run `npm run check` for the first time is asking two questions:
is this seconds or minutes, and what is it spending them on. The second one has
an answer that is not a duration at all. `check:guards` is `check:pack` run twice
more against a broken copy of the tree, so **the package is packed three times
per run**, and that is why most of the gate is packing. That sentence is a fact
about `package.json` and `scripts/check-pack-guard.mjs` rather than about a
machine. It stays true on a faster laptop, it stays true when the numbers move,
and anybody can check it by reading two files.

So `CONTRIBUTING.md` now names all ten steps, says that the last two are one job
done three times, says to expect to wait, and points at
`docs/process/verified.md` for the per-step table and its date.

**No guard is added and that is deliberate.** Nothing mechanical can catch the
next drifted runtime, because there is no correct value to compare against. What
this record buys is that there is now only one place for the next one to be, and
that place is a file whose subject is measurements and whose entries carry
dates.

## Consequences

- **`CONTRIBUTING.md` no longer answers "how long does the gate take" with a
  figure.** That is a real loss for a reader who wanted one, and it is the price
  of not lying to the reader on the other machine. The citation is one link away
  and it is more useful than the figure was, because it is ten figures with a
  date and a machine on them.
- **The list of steps is a count beside its own list**, which is the shape
  `docs/process/verified.md` found safe. It will still go stale if an eleventh
  step is added and nobody edits the sentence. Nothing checks it. The mitigation
  is adjacency and nothing more, and that is a smaller claim than the file used
  to make.
- **This is the third treatment for a number in prose, and the set is now
  named.** Hand-maintained gets deleted (the five counts). Program-derived gets
  guarded on the page (ADR 0069). Machine-dependent gets measured once, dated,
  and cited (this record). A number that is none of the three has not been met
  yet.
- **It applies to every page, not only this one.** `README.md`, `AGENTS.md` and
  the process docs are covered by the same rule. Nothing was swept for it here:
  only `CONTRIBUTING.md` was read, and one duration was found and moved.
- **`docs/process/verified.md` gains a job it was already doing.** It is now the
  named home for runtimes rather than incidentally the place they ended up. The
  cost is that a runtime someone wants on a page has to be measured properly
  first, which is the intended cost.

## Revisit when

- **A runtime becomes something the program reports.** If `npm run check` ever
  printed its own per-step timing, the number would stop being a fact a person
  copied and start being one a run produced, and ADR 0069's treatment would
  become available: prove it on the page rather than cite it. That is a real
  possibility for the gate and it would be the better answer.
- **A second page wants the same number.** Two citations of one entry is fine.
  Three is the signal that the entry should be a document with a stable anchor
  rather than a dated section, because a link into prose is the one kind of
  reference `scripts/check-commands.mjs` does not read and
  `docs/process/verified.md` has recorded a stale one before.
- **The shape claim goes wrong.** "The package is packed three times per run"
  becomes false the moment `check-pack-guard.mjs` grows a third round or drops
  one, and unlike the seconds, this one is checkable: it is two files. If it
  turns out to drift anyway, the honest conclusion is that this record swapped
  one unguarded claim for another and the sentence should go rather than be
  corrected again.
- **Somebody proposes a timing guard.** The refusal above is the answer, and the
  argument that would change it is a gate slow enough that a regression in it is
  worth a flake. It is about a minute today and nobody has proposed one.
