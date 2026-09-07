# 0052. A new table says it is undocumented on screen, and not on disk

Answers a question ADR 0029 raised for `dbmd import` and ADR 0021 never asked
for the studio. Nothing here is a bug fix: the greenfield journey works end to
end and this record is about a sentence that does not get written.

## Context

There are three ways a table file comes into existence, and until now they
disagreed about prose without anybody having decided that they should.

**`dbmd import` writes a prompt line into every table it creates.**

```markdown
Imported from `public.orders`, and nobody has written down what it is for yet.
```

ADR 0029 has the argument and it is a good one: an import could write a
paragraph per table out of the frontmatter directly above it, and a reader who
finds filler in the one place this format has that a diagram does not stops
reading that part of the file forever. One line saying nobody has done the work
is worth more than five pretending somebody has.

**`dbmd init` carries real prose**, because `src/cli/example.ts` is
documentation rather than a fixture (ADR 0012). Its two tables say why `email`
is `citext` and what is deliberately not in the model.

**A table created in the studio gets nothing.** `blankObject` in
`src/studio/edits.ts` sets `body: '\n'`, and the comment beside it explained the
newline rather than the emptiness. Driving it produces exactly this file:

```markdown
---
kind: table
table: sessions
columns:
  - name: id
    type: ""
    pk: true
layout: { x: 401, y: 417 }
---

```

So nothing on disk said the table was undocumented, nothing on screen said it
either, and no record said why the two paths differed. The first two are
findings; the third is the reason this is a decision rather than a patch.

## Decision

**The studio writes no prose into a file it creates, and the panel is where it
says that nothing has been written yet.** The prose box carries one line naming
what belongs in it, per kind, shown while the body is blank and gone on the
first keystroke, and the file holds the frontmatter and nothing the developer
did not type.

Four things settle it, and the first is the one that makes the import argument
not transfer rather than merely inapplicable.

### A prompt line is written for a reader who is not present

`dbmd import` is a command that exits. It writes a directory in one go and its
reader arrives later: at a `git diff`, in a review, or on the morning somebody
opens the model for the first time. The line in the body is the only channel it
has to that person, and ADR 0029 is right that it should use it.

A studio create ends with the inspector open on the new table, the prose box on
screen, and the developer's hand on the keyboard. The reader is present, in
front of the box, at the moment the file lands. There is a cheaper channel, so
the expensive one is not needed, and the expensive one is the file.

That is the whole asymmetry. It is not that a studio user is more diligent, or
that prompts are unwelcome. It is that a batch command has one place to put the
prompt and an interactive one has two, and only one of the two ends up in
somebody's repository.

### The studio does not write what the developer did not choose

ADR 0015 is the rule and it is already load-bearing: a position nobody chose is
computed and never written, so that opening a model leaves `git status` empty.
ADR 0021 wrote a `layout` only because the developer pointed at a spot, gave the
new table `name: id` and `pk: true` because those guess nothing, and left
`type` empty on purpose, because a `uuid` chosen there would be this repository
deciding something about somebody else's database.

A sentence in the body is the same guess one layer up. It is not a fact about
the schema that could be right or wrong; it is words in a file, in the
developer's name, that the developer did not write.

The create panel already says this out loud, and that is the check on the
argument. It reads:

> Writes tables/sessions.md, with layout: { x: 401, y: 417 } and one column,
> `id`, marked as the key and typed later. No other file in the model changes.

Every item on that list is either something the developer supplied or something
the format requires. Writing a prompt line means adding an item to it, and the
honest wording of that item is *and a sentence saying nobody has documented
this*, which is the interface admitting it puts words in somebody's file. An
interface that cannot say what it does without the sentence sounding wrong is
usually doing something it should not.

### On disk, a generated sentence has no provenance

An import's prompt line survives review because the whole directory arrived in
one commit and everybody knows it was machine-written, and because the line
opens by naming the table it was generated from, which says where it came from.
That is what makes it a prompt rather than a claim.

A studio create lands as one file in a working tree of hand-written ones. ADR
0021 called that out as the point: *"a created table is in `git status`
immediately, one file, with a `layout` in it, and no other file touched. That is
the diff the format exists for."* A generated sentence in that diff reads, at
review time, as something the author wrote. No check reads a body (ADR 0044, ADR
0050), so nothing downstream will ever correct that impression.

And the studio has no honest opening to borrow. *Created in the studio* tells
the reader nothing they want to know, and anything else is the tool writing in
the developer's voice.

### The import line cannot be shared, and this is why

The item asked whether the two paths could use one string. They cannot, and it
is worth writing down so nobody tries.

`tableBody` in `src/import/model.ts` opens with the schema, deliberately:
`tables/` is flat (ADR 0003), so `public.` and `dbo.` exist nowhere else in the
model and that clause is the last copy of the fact. Strip it and what remains is
*nobody has written down what it is for yet*, which is the half of the sentence
carrying no information. Sharing that remainder would leave the import line
assembled out of a fragment whose only other job is to stand alone somewhere it
was never true, and one of the two callers would end up saying something
slightly wrong about where its table came from. So: no shared constant, and the
studio's line is not a second spelling of the import's because it does a
different job. The import reports a state, because reporting is all a command
that has exited can do. The panel's line asks for the content, because it is
standing next to the box that takes it.

