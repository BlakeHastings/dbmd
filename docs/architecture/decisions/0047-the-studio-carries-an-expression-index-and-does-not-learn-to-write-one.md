# 0047. The studio carries an expression index and does not learn to write one

## Context

ADR 0022 decided that an index key is either a bare string, which is always a
column of the table, or `{ expression: ... }`, which is engine SQL nobody
parses. It also recorded, in its consequences, that the studio would show such a
key and refuse to edit it, and it called editing one in the page "real interface
work and a separate item". This is that item, and dbmd-vdh is where it was
written down. `docs/format.md` calls the read-only row "temporary".

Three things were measured before anything was decided.

**The carrying is real.** With `columns: [{ expression: lower(email) }]` on
`customers`, dragging the table in the studio and flushing wrote one line:

```
-layout: { x: 40, y: 340 }
+layout: { x: 112, y: 412 }
```

The key came through byte for byte. So did the whole indexes list when the
neighbouring index was renamed in the panel and `unique` was ticked on the
expression row itself, which is the harder case, because that edit passes
through the same code path that rebuilds every key. The `heldColumns` mechanism
in `src/studio/client/inspector.ts` does what it says. The studio carries what
it cannot write, which is the property that matters and the one that was worth
proving first.

**The authoring gap is real and it is loud.** A new index whose keys field holds
`lower(display_name)` is written as `columns: [lower(display_name)]`, and both
`dbmd check` and the studio's own footer say so, in the same words:

```
the index `customers_lower_name_idx` names the column `lower(display_name)`,
which `customers` does not have; if it is an expression rather than a column,
write it as `{ expression: lower(display_name) }`
```

That message teaches the exact syntax, and it reaches the person inside the page
rather than only on a later CLI run. It is a good answer to the case it was
written for.

**One thing is genuinely wrong, and it is not the missing editor.** The panel
prints `{ expression: lower(email) }` in the read-only row, one line above an
ordinary editable row. Copying it is the obvious next move. Doing so writes
`columns: ["{ expression: lower(display_name) }"]`, a column with those
characters in its name, and the good message then fires on that name and offers
to wrap it a second time:

```
... if it is an expression rather than a column, write it as
`{ expression: { expression: lower(display_name) } }`
```

That is advice for a case it was not written for. Following it does not work
either: a doubly nested mapping fails `readIndexKey`. So the panel teaches a
spelling by displaying it and then punishes the person who uses it, and the
loop has no exit inside the page.

## Decision

**The studio does not learn to write expression keys. It learns to say when it
has been handed one.**

The editor is not built, for two reasons that are about the format rather than
about effort.

**Any spelling the field could accept re-creates the collision ADR 0022
removed.** The keys field is one comma-separated line. The only spelling worth
teaching is the format's own, `{ expression: x }`, because it is already printed
in the panel. But the moment those characters in that box mean an expression, a
column genuinely called `{ expression: x }` becomes unreachable from the studio,
and the studio silently writes a different schema from the one that was asked
for. The file has an escape from exactly this, quoting the scalar, and a
comma-separated one-line box has no quoting rule. Adding one buys the feature at
the price of a second syntax to type, remember and document, which is the small
language nobody asked for. dbmd-18 was one string standing for two schemas, and
the answer to it is not a second place where that is true.

**While the field can only emit column names, every key it writes is one the
validator can judge.** `index-column-unknown` stands down on an expression by
design, and rightly: dbmd does not parse SQL and has nothing truthful to say
about what is inside one. So a typo in a column name typed into that field is
caught today and forever, and a typo inside a pair of braces would be caught
never. Trading a loud error for a silent one is a bad trade at any priority, and
this is a P4.

**What did change is the panel's own trap.** An editable index row whose keys
field holds the mapping spelling now says so, in the row, as it is typed:

> that is how the file spells an expression key, but this field writes column
> names, so it has been written as a column called that; an expression key is a
> mapping this one-line field cannot make, so write that one in the file

It reports and does not act. The keys still reach the file exactly as typed, so
a column really called `{ expression: x }` is still writable from the studio and
still gets the validator's error. Recognising the panel's own printed output is
not guessing from the shape of the text, which is what ADR 0026 refuses: nothing
about the model changes, and `lower(email)` on its own is left alone, because
`lower(email)` is a legal column name and what the validator already says about
one is the right thing to say.

## Consequences

- **`docs/format.md` is now wrong in one word.** It calls the read-only row
  "temporary" and tells the reader to wait for the line to go away. It is not
  temporary; it is the decision. That page belongs to another agent this wave,
  so the sentence is named here rather than edited, and whoever holds it should
  say that an expression key is changed in the file on purpose.
- **ADR 0022's "editing an expression in the page is a separate item" is
  answered rather than left open.** The answer is no. 0022 is not edited; this
  record is the correction, per the convention in the decision-record README.
- **The message in `src/model/validate.ts` still offers a doubly nested wrapper
  to anybody who hand-writes a quoted mapping into a `columns` list.** The panel
  now gets a correct sentence in first, so the studio path is covered, but the
  hand-editing path is not and the fix is not in this branch's lane. It is a
  small one: the message could notice that the name it is about is already the
  mapping spelling and say "this is a quoted string, so it is a column name;
  remove the quotes" instead of wrapping it again.
- **The `Add index` flow is unchanged.** A fresh row is still nameless and
  columnless and still says both, and the new sentence cannot appear on an empty
  field.
- **Nothing about what reaches disk changed**, so no test of the writer, the
  reader or the CLI moved. The new behaviour is one predicate in
  `src/studio/client/fields.ts` and one branch in the row's notes, and it was
  driven in a browser against a real model before it was written down.

## Revisit when

- **Somebody asks for it.** Not somebody who hit the error once, but somebody
  who keeps an expression index and edits the model through the studio often
  enough that the round trip to a text editor is the cost. That is the fact this
  record does not have and cannot invent.
- **The keys field stops being one line.** The whole argument above is about a
  comma-separated string. A per-key editor, a row of fields with a "this one is
  SQL" toggle beside each, has no ambiguity to resolve and needs no syntax: the
  toggle is the spelling. That is a bigger piece of interface than an index list
  currently justifies, and if the panel grows one for another reason, this
  decision costs nothing to reverse.
- **A second slot in the format gains an expression.** A `check` constraint's
  predicate is a plain string in a slot only SQL can occupy, so it needs none of
  this. If a third case turns up where SQL and an identifier compete for the
  same field, the studio will be answering this question twice, and two of them
  is the point at which a general answer is cheaper than two refusals.
