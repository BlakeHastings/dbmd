# 0033. A composite foreign key is judged as a set, and the format still cannot name one

## Context

`dbmd import` landed in dbmd-41 and the first thing it does to a real database
is produce warnings nobody can act on. The SQL Server fixture is real catalogue
output. `sales.OrderLine` has a composite foreign key at `dbo.Order`, which the
format writes as one `ref:` per column because it has no other way to write it,
and `dbmd check` then said this:

```
tables/OrderLine.md
    warning  `ref: Order.Code` on column `OrderCode` points at a column that is neither
             `Order`'s whole primary key nor covered by a single-column unique index, so
             it does not identify one row (ref-target-not-unique)
    warning  `ref: Order.TenantId` on column `TenantId` points at a column that is neither
             `Order`'s whole primary key nor covered by a single-column unique index, so
             it does not identify one row (ref-target-not-unique)
```

The Postgres fixture said the same thing in lower case. Both warnings were true.
`Order` has `UQ_Order_TenantCode` on `(TenantId, Code)`, unique; neither column
identifies a row alone and together they do. The validator was right, the model
was right, the database was right, and the output was noise.

The cost is narrow and it is not small. A freshly imported model was never
*silent*, only error-free, so `dbmd check --strict` failed it. The very first
thing a new user does produced warnings they could not act on, which teaches
that warnings in this tool are decoration. ADR 0020 put the strict boundary
where it is on the argument that a warning is a thing somebody should look at.
A tool that opens by breaking its own boundary does not get to make that
argument twice.

Two shapes could fix it and they are different decisions rather than two
implementations of one.

**A composite ref in the format.** Give a `ref` a way to say it is one
constraint over several columns. It says the true thing: the pair *is* one
foreign key, it has a name in the database, and the model cannot currently
record either fact.

**A validator that recognises a covering set.** Leave the format alone. Read
the refs one table makes into one target table together, and ask of that set
whether it covers a whole key of the target.

## Decision

**The validator recognises a covering set. The format does not change.**

`ref-target-not-unique` no longer asks "is this one column unique". It asks
"does the whole key this column sits in get referenced from this table". In
`src/model/validate.ts`:

- `keysOf(target)` returns everything the target declares unique *whole*: its
  primary key as one key, and each `unique: true` index as one key.
- `referencedColumns(table)` gathers, per target table, every target column this
  table refs. It is computed once per table before any ref is judged, because
  the members of a composite key are declared on separate lines and the first
  one cannot be answered without the last.
- A ref is silent when some key holding its target column is covered by that
  set. It warns otherwise.

**This is strictly more permissive than the old rule and cannot warn about
anything the old rule allowed.** If `{c}` was a whole key before, it is a whole
key now, and it is covered because `c` is the column being refd. Every
single-column case is bit-for-bit what it was. That is the property that made
this safe to land in a validator whose whole value is being trusted.

**A partial set still warns, and the message changes because the old one would
be wrong.** Once you know the column is part of a key, "it is not a whole
primary key and not covered by a single-column unique index" is a true sentence
about the wrong subject. The reader's actual problem is a missing `ref`
somewhere else in the same file, so the message says that and names it:

```
`ref: orders.tenant_id` on column `tenant_id` points at one column of `orders`'s
unique index `orders_tenant_code_key`, and nothing in `order_lines` refs `code`,
so the set does not identify one row
```

Two message shapes under one code, because it is one mistake with two
descriptions rather than two mistakes. The column that is in no key at all keeps
the old wording exactly, which is the common case and the typo the rule was
built for.

**When several keys hold the column, the message names the nearest miss** —
fewest columns still unreferenced — and ties go to the earlier key, with the
primary key before the indexes and the indexes in declaration order. That is a
property of the target's file rather than of a `Map`'s iteration order, which
ADR 0006 rule 4 requires.

**The set is per target table.** Refs at two different tables are two facts
about two relationships. Pooling them by referring table alone would see
`{tenant_id, code}` in a file that refs `orders.tenant_id` and
`archived_orders.code` and call both covered, when neither identifies anything.

**A unique index with an expression key is dropped whole, not reduced to its
column keys.** `unique (tenant_id, lower(code))` constrains the pair. dbmd does
not read SQL (ADR 0022), so there is no `ref` anybody can write that covers
`lower(code)`, and a key nothing can ever cover is not a key this rule can use.
Reducing it to `[tenant_id]` would have silently approved exactly the typo the
rule exists to catch. The old rule reached the same answer by a narrower route:
it skipped any index that was not one plain string.

