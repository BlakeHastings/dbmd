# 0100. A diagram that is written and will not draw

## Context

`dbmd export` writes a mermaid `erDiagram` into a README between two markers and
reports what it did. Measured on this machine on 2026-09-08, over synthetic
models each with a `ref:` chain so there is an edge per table:

| tables | diagram characters | against 50,000 |
| ------ | ------------------ | -------------- |
| 8      | 805                | under          |
| 100    | 10,649             | under          |
| 600    | 64,149             | over           |

At 600 tables the command printed `Wrote README.md: 600 tables, 599
relationships.` and exited 0, and **mermaid will not draw that file.**

`maxTextSize` in mermaid's default config is 50,000, read out of
`node_modules/mermaid/dist/mermaid.core.mjs` at 11.17.2: `MAX_TEXTLENGTH` at
line 1059 and the check in `render` at line 1270,
`if (text.length > (config?.maxTextSize ?? MAX_TEXTLENGTH))`. When it trips,
mermaid does not fail. It **substitutes a different diagram**, the line above the
check at 1060:

```
graph TB;a[Maximum text size in diagram exceeded];style a fill:#faa
```

A red box with that sentence in it, where the schema should be, in somebody
else's pull request, days later. That is the same silent failure ADR 0023 is
built around and ADR 0048 measured, arriving through a door neither of them
covers: **the check is in `render` and not in `parse`.** So
`test/export/mermaid.test.ts` hands every diagram it builds to `mermaid.parse`,
gets a clean answer for a diagram of any size, and that clean answer is evidence
for the grammar and evidence for nothing at all about the size. ADR 0048's own
consequences say `mermaid.parse` is not `mermaid.render`; what they say it costs
is a wall nobody can read, and the real cost is a diagram nobody gets.

About 107 characters per table for these models, so the wall is near **467
tables**. Nothing in the tool said anything about it, in prose or in `--json`.

**The number this project cannot know is what GitHub configures.** 50,000 is
mermaid's default and this repository has no way to observe GitHub's mermaid or
its config. `release.yml` and ADR 0060 both handle a fact of that shape by
naming it as unobserved rather than by guessing, and so does this.

## Decision

**`dbmd export` warns, on stderr, with exit code 0, and reports the same thing
as a value in `--json`.** Four things were settled and each is a separate
argument.

**It is a warning and not a refusal.** The file is written and it is correct.
The model is fine; `dbmd check` has already passed over it, because export
refuses a model with an error in it before it draws anything. What has gone
wrong is downstream of all three, in a renderer this command does not run and
whose configuration it cannot see. Refusing to write would be refusing on behalf
of somebody else's config, and it would take the diagram away from a person who
is pasting it somewhere with a raised limit, for whom nothing is wrong at all.
Exit code 0 is therefore not a compromise: it is the honest answer, and a caller
that wants a build to fail on this reads the boolean and chooses to.

**Both forms carry it.** ADR 0006 rule 3 is that a caller reading `--json`
should never need to parse prose, and a pipeline that commits
`db-model/README.md` has exactly the problem a person has. The prose is a
warning on stderr where all narration goes; the report gains `characters` and a
`mermaid` object.

**The message names the number, the limit, and whose default the limit is.**
Three sentences, each for a different reader. The first quotes mermaid's own
substituted sentence, so somebody who has already seen the red box can match the
two up, and prints both numbers, because the gap between them is how far over
the model is. The second says 50,000 is mermaid 11.17.2's default `maxTextSize`
rather than a rule and that what GitHub configures cannot be read from here, so
a person pasting into something with a bigger limit knows to stop reading. The
third says nothing failed and the model is fine, and points at `dbmd studio`,
which is the answer this project already gives for a model too large to look at
as one picture. There is no `dbmd:` prefix and no red styling: both mean "this
run failed" everywhere else in the CLI, and `dbmd check` prints the word
`warning` plain for the same reason.

**`--stdout` warns too.** It writes no file, and the same text has the same
problem; the flag most likely to be used for pasting a diagram somewhere is the
worst one to keep quiet in. ADR 0006 rule 1 is not spent on this. Rule 1 is
about stdout, the redirect still captures the document and only the document,
there is still no success line to strip and no quiet flag to remember, and a run
under the limit still writes nothing whatsoever to stderr. `docs/ci.md` said
`--stdout` writes nothing whatsoever to stderr **ever**, and that sentence was
already false before this change: a model with an error in it is refused in
narration on stderr under the same flag. It is corrected rather than newly
broken.

**The threshold is a claim about somebody else's software, so it is named as
one.** `MERMAID_MAX_TEXT_SIZE` and `MERMAID_VERSION` sit together in
`src/export/mermaid.ts`, they are exported from `src/index.ts` for a library
caller with the same problem, and the version is printed everywhere the number
is.

