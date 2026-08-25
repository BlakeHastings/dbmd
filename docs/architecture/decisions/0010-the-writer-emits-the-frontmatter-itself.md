# 0010. The writer emits the frontmatter itself, and refuses more than it writes

## Context

ADR 0003 said the studio "writes frontmatter in a fixed key order with fixed
quoting, so a hand-written file normalises once and then produces no diff on
later saves", and said in the same paragraph that until the item building it
landed, that was an intention rather than a property. dbmd-11 is that item, and
building it turned one sentence into five decisions that the validator, the
studio, the CLI and the importer all inherit.

ADR 0008 deliberately left one of them open. The reader records the raw source
text of a scalar and does not record its quoting style, because "this is where
the canonical style is decided" and recording the author's style would have made
the writer preserve it, which is the opposite of canonical.

ADR 0008 also settled that a file which fails to load is missing from the model
rather than approximated. It did not say what happens to a file that *partly*
loads, and that gap is where the one destructive mistake in this whole module
lives.

## Decision

**The frontmatter is emitted as text, not through a YAML emitter.** `yaml` stays
the parser, so there is one parser and one place that knows what `null:` means.
It is not the emitter. An emitter is built to be helpful: it reflows, it folds a
long scalar at a line width, it drops quotes it judges unnecessary, and it
changes any of those between releases. Every one of those turns a stable file
into a churning one, and the churn is invisible until somebody opens a pull
request full of layout lines. Bending `yaml` into determinism means building the
document node by node and setting a style flag on each scalar, which is more
code than emitting the text and still leaves the library's defaults in the path.
The key set is fixed and about a dozen wide. Emitting it is a page of code.

**Canonical is: LF, two-space indent, keys in declaration order, flow style for
`layout` and for an index's `columns`, an omitted key rather than an empty list,
and double quotes when quotes are needed at all.**

```markdown
---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    pk: true
  - name: status
    type: text
    null: false
    default: "'pending'"
indexes:
  - name: orders_status_idx
    columns: [status]
group: billing
layout: { x: 480, y: 120 }
---
```

A scalar is written plain only when nothing about YAML's resolution can turn it
into something other than the characters it is made of, and double-quoted
otherwise. So `text` stays `text` and `numeric(12,2)` stays `numeric(12,2)`,
while `null`, `1`, `on` and `'pending'` are quoted. The rule is deliberately
conservative in two places: it quotes YAML 1.1's booleans, which this project
does not emit a directive for but other people's tools still read, and it quotes
anything containing a colon or a hash rather than reasoning about what follows
them. Quotes are always double because it is the one style with an escape for
every character, so there is never a second question about how a value should
have been written.

**The body is copied and the frontmatter is generated, so their line endings can
differ.** ADR 0003 requires the prose to survive byte for byte, carriage returns
included. The model does not record which line ending a file arrived with, and
inventing one would make two machines produce different bytes for the same
model, so generated lines are LF. A wholly CRLF file therefore normalises its
frontmatter on the first save, keeps its body exactly as it was, and never moves
again. Nothing is added to a body either: a file that ended without a trailing
newline still does.

**An object carries whether its file was fully read, and the writer refuses an
object that was not.** The reader drops what it could not understand, so writing
the model back over such a file deletes the very lines its author has to fix,
and that is the only thing the writer does that reading the file back cannot
undo.

`CanvasObject.complete` and `Model.complete` are `false` when the reader raised
an error while building that object from its file. The obvious alternative was
to hand the writer the diagnostics from the read, and it was wrong for two
reasons that only show up later. It is optional at the call site, so the safe
call is the one you have to know to make and the destructive one is the default;
and the studio saves on every drag with a model that has travelled through an
HTTP layer, where a separately carried diagnostics array is exactly the thing
that gets dropped. A flag on the object goes wherever the object goes.

The field is required rather than optional, so a model built from scratch by an
importer or a test has to say `complete: true` out loud. An omitted field would
mean safe-looking and destructive, which is the shape this replaced.

The boundary is "an error raised while building this object from its file",
which is narrower than "an error against this path" and is the honest line: it
means the file holds something the object does not. An error raised anywhere
else is about the model rather than about the file. `group: shipping` naming no
group file is the case that separates them: everything the file says reached the
object, so saving it loses nothing and it is not blocked.

A warning does not block a write: a warning means the file loaded, and
normalising it is the point. The consequence to accept is that a key dbmd does
not know is a warning and is therefore dropped on the first save. ADR 0008
already names carrying unknown keys as the way out, and it is a feature rather
than a writer bug.

**The writer never deletes.** "In the directory but not in the model" cannot be
told apart from "broken", because a file that failed to parse is missing from
the model by ADR 0008. Deleting on that basis throws away the file the user is
trying to see the error for. Removing an object is a separate, deliberate act.

**Every write is a temporary file in the same directory renamed over the
target.** The studio saves on every drag. A `writeFile` interrupted halfway
leaves a truncated model file whose only backup is a commit that has not
happened yet. And a file is only written when its rendered text differs from
what is on disk, which is what keeps a group drag to the members that actually
moved.

## Consequences

- **Two properties are testable and are tested.** `parse(serialise(m))` equals
  `m` for every model, and `serialise(parse(f))` is byte-identical for every
  canonical `f`. `test/fixtures/canonical/` is a ten-table model written by the
  writer, so property 2 is "the writer has nothing to say about any of these
  fifteen files"; `test/fixtures/untidy/` is the same model hand-written badly,
  so the first save rewrites all of it and the second writes nothing.
- **The quoting rule is a compatibility surface.** Loosening it later, so that
  fewer values are quoted, rewrites files across every repository using dbmd on
  the next save. Tightening it does the same. Either is a real change to make
  deliberately rather than as a side effect of tidying the predicate.
- **A hand editor's style is not preserved.** Somebody who writes
  `default: 'false'` gets `default: "false"` back on the next studio save. That
  is the deal ADR 0003 struck and it only pays off because it happens once.
- **The writer throws where the reader diagnoses.** A filesystem that will not
  accept a write is not a fact about the model, and a caller that carries on
  regardless has told the user their work is saved when it is not.
- **`writeModel(dir, model)` takes no options at all.** There is nothing to
  remember and therefore nothing to forget. That is the property being bought,
  and it is worth a required field on every object to get it: the writer has
  exactly one call shape and it is the safe one.
- **A model built by hand can hold things the format cannot.** A table layout
  with a `w`, or an object whose name is not a file name. The first is dropped,
  because ADR 0005 says a table's size is computed; the second is refused and
  reported. Neither can arrive from the reader.

## Revisit when

- **`serialise(parse(f))` starts failing on a file somebody wrote by hand and
  believed was canonical.** That is the quoting rule being more surprising than
  it is worth, and the answer is to narrow it at a named case rather than to
  loosen it generally.
- **Somebody wants a save to preserve their file's CRLF frontmatter.** The way
  out is for the reader to record the line ending as a property of the file, and
  it costs the guarantee that the same model produces the same bytes everywhere.
- **Dropping an unknown key on save bites a real user.** Then carrying unknown
  keys through the model, which ADR 0008 already anticipated, stops being
  optional.
- **Deleting becomes something a caller needs.** It belongs in whatever removes
  an object, with the model's diagnostics in hand, and not in a function whose
  job is to write.
- **`complete` starts meaning more than one thing.** It answers exactly one
  question, which is whether writing this object back would lose what the file
  says. The moment somebody wants it to also mean "this object is valid" it has
  become two fields wearing one name, and validation is dbmd-12's.