### A second nag arrives at the worst moment

`dbmd check` already warns `empty-value` on the `id` column a create starts with,
and the studio's own diagnostics panel shows it the instant the file lands. ADR
0027 settled that severity on exactly this ground: a footer that turns red on
every *Add column* click teaches people to stop reading the footer, and a check
a team removes from CI is worth nothing.

ADR 0027 also drew the line this record follows. Its last consequence says the
reader's diagnostic and the inspector's per-row note are the same observation,
and that the inspector's is the one that arrives in time, before anything is
saved. Prose is the same shape of thing one size larger: what the developer
needs is a nudge in the panel while they are still there, not a warning on a
file they have already committed.

So there is no diagnostic for an empty body, which would need overturning ADR
0044 and ADR 0050 and is not this record's business, and there is no prose in
the file either. What the studio owes is one line in a panel that is already
open, and one grey line under the box is the cheapest form of it: it is gone on
the first keystroke and it cannot be committed. The `empty-value` warning about
the column is still there in the diagnostics panel, unchanged and untouched by
this; what is added is not a second warning about the same thing but the only
thing in the interface that says anything at all about the prose.

### What the panel says, and why it is not a `placeholder`

One line under the prose box, per kind:

```
table   No prose yet. What this table is for, and the fact about the business
        that explains its shape, is the part the frontmatter above cannot say.
note    No prose yet. A note is its body, so this box is the whole of it: the
        thing somebody would otherwise have to ask about.
group   No prose yet. What these tables have in common, beyond being drawn in
        one box, is what this file is for.
```

One per kind rather than one shared sentence. The three files are for different
things, and a single line covering all of them would be the sort of prose that
says nothing, which is the thing ADR 0029 refused to write into a file and there
is no reason to accept on screen.

All three, rather than only the table this item is about, because writing one
and leaving the other two blank is precisely the accident this record exists to
end. The note already had half of it: the canvas draws an empty one with *"An
empty note. Its body is the note; write it in the panel"*, which points at a
panel that then said nothing when you got there. That sentence now has a
destination, and the decision behind it, taken once already and never written
down, is covered here.

**It is a paragraph rather than the textarea's own `placeholder`, and finding
that out cost a rebuild.** A `placeholder` is the obvious mechanism and it does
not work here: `blankObject` gives a created object `body: '\n'`, so the box
holds a newline, is not empty by the browser's definition, and the placeholder
never shows on the one object it exists for. It showed correctly in the DOM and
never on the screen, which is the class of defect this repository only ever
catches by driving the studio, the way ADR 0030's two `.note` collisions were
caught.

**And it is toggled on input rather than drawn once.** Rule 2 at the top of
`inspector.ts` is that the panel is not rebuilt on a keystroke, because
rewriting a field under a cursor is how an editor eats a character. A line
saying nothing is written would therefore still be saying it two paragraphs in.
One assignment in the existing `input` handler is the whole of the fix, and it
is the reason the sentence can be a paragraph at all rather than something that
has to disappear on its own.

## Consequences

- **A table created in the studio is on disk exactly as ADR 0021 described it**:
  frontmatter, the closing `---`, and the blank line the format conventionally
  puts after it. `body` stays `'\n'` rather than `''` because that blank line
  belongs to the body and `writeModel` concatenates rather than pads. A test in
  `test/studio/server.test.ts` reads it back through `readModel` and asserts
  `'\n'`, which is the round trip and the decision in one assertion: a writer
  that padded reads back `'\n\n'`, and a prompt line reads back as itself.
- **A first commit contains no sentence its author did not write.** That is the
  property being bought, and it is worth more here than in an import because the
  file is arriving alone among hand-written ones.
- **The two creation paths still differ, now on purpose.** Somebody will notice
  again, because the difference is real and visible in two minutes of driving
  the tool. This record is the answer, and the code comment in `blankObject`
  points at it rather than at the newline.
- **A developer who never looks at the panel gets no prompt at all.** That is
  the cost, and it is accepted: they created the table by pointing at the canvas
  with the panel open, so "never looks at the panel" is not the path this
  interface has. The signal that it was the wrong call is models built entirely
  in the studio arriving with every body empty, which is observable in any
  repository that uses this and is not observable yet.
- **`proseSection` takes a fourth argument and its `input` handler does one more
  thing.** Three call sites, one string each, and the line-ending handling that
  is the rest of that method is untouched.

## Revisit when

- **Something creates a table without a person watching.** ADR 0039 already
  points at agents editing the files with the CLI as the gate, and an agent is
  the case where "the reader is present" stops being true. If a create ever
  happens with no panel open, the argument in the first section inverts and the
  prompt line becomes the right thing to write.
- **A body becomes a thing the tool reads.** dbmd-x82 has that question open.
  Every argument here assumes a body is opaque; a tool that could tell prose
  from a prompt could also tell an empty one from a written one, and the panel's
  line would then be one of two ways to say it rather than the only one.
- **Somebody builds a whole model in the studio and ships it undocumented.**
  The observable failure of this decision, and the fix it argues for is a louder
  panel rather than a line in the file.