**It cannot be read at run time and it is read at test time.** Mermaid is a
devDependency (ADR 0048) and `files` ships `dist` only (ADR 0024), so an
installed `dbmd` has no mermaid to ask and this command has to work on that
install. `test/export/mermaid.test.ts` therefore asserts
`MERMAID_MAX_TEXT_SIZE` against `mermaid.mermaidAPI.defaultConfig.maxTextSize`
and `MERMAID_VERSION` against the installed `package.json`, on every run. The
default config is what is read rather than the private `MAX_TEXTLENGTH` beside
it, because `getConfig()` answers with the default whenever nothing has
overridden it, so the `??` fallback is never reached and the default config's
value is the one that decides.

**The guard has been seen to fail, per ADR 0034.** The two fixtures in
`test/cli/export.test.ts` are **one character apart across the limit**: twelve
tables of 170 columns, plus one column on the first table whose name is the only
thing that differs between the two, giving a diagram of exactly 50,000
characters and one of exactly 50,001. Mermaid's check is
`text.length > maxTextSize`, so 50,000 draws and 50,001 does not, and this pair
is the smallest thing that can say which. One asserts the warning fires and the
other asserts silence, so a constant that drifted, a comparison that became
`>=`, or a count taken over the whole generated section rather than over the
diagram inside the fence turns one of the pair red. A pair chosen at 8 and 600
tables would survive all three. The count printed in the message is asserted
against the length of the fence body read back off the file that was just
written, rather than against a number typed in the test.

**What is measured is the fence body.** `MermaidSection.characters` is the
length of the diagram alone, not of the section, which carries the markers, the
notice and the caveats paragraph and is about a kilobyte longer. A markdown
renderer hands mermaid the body of the fence. The fence's own closing newline is
worth one character either way, which is a second reason the message prints the
count rather than only the verdict.

**A sentence inside the generated section was considered and refused.** The
person who sees the red box is a reviewer on GitHub, not the person who ran
`dbmd export`, and the caveats paragraph sits directly under the diagram where
that reviewer is looking. It was refused because mermaid's substituted box
already says exactly what happened, in its own words, at that exact spot; a
second sentence in every export of every model, for a case near 467 tables,
would be paid by everybody to tell that reader something they have already been
told.

## Consequences

- **This tool now knows a fact about a program it does not run.** That is new.
  Every other number in `src/` is about the format, the model or this
  repository's own output; this one is about what a renderer somewhere else will
  do. It can be wrong in a way none of the others can: not by drifting from the
  code around it, but by staying exactly right while the world moves.
- **When the limit changes, the test says so and the message is what has to be
  fixed.** `package-lock.json` pins what `npm ci` installs, so a mermaid bump is
  a day somebody chose. On that day the constant test fails, naming which of the
  two is wrong. The fix is not just the constant: the version is printed inside
  a sentence, in `src/cli/export.ts` and in the `--help` text and on
  `docs/ci.md`, and moving the number without moving the version produces a
  message that is confidently wrong about which mermaid it means.
- **When the limit changes without a bump here, nothing notices.** This is the
  honest gap. A GitHub that lowers its `maxTextSize` below 50,000 makes this
  command silent about diagrams that will not draw, and a GitHub that raises it
  makes it warn about diagrams that draw perfectly well. Neither is observable
  from this repository, which is why `overMaxTextSize` is named for the default
  it compares against rather than for a rendering that will happen.
- **`dbmd export --json` grows two keys**, `characters` and `mermaid`. ADR 0006
  makes adding a field fine and renaming one breaking, so this is additive.
  `docs/ci.md` shows the payload and `test/docs/payloads.test.ts` runs the block
  it shows, so the page could not go stale quietly.
- **The wide-table fixtures are pinned to the emitter's bytes.** One character
  of headroom is the property that makes the pair worth having and it is also
  what makes it fragile: a change to how a column row is spelled moves both
  fixtures together and off the limit. Both assertions read the character count
  off the run and name, in the failure message, the knob that puts it back,
  which is the length of one column name.
- **The three sizes in the table above are one machine on one day.** They are
  what a synthetic model of that shape produces, and a real model with longer
  names and more columns per table reaches the limit at fewer tables. 467 is
  arithmetic on two measurements, not a supported number.

## Revisit when

- **Mermaid is bumped and the constant test goes red.** Read `maxTextSize` out
  of the new default config rather than assuming it moved by a round number, and
  move `MERMAID_VERSION` in the same commit as every sentence that prints it.
- **Somebody reports a red "Maximum text size" box on a diagram this command did
  not warn about, or the opposite.** That is the first evidence that what GitHub
  configures and mermaid's default have come apart, and it is the only way this
  project will ever learn it. The answer is probably not a different constant:
  it is a sentence on `docs/ci.md` saying what was observed and when.
- **Mermaid stops substituting and starts failing.** The substitution is what
  makes this worth a warning rather than a footnote. A version that raised an
  error instead would be visible on GitHub without help, and the argument for
  the whole of this record would need rereading.
- **A second downstream limit turns up.** One claim about somebody else's
  software is a constant with a version beside it. Two is a table, and the third
  is a reason to ask whether these belong in `src/` at all or in something the
  build reads out of the installed package and writes down.
- **A model that large stops being hypothetical.** Everything here is measured
  on synthetic models. The day somebody points `dbmd import` at a real 500-table
  database, the characters-per-table figure and the advice to use `dbmd studio`
  are both worth checking against it rather than against these.
