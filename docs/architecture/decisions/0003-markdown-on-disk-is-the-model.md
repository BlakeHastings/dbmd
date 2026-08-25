# 0003. One markdown file per table, and it is the model

## Context

The premise of this tool is that a team's database model belongs in their
repository, reviewable in a pull request, rather than in a hosted diagram that
drifts from the schema and from the code. Everything about the format follows
from what a pull request needs, which is not the same as what a diagram editor
needs.

Four requirements, in the order they bind:

1. **A one-column change is a one-line diff.** If it is not, review stops
   happening, and the format has failed at the only thing it was for.
2. **Layout noise must not read as a schema change.** Somebody dragging boxes to
   tidy a diagram must not produce a diff that looks like a migration.
3. **A hand edit must be as good as a studio edit.** Half the value is that a
   developer can fix a type in their editor without launching anything.
4. **The prose survives.** The *why* behind a table is the part no database
   introspection can recover, and it is why this is markdown rather than JSON.

The reference tool this came from stores the model in a hosted database and
treats documentation as a field. Reversing both is the whole point.

## Decision

**One markdown file per table**, under `db-model/` by default:

```
db-model/
  _model.md          model-wide facts: name, engine, and prose about the whole
  orders.md
  customers.md
  order_items.md
```

Each file is YAML frontmatter followed by free markdown:

```markdown
---
table: orders
columns:
  - name: id
    type: uuid
    pk: true
  - name: customer_id
    type: uuid
    null: false
    ref: customers.id
  - name: status
    type: text
    null: false
    default: "'pending'"
indexes:
  - name: orders_customer_status_idx
    columns: [customer_id, status]
layout: { x: 480, y: 120 }
---

One row per customer order. Rows are never deleted: a cancelled order keeps its
row with `status = 'cancelled'` so the finance export stays reproducible.
```

Four decisions inside that, each answering one requirement above:

**A file per table, not one file for the model.** Requirement 1. Two developers
editing different tables do not conflict, and a table's history is `git log` on
one path. The cost is that the model is a directory rather than a document, and
`_model.md` exists so there is still one place for what is true of all of it.

**A relationship is declared on the foreign key column, as `ref: table.column`.**
There is no relationship registry. A registry is a second place to forget, and
its diff shows a change nowhere near the column that changed. The cost is that
the reverse direction has to be computed, which is a load-time index and not a
format problem.

**Layout lives in the table's own frontmatter.** Requirement 2, and it is the
choice that will look wrong at a glance. A side-car layout file keeps schema
diffs perfectly clean but makes moving one box touch a file shared by everyone,
which is the conflict this format exists to avoid. In frontmatter, moving three
boxes touches exactly the three files whose boxes moved, and `git diff` shows a
single `layout:` line per file. A reviewer learns to skip that line in a week.

**The prose body is preserved byte for byte.** Requirement 4. The studio parses
frontmatter and treats everything after it as an opaque string. It is never
reflowed, never reformatted, never round-tripped through a markdown AST.

## Consequences

- **Canonical serialisation is load-bearing and must be tested, not assumed.**
  The studio writes frontmatter in a fixed key order with fixed quoting, so a
  hand-written file normalises once and then produces no diff on later saves.
  The invariant to hold in code is `serialise(parse(f)) === f` for any canonical
  file, and `parse(serialise(m))` deep-equal `m` for any model. The item that
  builds the parser owns those tests; until it lands, this paragraph describes
  an intention and not a property of this repository.
- **YAML brings YAML's traps.** `null: false` is a key named `null`, and a
  default of `'pending'` needs quoting to survive as SQL text rather than
  becoming the string `pending`. The parser rejects ambiguity loudly instead of
  guessing, because a silently-wrong default is worse than a failed parse.
- **This is a model, not a migration.** dbmd describes what the schema should
  look like and does not generate or apply DDL. Anything claiming otherwise is
  a bigger product with a different risk profile.
- Table files are flat, so two schemas with a table of the same name collide.
  Accepted for the MVP; a `schema:` key and subdirectories are the way out and
  the format leaves room for both.

## Revisit when

- **A single-table diff stops being readable**, most likely because column
  definitions grew past a line each. That is the signal the format is drifting
  toward a serialisation rather than a document.
- **Somebody wants two schemas, or two databases, in one repository.** Flat
  files answer neither.
- **Layout in frontmatter is observed causing a real review problem**, rather
  than an anticipated one. Then the side-car returns, with the conflict cost
  accepted knowingly.

## Extended by 0005, on the same day

Appended rather than edited, because the reasoning that turned out to be
incomplete is still worth reading.

This record assumed the only thing on the canvas was a table, and the owner named
sticky notes and grouping boxes on the day it was written. ADR 0005 extends the
format to hold them, and two things above are superseded by it:

- **Table files move to `db-model/tables/`.** The layout in this record is flat;
  0005 puts a directory per kind under the model root and requires a `kind:` key
  in every file as a cross-check.
- **"Table files are flat, so two schemas collide" is unchanged as a limitation**
  but the way out has moved: it is now a subdirectory question inside
  `tables/` rather than at the model root.

Everything else here stands, and 0005 is built on it rather than around it. In
particular, membership in a group is declared by the member for exactly the
reason a relationship is declared by the foreign key column: a registry is a
shared file, and a shared file is a merge conflict.
