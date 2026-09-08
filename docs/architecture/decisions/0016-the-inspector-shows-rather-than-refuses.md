# 0016. The inspector shows what is wrong and writes it anyway

Refines ADR 0004, which decided the studio is a view onto files with no
document, no Save button and no undo of its own, and ADR 0013, which decided
what the server will write on its behalf. This is what building the panel that
edits a table's contents turned out to require.

## Context

Until this item the page could do one thing: drag a box. Everything else about
"the studio is an editor" was a sentence in ADR 0004 rather than a thing that
had been built, and building it asked four questions that record 0004 had no
reason to answer yet.

**What happens when a field holds something the model should not.** A drag
produces two numbers and cannot produce a bad one. A form produces a column with
no name, a second column called `id`, and a `ref` at a table nobody has written
yet, and it produces them constantly, because that is what a half-finished
thought looks like in a text box.

**When the developer is told.** The page had one source of complaint, the
diagnostics the server sent with `/api/model`, and they are computed when the
directory is read. So an edit that broke a ref was invisible until a write
landed, a re-read happened and something refetched.

**What a rename is.** Nothing in the format's model of an edit is
cross-file. Every other change is one file, and a table's name is in three
places at once: its file name, its `table:` key, and every `ref:` that points at
it, which live in other people's files and therefore other people's diffs.

**Whether a widget is allowed to change a file.** A `<textarea>` normalises line
breaks to LF by specification. The format carries a body byte for byte. Those
two facts, put together without noticing, turn one typed word into a whole-file
diff.

## Decision

**The inspector shows problems. It does not prevent them.** A column with no
name is written as one, a duplicate column name is written twice, and a `ref` at
a table that does not exist is written as it was typed. Each is named in the
panel, next to the field or in the diagnostics list, in the words dbmd would use
about the file. This is a modelling tool, a model is half-written for most of
the time anybody is writing it, and a broken ref is a diagnostic rather than a
thing to prevent. The work item said so and it is the right rule: an editor that
refuses the intermediate state is an editor you cannot think in.

There is exactly one exception, and it is a shape problem rather than a
judgement: a `ref` field holding `customers` names no column, so there is no
`{table, column}` to send. The panel keeps the text, says the ref is not being
saved, and saves the rest of the column. Guessing a column half would write a
ref the developer did not ask for.

**The validator runs in the browser, over the model the page holds.** ADR 0017
made `validate` a function of a `Model` and nothing else: no directory, no file
handles, no reader diagnostics. That is exactly the shape that runs anywhere,
and the page already holds a `Model`, so it runs there. A ref typed at a table
that does not exist is named on the keystroke rather than after a write, a
re-read and a refetch.

The two halves of the diagnostics list now come from two places and go stale
differently, which is the reason to keep them apart rather than an argument
against it. The reader's diagnostics are about bytes on disk and change only
when a file does, so the last read's answer is still true and the page keeps it.
The validator's are about whether the model agrees with itself, which is
precisely what an edit changes, so the page recomputes them and never asks the
server for them.

This does not make the validator a client-side validator. It is the same
function, over the same type, and the server will run it too when `dbmd check`
exists. What the page has is an earlier copy of the answer.

**A rename is composed from the routes that already exist, and it says what it
is about to do first.** The server has create, patch and delete (ADR 0013) and
no rename. It does not need one: a rename is create the new file, move every
`ref` onto it, delete the old one, in that order, which is the order that never
leaves a ref pointing at nothing. The panel names every file it is about to edit
and every column it is about to move, and waits to be told to go.

It is deliberately not one endpoint. A rename touches several files and is
several writes whichever layer composes it, so an endpoint would buy atomicity
and nothing else, and would put a model-wide operation behind a route whose
whole contract so far is "one object, named, never a path". Where it is not
atomic is real and worth knowing: a failure between the steps leaves both files
on disk, which is a state `git status` shows and `git checkout` undoes, and ADR
0004 already says git is the undo.

**A field's conversions are a module with no DOM, and the DOM is proven by
driving it.** `fields.ts` holds the line-ending restoration and the `ref` split;
`model.ts` holds the question "what points at this". They are string functions
with unit tests, and the panel itself has none, for the same reason `canvas.ts`
has none under ADR 0015: a test double for an input event proves that the double
works.

## Consequences

- **The page bundles `validate.ts` and `diagnostics.ts`.** That is about three
  hundred lines of arithmetic over the model, no imports of its own, and no
  Node. The alternative was a second copy of the same rules written for the
  browser, which is the thing ADR 0017 spent a page arguing against.
- **A CRLF model gets its frontmatter canonicalised on the first save and its
  body never.** That is the writer's existing behaviour and `docs/format.md`
  already documents it; what this record adds is that the panel does not make it
  worse. Measured on Windows: the first prose edit to a CRLF file rewrites the
  twelve frontmatter lines to LF once, and every edit after that is one changed
  line with the body's carriage returns intact.
- **A rename that fails halfway leaves two files.** Named above; the interface
  says which files it is about to touch before it starts, so the state is one a
  developer can recognise.
