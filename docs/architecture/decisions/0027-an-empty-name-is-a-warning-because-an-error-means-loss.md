# 0027. An empty name is a warning, because an error means loss

## Context

`dbmd check` said `no problems` on this model, and exited `0`:

```yaml
columns:
  - name: ""
    type: ""
indexes:
  - name: ""
    columns: []
```

Every part of that was working as built. `field-missing` fires when a key is
absent, and here every key is present. `field-wrong-type` fires when YAML hands
back the wrong sort of value, and here it hands back a string. The validator
(ADR 0017) asks whether the files agree with each other, and a table whose
columns are all called nothing agrees with itself perfectly.

It is not a hand-written curiosity either. *Add column* in the studio writes
`- name: "" / type: ""` the instant it is clicked, *Add index* writes
`- name: "" / columns: []`, and ADR 0021 deliberately gives a new table an `id`
column with `type: ""` because the type is the one part that depends on somebody
else's engine. So every model edited in the page passes through this state, and
the studio's own inspector already says so in its own words: *"this column has
no name, and will be written as an empty one"*. The page and `dbmd check`
disagreed about the same file and the page was right.

Two questions had to be answered to close that, and only one of them is the one
the item asked.

## Decision

**A required name or list that is present and says nothing is `empty-value`, and
it is a warning.**

The severity is the whole decision, and the argument that settles it is
mechanical rather than a matter of taste. In `src/model/read.ts`, `error` does
not mean "wrong". It means **the object is missing something its file has**:
`intact()` turns any error raised while building an object into
`complete: false`, `writeModel` then skips that file, `patchTable` refuses the
edit with a 409, the canvas draws the table as broken and undraggable, and the
inspector replaces every field with *"did not parse, so this server is holding
less than the file does and will not write over it"*.

Nothing is lost reading `name: ""`. The empty string is carried into the model
exactly as written, survives a write, and reads back equal; the round-trip
property test proves it on generated models whose names come from a pool that
has `""` and `"  "` in it on purpose. So there is nothing for the writer to
protect, and an error would buy nothing while costing this: the moment you click
*Add column*, the table you are editing locks, and it locks in the one way that
removes the field you would have typed the name into. The interface would
deadlock on its own output.

The softer argument is the one ADR 0017 already made for `primary-key-missing`,
and it points the same way: a half-typed column is the normal state of a model
somebody is editing, and a studio footer that turns red on every *Add column*
click teaches people to stop reading the footer. A check a team removes from CI
is worth nothing.

`--strict` is the answer for a team that wants a blank name to fail `main`, and
it is the answer ADR 0020 already built. There is no per-code severity here and
this is not the item that introduces one.

**It goes in the reader, and it is one code for all five cases.** ADR 0017's
test is whether a rule can be answered while reading one file. Every one of
these can: a column's name, a column's type, an index's name, an index's
`columns` list, and a table's own name, which is its file name. The reader has
the file open, so four of the five carry the line the mistake is on, which is
what makes the diagnostic usable on a table with thirty columns. Putting it in
the validator would have bought a rule that covers a `Model` an importer built,
and the import contract already has `import/empty-value` for that at the point
the JSON is read, which is both earlier and better placed.

One code rather than five, and named for `import/empty-value` on purpose, so
that the two halves of the tool say the same thing in the same word. The
granularity matches `field-wrong-type`, which covers every key of every kind and
names the key in its message.

**A table's `columns: []` is deliberately not this.** An index with no keys is
not an index and no engine would accept one. A table with no columns is a table
nobody has filled in yet, which is a real thing to have; `validate` already
exempts it from `primary-key-missing` for the same reason, and warning here
would be telling somebody their table is empty in the least useful available
words.

**Whitespace is the same mistake in a disguise.** `name: "  "` reports as *only
whitespace* rather than as *empty*, because the two need different things
noticing, but it is the same code and the same severity. A name you cannot see
is not a name you can type into a query.

## Consequences

- **`empty-value` is public API from this commit**, per ADR 0006 and 0014:
  additive today, breaking to rename later.
- **A warning is a thing that accumulates**, which ADR 0020 already named as the
  trade `--strict` exists to escape. The signal that this was the wrong call is
  a repository where `dbmd check` prints a screen of `empty-value` and nobody
  reads it. The signal it was right is that nobody has had to fix the studio to
  keep working.
- **The round-trip property test now allows `empty-value` through by code**
  rather than by severity. That is precise rather than loose: it is the one
  diagnostic that asserts nothing was lost, and the `toEqual` beside it is the
  proof, since an empty name that did not survive would fail there instead.
- **The reader now says two things about one fact, with the studio.** The
  inspector's per-row note and this diagnostic are the same observation, and the
  inspector's is the one that updates as you type, before anything is saved. The
  right end state is that the row shows the reader's diagnostic rather than its
  own sentence, which is a change to `src/studio/` and belongs to whoever next
  has a reason to be in the inspector. It is filed rather than smuggled in here.
- **`requiredString` now takes a remedy clause and it is not optional.** The
  next required string added to the format cannot skip the emptiness check by
  omission, which is exactly how `name: ""` got through the first time. Its
  fourth caller, an index key's `expression`, was covered by that and not by the
  item, and `{ expression: "" }` is now reported too.

## Revisit when

- **A team asks for `empty-value` to fail without `--strict` failing on
  everything else.** That is per-code severity, it is a configuration file, and
  ADR 0020 already says where the argument goes.
- **The studio grows a way to add a column without writing a blank row**, such
  as a row that is not saved until it has a name. That removes the mechanical
  half of this argument and leaves only the soft one, and the soft one alone may
  not be enough to keep this a warning.
- **Somebody wants a blank name refused rather than reported.** That is the
  writer's question and not the reader's, and `dbmd-23` is the item: the writer
  already skips a file whose object name is empty, silently and with no
  diagnostic code, which is the actual gap next to this one.