**Silence rather than one surviving warning, when the set covers.** The
alternative considered was warning once, on the first ref of the pair, to keep
the fact that the format cannot name the constraint visible. It was rejected: a
warning has to be attached to something, the only things available are single
columns, and a warning on one arbitrary column of a correct composite key is a
sentence that is false about that column. There is nothing wrong with the model.
`dbmd check` says nothing about models that are right, and this one is right.

### Why not a composite ref in the format

Not "later" and not "worse" — it is a much larger change bought with a warning.

- **`docs/format.md` is executable.** Every fenced `dbmd:` block on that page is
  assembled and validated on every `npm run check`. A new ref shape moves every
  block that has a `ref` in it, and it moves the canonical writer, the
  round-trip proof of ADR 0011, and the reader.
- **It changes what the studio draws.** An edge stops being one column to one
  column, which is the whole of ADR 0018. That is a redesign of the canvas's
  edge model in service of a warning.
- **It is a format change to the one asset this project has that a diagram does
  not**: a stable, diffable, hand-writable file. ADR 0003 is that the markdown
  is the model. Adding a second way to spell a relationship makes every existing
  model's spelling the old one.
- **The demand is not there.** Nobody has asked to name a foreign key. The item
  this record comes from is about noise, and the covering set removes the noise
  completely. If somebody later wants a foreign key's *name* — for a migration
  tool, or to report which constraint fired — that is a different requirement
  and it should be argued on its own evidence rather than smuggled in here.

What the format loses by this decision is unchanged from before it: it still
cannot say that two refs are one constraint, so it still has nowhere to put that
constraint's name. `docs/format.md` says so under *What the format does not
have*, and says it more precisely now, because the tool knowing something the
format cannot state is a sharper way to describe the gap than the old text's
"and `dbmd check` then says `ref-target-not-unique` about each of them".

## Consequences

- **A freshly imported model is silent.** Both fixtures, before and after:
  `dbmd check --strict` on the imported SQL Server model went from two warnings
  and exit 1 to `2 tables, 0 notes, 0 groups, no problems.` and exit 0. Same for
  Postgres. That was the point of the item.
- **Nothing else in the suite moved.** 691 tests were green before the change
  and after it, including `test/expression-indexes.test.ts`'s assertion that a
  unique expression index makes no column unique, and `examples/shop`'s
  standing requirement that a realistic model produces nothing at all.
- **The rule now depends on a second table's declarations to stay quiet.**
  Deleting one leg of a composite foreign key turns the other leg into a
  warning, in a file nobody edited. That is correct — the model now says
  something untrue — but it is a new kind of action at a distance, and the
  message names the deleted column so the trail leads somewhere.
- **It reads a table's columns twice**, once to gather refs and once to judge
  them. A model large enough for that to matter is not a model a person edits.
- **`ref-target-not-unique` has two messages under one code**, so anything
  matching on message text rather than code will see a shape it has not seen.
  `--json` consumers match on `code`, which is why ADR 0014 made it stable.
- **ADR 0029's closing note is now out of date.** It records, correctly for its
  day, that an import of a composite foreign key produces
  `ref-target-not-unique` about each column. That is what this record changes.
  ADR 0029 is not edited: superseded reasoning stays readable.

## Revisit when

- **Somebody wants a foreign key's name**, to drive a migration or to report
  which constraint an engine complained about. That is the requirement the
  composite ref actually serves, and it should be decided on that rather than on
  noise. This record's argument against it does not survive that requirement
  existing.
- **A covering set turns out to hide a real mistake.** The shape to watch for is
  a table that refs every column of a target's key by accident, from columns
  that are not one constraint. It is possible and no one has produced one; the
  day somebody does, the answer is probably that the format has to name the
  constraint after all.
- **A second rule wants the same per-table gathering.** `referencedColumns` is
  private and cheap. A third caller is the point at which it belongs on `Model`
  rather than being recomputed, and ADR 0017's rule that the validator reads
  declarations rather than the reader's derived indexes is what that change has
  to answer.
- **The nearest-miss choice starts naming the wrong key.** A target with two
  overlapping composite unique indexes is the case. It is deterministic and
  documented and nobody has one yet.
