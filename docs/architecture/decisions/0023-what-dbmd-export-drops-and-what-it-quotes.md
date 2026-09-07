# 0023. What `dbmd export` drops, and what it quotes

## Context

The whole argument of this project is that the model is markdown so the diff is
the review. That argument only reaches a developer who reads YAML. GitHub
renders mermaid inside markdown, so a diagram committed beside the model turns
a changed table into a changed picture inside the pull request, with nobody
installing anything, and that is the cheapest answer available to "so other
devs can see".

Three things about it are decisions rather than details, and each one has a
wrong answer that looks fine in a diff.

**Mermaid's ER syntax is fussy about names, and the failure is invisible.**
Every other failure in this repository is loud: a file that does not parse gets
a diagnostic, a write that fails throws. A table called `order-items`, or a
column called `order date`, or a table called `style`, produces valid-looking
text that mermaid refuses, and what GitHub shows is a blank box. No error
reaches the author of the model, the author of the export, or the reviewer of
either. Measured against mermaid 11.17:

- A bare entity name may not contain a space, and may not be `style`, `class`,
  `erDiagram`, `one` or `to`. **Quoted**, `"order items"` and `"style"` and
  `"order-items"` all parse, and so does every character tried, including a
  quote written as mermaid's own `#quot;`.
- An attribute row has **no quoted form at all**, in either the type or the name
  position. `uuid "order id"` is a parse error exactly as `uuid order id` is. A
  space, a leading digit, and the words `pk`, `fk` and `uk` are what a real
  column name runs into.
- An attribute's **comment** is quoted and takes anything.

**A model carries things `erDiagram` has nowhere to put.** Sticky notes,
grouping boxes, layout coordinates, prose bodies, nullability, defaults, and
every index that is not a single-column unique one. A picture that quietly drops
the grouping box is trusted more than it should be, because a reader has no way
to tell a model with no groups from a diagram that did not draw them.

**A large model produces an unreadable diagram.** Mermaid does its own layout,
and past a few dozen tables the result is a wall.

## Decision

**Quote everything mermaid lets us quote, and rewrite what it will not.** An
entity name and a relationship label are always quoted, whether or not they look
dangerous, because the alternative is a list of reserved words kept in step with
mermaid's grammar by hand, and the day that list falls behind a release is a day
nobody finds out. `#`, `"`, `<` and `>` become mermaid's entity escapes, `#`
first so that the escape this writes is not read as one the name already had; a
control character becomes a space, because it has no legible rendering and a
diagram is a thing people look at.

A column's type and name have no quoted form, so a character mermaid will not
take is replaced with `_`, a leading digit and an empty word gain a leading `_`,
and a name that is a key marker gains a trailing one. **That changes what the
picture says, so where it happens the true `type name` is emitted as the row's
comment**, which mermaid renders in its own column beside the rewritten one.
Nothing is silently different: the rewrite is visible in the same box as the
thing it rewrote.

A comma survives in a type and not in a name. What follows a name is an optional
comma-separated list of key markers, so a comma there is ambiguous, and nothing
follows a type that a comma could belong to. It is worth the one exception:
`numeric(10,2)` is what half the columns of a real SQL Server model are typed
as, and rewriting every one of them would put a comment on every row.

**What is dropped is named in the generated file**, in a paragraph under the
diagram, rather than in a doc page. The person who needs it is reading the
rendered README on GitHub and has no reason to go looking, and a reader who is
told the notes and the groups are missing stops mistaking the diagram for the
model. The same paragraph says the model is the source.

**A unique index over an expression marks nothing**, and that is in the
paragraph too, because it is the one omission a reader would otherwise read off
the diagram wrongly: they can see `unique: true` in the model and no `UK` on the
column they expected it on. ADR 0022 made an index key a column name or
`{ expression: ... }`, and only the first is a column of the table.
`unique (lower(email))` constrains the lower-cased value and leaves `email` free
to repeat in another case, so a `UK` there would be a claim nobody made;
`src/model/validate.ts` reaches the same conclusion, for the same reason, when
it decides whether a `ref` target identifies one row. There is nowhere in an
`erDiagram` to draw the expression itself, so it is dropped rather than
approximated.

**The unreadable-at-scale problem gets a sentence and not a layout algorithm.**
The work item proposed this and it is the right call: laying out an ER diagram
better than mermaid does is a project, the studio already exists for the case
where somebody needs to move things around, and this command's job is the pull
request. The sentence is in the same paragraph.

**A model with an error in it is refused rather than drawn.** `readModel` and
`validate` are both run, exactly as `dbmd check` runs them, and any diagnostic
of severity `error` exits `1` and writes nothing. A file that did not parse is
missing from the model rather than reported by it (ADR 0008), so a diagram drawn
over it is missing a table and says so nowhere; a `ref` at a table nobody wrote
would have mermaid invent an entity that is not in the model. Both are the same
failure this record is otherwise about, arriving through the model instead of
through the grammar. Warnings print nothing and stop nothing.

