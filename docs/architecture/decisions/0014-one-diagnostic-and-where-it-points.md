# 0014. One Diagnostic, and where it points

## Context

There were two `Diagnostic` types. `src/model/types.ts` had one for reading a
`db-model/` directory and `src/import/diagnostics.ts` had one for reading an
introspection file. Two agents working in parallel, neither able to see the
other, arrived at nearly the same shape: a `code`, a `'error' | 'warning'`
severity, a `message`, a location, and a code-unit sort. That they converged is
evidence the shape is right. That there were two of them is the problem, and it
is a problem with a deadline.

ADR 0006 makes structured output a public contract the moment `--json` prints
it, and 0008 already said a diagnostic is structured output. `dbmd check` does
not exist yet, the output contract is being built now, and nothing has shipped.
Unifying today costs a morning. Unifying after `dbmd check --json` ships is a
breaking change to a documented format. There is also a third consumer that
nobody planned for: the studio server sends diagnostics to a web page over HTTP
and the page renders them, so the type already crosses a process boundary, which
is most of what made it a public contract in the first place.

The one real disagreement between the two types is **where a diagnostic points**.

- The model reader points at a file: a slash-separated path relative to the
  model directory, with an optional 1-based line.
- The import contract points into a JSON document: a JSONPath rooted at `$`,
  with no line, because the input is a value dbmd was handed and dbmd never saw
  its lines.

Both are right for their own input, and `dbmd check --json` will emit both. A
single `path: string` covering both would be a field that means two things, and
the second reader of that field cannot tell which one they have. That is worse
than two types, because two types at least fail to compile.

## Decision

**One `Diagnostic`, in `src/diagnostics.ts`, for the whole tool.** The model
reader and the import contract both import it. `src/model/types.ts` and
`src/import/diagnostics.ts` re-export it so their own callers do not have to
learn a new import path, and neither of them defines it.

**Where it points is a discriminated union, not a string.**

```ts
export type DiagnosticLocation =
  | { readonly in: 'file'; readonly path: string; readonly line?: number }
  | { readonly in: 'document'; readonly jsonPath: string }

export type Diagnostic = {
  readonly code: DiagnosticCode
  readonly severity: Severity
  readonly at: DiagnosticLocation
  readonly message: string
}
```

`Diagnostic` is a type alias and not an `interface`, which is load-bearing
rather than a style choice. ADR 0011 gave the CLI a `Payload` whose values must
be `JsonValue`, and TypeScript grants an object type alias an implicit index
signature while never granting one to an interface. An interface with exactly
these fields cannot be handed to `report({ json })`. A diagnostic is a thing
that goes in the `--json` envelope, so it has to be a type the envelope accepts,
and a test asserts the assignment rather than leaving it to the next person to
rediscover.

`at.in` is the discriminant and the whole API for this question. A consumer that
wants to print a location calls `locationText(d.at)` and never asks. A consumer
that wants to do something a location affords, such as opening an editor at a
line or highlighting a node in a JSON view, branches on `at.in`, and the type
makes it: there is no way to reach `line` without having established that this
is a file, and no way to reach `jsonPath` without having established that it is
not. The studio's page has exactly one such branch and it is three lines.

**The code sets stay separate and meet in one union.**
`ModelDiagnosticCode | ImportDiagnosticCode` is `DiagnosticCode`. The import
codes keep their `import/` prefix, which is what lets a bare name in a mixed
array be read without knowing which module raised it. `docs/format.md` documents
the model half and its test reads `ModelDiagnosticCode` out of this file;
`docs/import-format.md` documents the import half.

**One sort, one severity, one message convention.** `compareDiagnostics` is
defined once: location, then line as a number, then code, then message. The
convention for a message is stated once, at the top of `src/diagnostics.ts`: one
sentence, lower case, no trailing full stop, legible without the file open. Two
messages in the reader broke it and were reworded, which ADR 0008 already
permits, since `message` is the half that is free to change.

## Consequences

- **`path` and `line` are gone from the top level of a diagnostic.** Every
  consumer moves to `at`, and there were four: the reader, the import contract,
  the studio's page, and the tests. Doing this after `--json` shipped would have
  meant a major version instead of a diff.
- **A mixed array sorts without the comparator knowing there are two halves.**
  A JSONPath begins with `$` and a model path begins with a file name, so the
  two blocks fall out of one byte-order comparison. That is a property of the
  data rather than a rule the comparator enforces, and if a third location kind
  ever wants to sort into a deliberate position, the comparator is where to say
  so.
- **A third location kind is now cheap and visible.** A diagnostic about a
  connection string, or about an argument on the command line, adds a member to
  the union, and every consumer that branches gets a compile error pointing at
  the place it has to decide. That is the point.
- **The two modules are coupled through one file.** `src/model/` and
  `src/import/` now share `src/diagnostics.ts`, so a change to it touches both.
  That coupling is the thing being bought: they were coupled already, through
  `dbmd check --json`, and the coupling was just invisible.
- **A diagnostic drops into ADR 0011's `--json` envelope unaltered.** A list of
  them is a `Payload`, so `dbmd check --json` is
  `output.report({ code, text, json: { diagnostics } })` and there is no
  translation layer between the reader and stdout. The price is that
  `Diagnostic` is a type alias forever; changing it back to an interface breaks
  that assignment, silently as far as this file is concerned, which is why the
  test exists.
- Nothing was added to what dbmd diagnoses. The codes and their meanings are
  exactly the ones that were there, and `docs/format.md`'s table did not change.

## Revisit when

- **A location wants to be a range rather than a point.** A column and an end
  line are what an editor integration would ask for, and they belong on the
  `file` member rather than on `Diagnostic`, which is the shape this makes
  possible.
- **A consumer starts switching on `code` prefixes** to decide what to do,
  rather than on `at.in`. That would mean the location union is not carrying
  something it should, and the fix is a field rather than a naming convention.
- **`dbmd check --json` needs a version field.** ADR 0006 already flags this,
  and the first breaking change to this shape is when it is needed rather than
  when it is nice.
