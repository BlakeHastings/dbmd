# 0012. `dbmd init` scaffolds through the writer, not from a template

## Context

`dbmd init` has to put a small example model on disk, and the obvious way to do
that is a folder of `.md` templates, or a few template strings, copied into
place. It is less code than building a `Model` value and it is what most
scaffolding commands do.

It also makes a second speller of the format. `src/model/write.ts` is currently
the only thing that knows how a model file is written: which keys exist, how a
string is quoted, that nullability is spelled `null`, that a layout is flow
style on one line. A template knows all of that too, in prose, where no type
checks it and no test compares it. The first key that gets renamed leaves the
scaffold writing a file that the reader diagnoses, and the person who sees it is
a new user on their first command.

This is not hypothetical. The frontmatter format was being changed in the same
week this command was written.

## Decision

`dbmd init` builds a `Model` value and hands it to `writeModel`. The example
lives in `src/cli/example.ts` as typed data: tables, columns, refs, a note, and
the prose bodies. No YAML is written by hand anywhere outside `src/model/`.

The property this buys is that the scaffold is canonical by construction, and
that is testable rather than asserted: `readModel` over what `init` wrote
produces no diagnostics, and writing the model back over it writes nothing,
because every file is already byte-identical to what the writer would produce.
A format change that the scaffold does not survive breaks the type check or that
test, on the branch that made the change.

## Consequences

- The example is a value, so prose lives inside a TypeScript string literal and
  backticks in it need escaping. That is the cost, it is paid once, and it is
  smaller than the cost of a scaffold that drifts.
- Anything else that produces model files, an importer especially, has the same
  obligation for the same reason. Going through `writeModel` is the rule, not a
  preference of this command's.
- A test that asserts the exact bytes `init` writes would be asserting the
  writer's canonical form twice. It asserts the round trip instead, which is the
  property that actually matters.

## Revisit when

- Someone wants `init` to write a file that is not part of a model, a
  `.gitattributes` or a README beside the model directory. That has no writer to
  go through and needs a template; the rule above is about model files.