**The diagram lives between two markers in `db-model/README.md`, and the rest of
that file belongs to whoever wrote it.** `<!-- dbmd:diagram -->` to
`<!-- /dbmd:diagram -->` is replaced on every run; bytes outside the pair are
copied, line endings included, for the reason `src/model/write.ts` gives about a
prose body. A file with neither marker gets the section appended rather than
replaced. A file with one and not the other is an error rather than a guess: it
is the one case where the command cannot tell which half of the file is its own.

**A file that is already right is not written**, which is the property
`writeModel` already has for the same reason. A tool that touches a file it did
not need to touch puts noise in a diff.

## Consequences

- **`dbmd export --json`'s payload is public API from this commit**, per ADR
  0006: `directory`, `format`, `file`, `written`, `tables` and `relationships`,
  inside ADR 0011's `{schema, ok, ...}` envelope, with
  `error.code` of `model-has-errors` or `markers-unbalanced` on the two ways it
  fails. `file` is slash-separated on every platform, because a path that
  differs between two machines is ADR 0006 rule 4 broken by `path.join`.
- **`--stdout` and `--json` cannot be used together**, and that is a usage
  error rather than a precedence rule. ADR 0011 says stdout carries exactly one
  thing per run; `--stdout` puts the document there and `--json` puts the report
  there, and a caller that got both would have to split the stream by guessing.
- **Refusing to draw a model with an error will annoy somebody**, and the
  counter-argument is real: a tool that will not draw a picture because one ref
  is wrong is a tool people route around. It is taken anyway, because the
  routing-around here is `dbmd check`, which is one command away and says
  exactly what is wrong, and because a diagram that is quietly missing a table
  is this record's whole subject.
- **The rewrite rule is measured against a mermaid version rather than derived
  from a grammar.** A future mermaid that narrows what it accepts breaks
  diagrams that are already committed, and nothing here would notice. The
  evidence would be a rendered blank box reported by a user; the answer is to
  narrow the allowed set, which costs comments on more rows and breaks nothing.
- **Nothing verifies the emitted mermaid actually parses.** There is no mermaid
  parser in this repository and adding one is a browser-sized dependency for a
  tool people run with `npx`. The tests assert the shape that was measured to
  work, and the shape was measured by rendering both `examples/shop` and a model
  of deliberately awkward names in a real browser.

## Revisit when

- **A second format is wanted.** The markers, the splice and the
  write-only-if-changed rule are not about mermaid and would move; the quoting
  is. `--format` already exists and already refuses everything else, so the
  shape of that change is known.
- **Somebody wants the diagram somewhere other than `db-model/README.md`.** The
  repository root README is the obvious ask. `--stdout` answers it today by
  redirection, and the moment it does not is the moment an `--output` flag is
  worth its documentation.
- **A rendered blank box is reported.** That is the evidence that the allowed
  character set has drifted from what mermaid takes, and it is the only evidence
  this design can produce, which is why the set is deliberately narrower than
  what was measured to work.
- **A model gets big enough that the diagram is useless.** The sentence stops
  being an answer when somebody has to scroll past it. Splitting by group is the
  first thing to try, and it is a decision of its own because a group is
  something this diagram currently drops.

## Amended by dbmd-c9h, once a ref could carry `on delete` and `on update`

ADR 0046 gave a `ref` two more facts, `on delete:` and `on update:`, after the
paragraph above was written, and the diagram drops them the way it already
drops nullability and a default: silently. `examples/shop`'s
`order_items.order_id` carries `on delete: cascade`, and
`dbmd export --stdout examples/shop` renders that relationship as
`"orders" ||--o{ "order_items" : "order_id"`, with no mention of `cascade`
anywhere in the diagram or in the paragraph naming what it dropped. The list
above was incomplete rather than the export: **a model carries things
`erDiagram` has nowhere to put, and a ref's `on delete` and `on update` are two
more of them**, filed beside the nullability and the default already on that
list, the same two ADR 0046 pointed to as proof the format already carried
behaviour.

The diagram keeps dropping them on purpose. `erDiagram`'s only slot on a
relationship is its label, that label already carries the referring column a
reader needs to find the `ref` in the model, and crowding an action onto the
same line would make a worse diagram rather than a more complete one. Nothing
here reopens what the label says; a change to it is a different item and needs
its own owner.

The studio's canvas raises the same question and is not a third gap. Its edge
draws the relationship exactly as this diagram does, and its panel names the
action once the edge is selected, which is the split ADR 0035 already uses for
a group: the box is the overview, the panel is the detail. A reader who needs
the action opens the thing the overview points at, the same way they open a
table's panel to learn whether it joined a group.
