# 0017. The validator is a second opinion, not a second reader

## Context

ADR 0008 gave the reader one job: decide whether a file says what it claims to
say, and diagnose rather than guess when it does not. It deliberately left the
other half undone. Whether `ref: customers.id` points at a table that exists is
not a question about `orders.md`; it is a question about whether two files agree,
and no amount of reading `orders.md` answers it. `src/model/types.ts` said so in
a comment for three weeks: "Deciding whether a `ref` points at a table that
exists is dbmd-12's job, not this module's."

dbmd-12 is that job. Writing it turned up four questions that the item did not
ask and that every rule added later will ask again, so they are answered here
once rather than argued nine times in a code review.

The item's own rule list is where two of them came from. It asks for "a group key
naming a group that does not exist is an error" and "a file whose kind disagrees
with its directory is an error". Both were written before `readModel` existed.
The reader now raises `group-unknown` itself, with the line the `group:` key is
on, and it raises `kind-mismatch` and then declines to load the file, which means
there is no object left in the model for a validator to look at. Implementing
either as written would have produced, in the first case, two complaints about
one mistake with the worse one arriving second, and in the second case a rule
that cannot fire.

## Decision

`src/model/validate.ts` exports `validate(model): readonly Diagnostic[]`. It
takes a `Model` and nothing else: no directory, no file handles, no reader
diagnostics. Four rules shape it.

**It says nothing the reader already said.** Where a rule can be answered while
reading one file, it belongs to the reader, which has the file open and can put a
line on it. Where it cannot, it belongs here. `group-unknown` stays with the
reader for exactly this reason and `kind-mismatch` is not a validator rule at
all. The test that asserts the two code sets do not intersect is the enforcement,
and it is cheap because both sets are closed unions.

**An incomplete object's absences are not evidence; its presences are.**
`CanvasObject.complete` is false when the reader raised an error building the
object, which means the file holds something the object does not: a column whose
type YAML resolved to a boolean is dropped, and it takes its `pk: true` and its
`unique` index with it. So every rule whose conclusion is "this is missing"
stands down for such an object, and every rule whose conclusion is "these two
both exist" does not, because dropping something cannot invent a duplicate.
Concretely: `primary-key-missing`, `index-column-unknown`, `ref-column-unknown`
and `ref-target-not-unique` are suppressed; `duplicate-column`,
`duplicate-index` and `duplicate-table` are not. Without this rule the validator
tells somebody their ref is dangling when what actually happened is that the
target's file has a syntax error two lines further down, and sends them to the
wrong file to fix it.

**It reads declarations and never the reader's derived indexes.** `referencesTo`
and `groupMembers` on `Model` are computed by the reader from the same `ref:` and
`group:` keys this module walks. Validating against them would be checking a
cache against itself, and it would pass on a model an importer built with a
correct cache over an incorrect model. So the validator walks
`table.columns[].ref` and `table.group`. This costs a loop and buys a validator
that is a genuinely independent opinion, which is the only kind worth running.

**Every validator diagnostic carries a path and no line, and that is the answer
rather than a gap.** A `Model` holds no offsets: the reader's are consumed while
the file is open and are not carried onto the object, and the one place a line
survives is stripped before the table reaches the model. The only way to produce
a line from here would be to reopen the file and search it for a column name,
and a column called `id` appears forty times in a real model, so that search
produces a confidently wrong line for the price of a plausible one. A wrong line
is worse than none: it is the number a person types into their editor. The
messages compensate by naming the column the ref is written on, which is a search
term rather than a coordinate, and `DiagnosticLocation.line` is optional for
precisely this case.

**The codes are one union with the reader's, not two.** `ModelDiagnosticCode`
gains nine members rather than gaining a sibling type. Nothing downstream needs
to know which module raised a code: `docs/format.md` documents them in one page,
`dbmd check --json` will print them in one array, and the distinction that turned
out to matter to a consumer is `complete` on the object, which says whether a
file lost something and therefore whether the writer may save over it. A prefix
would have encoded the module in the public contract, which ADR 0014 already
declined to do for a better reason than we have here.

**Severity is a fact and stopping is a decision, and this module only produces
facts.** `validate` returns errors and warnings with no policy applied. That
errors fail a run, warnings print, and `--strict` promotes is dbmd-21's, because
it is a property of a command line rather than of a model. The item's reasoning
stands and belongs there: warnings that fail a check by default mean the check
does not go into CI, and a linter nobody runs is worse than none.

