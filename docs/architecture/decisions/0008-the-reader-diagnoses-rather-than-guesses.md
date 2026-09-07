# 0008. The reader diagnoses rather than guesses

## Context

ADR 0003 chose markdown with YAML frontmatter and ADR 0005 put a directory per
kind under the model root. Neither says what happens when a file does not match,
and there are more ways for that to happen than the format suggests, because
YAML resolves scalars before anyone gets to look at them. `null: false` is a key
whose value resolves to null. `default: 'pending'` and `default: "'pending'"`
are different SQL. `type: on` is a boolean in YAML 1.1. Every one of those
produces a model that is wrong and looks right.

Three questions had to be answered to write `readModel`, and they are answered
here rather than in the code alone because the writer, the validator, the studio
and the exporter all inherit them.

## Decision

**The file's name is the object's identity, and the frontmatter cross-checks
it.** ADR 0005 already forced this for groups: `group: billing` resolves to
`groups/billing.md`, and a group file has no name key to resolve against. Tables
follow, so `ref: customers.id` resolves the same way. A `table:` that disagrees
with the file name is a diagnostic and the file name wins. `kind:` works the
same way against the directory, as 0005 said, with one addition: a file whose
`kind` disagrees with its directory does not load at all, because reading a
table's keys as a note produces a page of secondary complaints that bury the
one-line fix.

**A diagnostic is structured output, so its shape is a contract.** `code`,
`severity`, `path`, an optional 1-based `line`, and `message`. `path` is relative
to the model directory and slash-separated, and no diagnostic carries an
absolute path, a timestamp or a duration. They sort by path, then line, then
code, then message. `dbmd check --json` will emit these directly, which under
ADR 0006 makes adding a code fine and renaming one a breaking change. `message`
is the half that is free to be reworded.

**Where the format expects a string, the reader asserts a string arrived.** A
value that YAML resolved to a boolean, a number or null is a diagnostic naming
the characters the author typed, never a coercion. Map keys are read from their
source text when they are plain, which is what makes `null:` a key named `null`.
`readModel` returns a model and a list of diagnostics and never throws, because
the studio has to show a broken file rather than fail to start and `dbmd check`
has to report every problem in one run.

## Consequences

- **A file that fails to load is missing from the model, not approximated.** No
  table is invented from a file name, and no group is invented from a `group:`
  key that names nothing. `dbmd check` reports what was wrong; it does not
  quietly repair it.
- **A file in a kind directory with no frontmatter at all is a diagnostic.**
  It is a plain markdown file that happens to be in the directory, and the
  directory says it should be an object, so saying so is the only honest move.
  Absent, empty and unterminated frontmatter are three different codes because
  they are three different mistakes.
- **The parser has to expose raw scalars and their quoting**, which rules out
  anything that hands back plain JS values. `yaml` is the dependency that buys
  this; a `JSON.parse`-shaped YAML parser would make half of the above
  undetectable.
- Reading is stricter than a hand editor might like. A misspelled key is a
  warning rather than silence, which means a model written by a later version of
  dbmd warns when read by an earlier one. That is the right direction to be
  wrong in.

## Revisit when

- **A warning fires often enough that people stop reading warnings.** The
  unknown-key warning is the likely candidate, and the answer is a way to carry
  keys dbmd does not know rather than a quieter default.
- **Somebody wants `readModel` to repair a file.** That is a `dbmd fix` command
  writing a diff a human approves, not a reader that guesses.

## Amended by 0014

The clause above that fixes the diagnostic's shape as `code`, `severity`,
`path`, an optional 1-based `line` and `message` is superseded. The fields are
now `code`, `severity`, `at` and `message`, where `at` is a discriminated
location: a file with an optional line, or a JSONPath into a document. The
reason is that the import contract diagnoses a JSON value that has no lines to
point at, and one `path` field covering both would be a field that means two
things. Everything else here stands, including that the shape is a contract,
that a list of them sorts deterministically, and that `message` is the half free
to be reworded. ADR 0014 has the argument.