- **Every structural click writes immediately.** Adding a column writes a column
  with no name and no type, because ADR 0004 says there is no unsaved state and
  this is what that costs. The panel says the column has no name; `git diff` says
  the same thing; neither is a surprise, and the alternative is a dirty state
  this studio has already decided not to have.
- **The panel is rebuilt on selection and on a structural click, and never on a
  keystroke.** So a field is never reformatted under a cursor. The cost is that
  a change made to a table from somewhere else while its panel is open is not
  reflected in the fields until it is reselected, which becomes real when the
  watcher lands.

## Revisit when

- **A rule the page needs is not one the validator has.** An empty column name is
  the live example: nothing in `ModelDiagnosticCode` covers it, so the panel says
  it in its own words next to the field. If a second and a third of those appear,
  the question is whether they are validator rules, and adding a code is a change
  to a public contract (ADR 0014) rather than something a panel decides.
- **The watcher lands (dbmd-33).** Then a table can change under an open panel,
  and "never redraw the fields" becomes "never redraw the fields the developer is
  in", which is a different and harder sentence.
- **Something other than a table gets a panel.** Notes and groups are dbmd-34.
  A note's body is the same textarea and the same line-ending rule, which is the
  first sign that `fields.ts` is the right seam.
- **A rename becomes something two people can race.** ADR 0013 already names the
  trigger for the model cache being one session's; a multi-file compose is the
  same trigger seen from the worst angle.

## Three of the four revisit entries have fired

Appended rather than edited, as part of a sweep of every record's **Revisit when**
list on 2026-09-07. Everything decided here stands: the inspector still shows
rather than refuses, the validator still runs in the browser over the model the
page holds, a rename is still composed from the routes that already exist and
still says what it is about to do, and `fields.ts` still has no DOM in it.

### "The watcher lands (dbmd-33)"

It landed. `src/studio/watch.ts` is the watcher and ADR 0019 and ADR 0061 are the
records of what it does. So "never redraw the fields" did have to become "never
redraw the fields the developer is in", and it did.

Driven in this worktree on 2026-09-07, against a copy of `examples/shop` in a
temporary directory. With `customers` selected, its body textarea holding 1581
characters and the caret parked at offset 392 after typing into it:

| what changed on disk | textarea length | caret | still focused | panel heading |
| --- | --- | --- | --- | --- |
| nothing yet | 1581 | 392 | yes | `customers` |
| `tables/products.md` gained a column | 1581 | 392 | yes | `customers` |
| `tables/customers.md` gained a column | 1581 | 392 | yes | `customers` |

and after each of the two the status line read *"The model changed on disk. This
page is still showing what you were working on, and will catch up when you are
between edits."* The canvas did not redraw either, which is the same sentence
being honest: the page holds the read while an edit is unwritten rather than
redrawing everything except the field. `verified.md` records the same behaviour
from the other end, where an edit made outside reaches an open page in three
seconds when nothing is pending.

So the harder sentence this entry predicted is written and is built, and the
consequence above that says "a change made to a table from somewhere else while
its panel is open is not reflected in the fields until it is reselected" is
still true and is now a stated behaviour with a sentence attached rather than a
silence.

### "Something other than a table gets a panel"

Notes and groups both have one, from dbmd-34, and ADR 0013's own first revisit
entry fired with this one. Read off the running page:

| panel | fields | textareas |
| --- | --- | --- |
| note | `color`, `body`, `layout` | 1 |
| group | `label`, `color`, `members`, `body` | 1 |

`verified.md` records a note's 764 character body being typed into through that
textarea and reaching the file byte for byte, LF endings and all. That is this
entry's prediction word for word: the same textarea, the same line-ending rule,
and `fields.ts` is the seam all three kinds go through.

### "A rule the page needs is not one the validator has"

This one fired and has already been answered, from a direction the entry did not
look in.

**A second and a third did appear.** The panel now says three things in its own
words rather than one: a column with no name, an index with no name, and an index
that names no columns. The entry says that when a second and a third turn up, the
question is whether they are validator rules.

**The answer is that all three are already rules, and they are the reader's.**
The entry says nothing in `ModelDiagnosticCode` covers an empty column name. Since
ADR 0027 something does: `empty-value`, a warning. `src/model/read.ts` raises it
through `reportBlank` for a required string that arrived saying nothing, which
covers a column with no name and an index with no name in the same call, and
separately for an index whose `columns:` list is empty. So every sentence the
panel says in its own words now has a diagnostic behind it, and none of them is a
validator rule, because none of them is a question about whether the model agrees
with itself.

**The duplication stays, for the reason this record already gives.** The reader's
diagnostics are about bytes on disk and arrive after a write and a re-read; the
panel's arrive on the keystroke, beside the field, on a column that was created
blank one click ago. What has to be corrected is the entry's premise rather than
the design: "nothing in `ModelDiagnosticCode` covers it" was true when it was
written and is not true now.

**The fourth entry has not fired.** A rename is still one session's, because the
studio is still one loopback session with no authentication.
