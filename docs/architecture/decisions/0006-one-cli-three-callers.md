# 0006. One CLI, three callers: a human, a pipeline, and an agent

## Context

`dbmd` gets run in three places, and they are not variations on each other. They
want opposite things, and a CLI that is designed for one of them is actively bad
in the other two.

- **A developer at a terminal** wants colour, a summary, and an error that says
  what to do next. They read the output once and throw it away.
- **A GitHub Actions step** wants an exit code, stable text in a log, and an
  artifact it can upload. It has no TTY, colour codes are noise in the log, and
  anything that waits for input hangs the job for six hours.
- **An agent**, in Claude Code or anywhere else, wants structured output it can
  parse, deterministic bytes it can diff between runs, and a guarantee that no
  command will ever open a browser or ask a question it cannot answer.

Getting this wrong is not a polish problem. A tool that prompts hangs CI. A tool
whose output reorders between runs makes an agent think something changed. A tool
that writes its data to stdout mixed with its progress chatter cannot be piped
into anything.

## Decision

Four rules, and they are checkable rather than aspirational.

**1. stdout is data. stderr is narration.**

Anything another program might consume goes to stdout and nothing else does.
Progress, warnings, timing and "wrote 12 files" go to stderr. `dbmd export
--stdout > diagram.md` produces a diagram and no chatter, in every context,
without a quiet flag.

**2. Nothing ever prompts, and nothing opens a browser unless asked.**

There is no interactive mode to fall out of. Where a command needs a decision it
does not have, it exits non-zero and says what flag supplies it. `dbmd studio`
is the single exception on the browser, and `--no-open` turns it off; it prints
the URL either way, which is what a headless caller needs.

**3. `--json` on every command that reports anything, and the schema is a
contract.**

`check`, `export` and `import` all take it. JSON goes to stdout, exit codes stay
the same as the text form, and the shape is documented and versioned. An agent
reading `--json` should never need to parse prose, and a text format is free to
change wording in a patch release precisely because the JSON did not.

**4. Deterministic output. Same input, same bytes.**

Sort everything that is emitted: tables, columns within a table where a sort
order is not meaningful, relationships, diagnostics. No timestamps in generated
files, no absolute paths, no wall-clock durations in `--json`. This is what makes
a generated diagram safe to commit and what stops an agent chasing a diff that is
only the sort order of a hash map.

Colour follows the environment rather than a flag: on when stdout is a TTY, off
otherwise, and off when `NO_COLOR` is set. `--no-color` exists for the case where
the detection is wrong.

## Consequences

- **Every command that prints gets tested twice**, once for text and once for
  `--json`, and the exit code assertion belongs in both. The classic bug here is
  `--json` exiting 0 because printing succeeded.
- **The JSON shapes are public API from the first release.** Adding a field is
  fine; renaming one is a breaking change. That is a real constraint and it is
  cheaper to accept now than to discover when something depends on it.
- **`dbmd studio` is the odd one out** and always will be: it is long-running,
  it binds a port, and it is for a human. It is still bound by rules 1 and 2, so
  a script can start it, read the URL from stdout, and drive it.
- Determinism forbids some pleasant things, such as putting the generation time
  in the exported diagram. That is a fair trade for a file that only changes when
  the model does.

## Revisit when

- **A caller needs streaming progress**, at which point line-delimited JSON on
  stderr is the shape to reach for, and rule 1 is what makes that possible
  without disturbing anyone.
- **The JSON contract needs a breaking change.** Then it needs a version field
  in the output before it needs the change, and that is worth noticing early.

## Amended by dbmd-35, once `dbmd studio` was a command somebody could script

The consequence above says a script can start the studio, read the URL from
stdout, and drive it. **The URL is on stderr.** Rule 1 has not moved: what moved
is the recognition, in ADR 0011, that the bound URL is narration rather than
data, so it goes where narration goes. ADR 0011 put every write behind one
module and gave `startStudio` a `log` that defaults to `narrate`, and that
default is the line the studio prints. What it did not do is say what that meant
for this sentence, which is why this paragraph exists rather than a footnote
there.

What a script does instead: start `dbmd studio --no-open`, read **stderr** for
`http://127.0.0.1:<port>/`, and drive that. `--port 0` is the default, so with
no `--port` that line is the only place the real port exists, and a script that
discards stderr has thrown away the address of the thing it just started. A
script that would rather not scan for a URL passes `--port` itself and knows the
answer before it starts.

`--json` does not answer this, and saying so is the honest half of the
amendment. The studio honours it, but a report is one value a command produces
when it has finished, so the payload, which carries the directory, the url, the
port and the signal that stopped it, reaches stdout only once the server has
stopped. That is no use to a caller that wants the port while the server is
running, and that caller reads the stderr line.

The gap between those two, structured narration while a long-running command is
still running, is this record's own "Revisit when" about streaming progress:
line-delimited JSON on stderr. It is a decision rather than a detail and it is
not taken here.

## Amended by dbmd-d23, once somebody went looking for the third shape

Rule 3 says the shape is documented and versioned. Versioned was true throughout:
every payload carries `schema: 1`. Documented was true for two of the three. On
2026-09-07, `dbmd check --json`'s shape was shown in `README.md`, `docs/format.md`
and `docs/import-format.md`, and `dbmd import --json`'s in
`docs/import-format.md`. `dbmd export --json`'s was shown in neither `README.md`
nor anything under `docs/`.

What did exist was a list of its field names, in ADR 0023's consequences, written
the commit its payload became public API. That is a record of a decision rather
than documentation of a shape, and this project documents a shape by showing it.
Six of that payload's eight keys appear in no other command's, so there was
nothing a reader could infer it from either.

**The shape is now shown in `docs/ci.md`**, and not beside the `check` shape in
`README.md`. That placement is the part worth writing down. `written` is how a
caller tells "the diagram changed" from "the diagram was already right", which is
a question a pipeline asks and which a person at a terminal reads off the
`Wrote ...` line instead. `docs/ci.md` is the page that caller reads, and it
already carried a recipe that runs export. Rule 3 has not moved: the shape is
documented, and which page shows it is a matter of who goes looking. ADR 0043's
rule that a command owes `README.md` an entry is about the command existing
rather than about where each of its payloads is shown, and `dbmd export` has its
entry.

**`refs` and `query` were checked while this was open, and both already take
`--json`.** dbmd-d23 said neither did. `dbmd refs <table> --json` reports
`incoming` and `outgoing` whichever direction flag was given, which `README.md`
describes in prose, and `dbmd query --engine <id> --json` reports the SQL as a
value on the report. So rule 3's "every command that reports anything" is not
overstated by those two, and no flag was added to settle anything. Neither of
those two shapes is shown anywhere, which is the same gap this amendment closed
for `export`, left open rather than closed by guessing at a page for it.

No new record was taken for any of this. Nothing was decided that ADR 0023 had
not already decided about the payload, and the one new choice, which page shows
it, is a correction to this record's own claim and belongs here.