## Where a cap on diagnostic volume belongs

A review of dbmd-13 recorded that one invalid file produced 41 diagnostics, 40 of
them distinct, because a broken flow sequence swallows the rest of the document
and the YAML parser then reports every remaining line. Every line was true and
only the first was worth reading. Three places could hold a cap, and only one of
them is the source of the problem.

**Not the validator.** It does not produce cascades. Its rules are one per fact
about the model, and the largest number it can emit for one mistake is one. The
suppression rule above is the shape a cascade takes here and it is answered by
not making the claim rather than by trimming a list afterwards.

**Not the presentation layer.** ADR 0006 exists to stop the studio and the CLI
disagreeing about output, and ADR 0011 put every write behind one module for the
same reason. A cap applied while printing is a cap the studio would have to
reimplement and could get wrong, and it would either make `--json` disagree with
the text or make `--json` lossy in a way a consumer cannot detect. A count is not
a rendering decision.

**The reader, at the one call site that cascades.** The cascade is a property of
`parseDocument`: after the first syntax error the rest of the parse is a
consequence of it rather than an independent fact, so reporting the first
`frontmatter-invalid` per file and stopping is a truer statement than reporting
forty. `src/model/read.ts` already makes exactly this argument one function
lower, where a `kind:` that disagrees with its directory stops the file loading
because reading a table's keys as a note "produces a page of secondary
complaints that bury the one-line fix". The cap is that sentence applied to the
parser's own output.

**It is decided here and not built here.** It is a change to the reader's
behaviour, dbmd-12 is the validator, and the change is small enough that it is
better landed by whoever next has a reason to touch `parseFrontmatter` than
smuggled into a diff about something else. What this record buys is that when
somebody does it, the argument is already had and the answer is not "cap it in
the CLI, that is where the printing happens".

## Consequences

- **The validator is trivially testable and has no I/O.** Its fixture is a
  directory only because a directory is what a user has;
  `test/fixtures/invalid` parses without a single reader diagnostic, which is
  asserted, so the list it produces is the validator's alone.
- **Two rules from the item were not implemented, deliberately.**
  `group-unknown` and `kind-mismatch` stay with the reader. `docs/format.md`
  still documents them in the reader's half of the table, which is where a
  person looking for them will be.
- **`duplicate-table` cannot be reached by reading a directory**, since one
  directory holds one `orders.md`. It is kept because `Model` is a type an
  importer builds too, and the format has no schemas, so a database with
  `sales.orders` and `web.orders` produces exactly this and silently keeping one
  of them is the worst available outcome.
- **A table file that fails to load makes every ref to it dangle**, and the
  validator cannot tell that case from a genuine typo, because the failed file
  left no trace in the `Model`. Both diagnostics are true and they sort next to
  each other by path, so the pair reads correctly; it is still two complaints
  where a person made one mistake. Fixing it properly means the model carrying a
  record of the files that did not load, which is a change to `Model` and not
  worth making until something else wants it.
- **The `ref-target-not-unique` rule was unwritable four days ago.** Until
  dbmd-14 made `unique: true` sayable on an index, no model could declare a
  non-key column unique, so the rule would have fired on every correct model
  that referenced one and would have been deleted within a week. It is the
  clearest payoff dbmd-14 has, and it is why several items were sequenced behind
  this one.

## Revisit when

- **The model carries source spans.** That is the day every rule here can offer
  a line, and it is a change to `Model` that the studio would also use to
  highlight a node. The messages naming the referring column become redundant
  rather than wrong.
- **A rule needs to see the reader's diagnostics** to decide whether to speak.
  The dangling-ref-into-a-failed-file case above is the candidate, and the fix is
  a field on `Model` recording what did not load, not a second argument to
  `validate`.
- **Somebody adds a rule that fires on a correct model.** That is the signal a
  rule is too eager, and `examples/shop` is the test that catches it: it is a
  realistic model that must stay silent, and it is asserted on every run.
- **The number of rules outgrows one file.** Nine fit comfortably. Thirty would
  want a rule-per-function registry, and that is a pattern worth a record of its
  own rather than something that happens gradually.
