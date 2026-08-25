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
