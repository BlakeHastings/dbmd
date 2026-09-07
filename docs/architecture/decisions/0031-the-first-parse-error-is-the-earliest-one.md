# 0031. The first parse error is the earliest one, not the first one reported

## Context

[ADR 0017][adr17] decided that `frontmatter-invalid` is capped at one per file,
in the reader, at `parseFrontmatter`, and it made the argument in full: after the
first syntax error the rest of the parse is a consequence of it rather than an
independent fact, so reporting the first and stopping is a truer statement than
reporting forty. It also decided not to build it, and said why: the change
belonged to whoever next had a reason to touch that function. dbmd-24 is that
item.

What 0017 did not decide, because nobody had looked, is **which** diagnostic
"the first" is. Building it turned out to be entirely that question, and the two
obvious readings are both wrong in a way that is worse than the cascade they
replace.

A file was broken the most ordinary way there is, one tab character where two
spaces belong, and `dbmd check` said:

```
tables/t.md
   6  error  Implicit keys need to be on a single line (frontmatter-invalid)
   6  error  Nested mappings are not allowed in compact mappings (frontmatter-invalid)
   6  error  Tabs are not allowed as indentation (frontmatter-invalid)
   7  error  Implicit keys need to be on a single line (frontmatter-invalid)
   ... 11 more
```

**The message that names the mistake is third.** The first two are the parser
describing what the tab did to its state machine, and they repeat on every line
after it. That is the printed order, which is `compareDiagnostics`: location,
line, code, message. All fifteen share a code, so within line 6 they sort by
message text, and `I` and `N` come before `T`. A cap on the printed order reports
`Implicit keys need to be on a single line` for a file whose problem is a tab.

The parser's own order is not the answer either. `doc.errors` is emission order,
and `yaml` pushes the composer's complaints before the lexer's. For an
unterminated `[`, the shape that produced the original 41, the message naming the
actual fault, `Block collections are not allowed within flow collections`, is at
the **end** of `doc.errors`, after sixteen complaints about the lines it
swallowed. A cap on emission order reports one of those instead.

Either way the reader is left with one confidently wrong explanation of their own
file, and that is worse than fifteen true ones. Fifteen true messages are noisy
and lead somewhere; one wrong message leads to the wrong line, and dbmd-12
already established that a wrong line is the worst thing a diagnostic can carry,
because it is the number a person types into their editor.

## Decision

**The one reported is the one at the earliest position in the file**, by the
byte offset the parser gives, with the parser's own order breaking a tie.
Position is the only order that puts a mistake before its consequences, because
that is what a consequence is. It is not a heuristic about which message reads
better: it is the same claim ADR 0017 made, applied to the parser's output rather
than assumed of it.

It holds on both shapes and on every other one tried:

| the break | what is reported now |
| --- | --- |
| a tab instead of two spaces | `Tabs are not allowed as indentation`, line 6 |
| a tab as the whole indent | `Tabs are not allowed as indentation`, at the first tab |
| an unterminated `[` | `Block collections are not allowed within flow collections`, line 5 |
| an unterminated `{` | the one error there was |
| a stray `:` in a value | the one error there was |
| an over-indented continuation | `Nested mappings are not allowed in compact mappings` |

**The message says how many it did not report.** `Tabs are not allowed as
indentation (and 14 more parse errors, not reported: they follow from this one)`.
It costs a clause and it buys the difference between a reader who knows the file
has one mistake and a reader who believes it. Without the clause the second
`dbmd check` reports something the first hid, and looks like the file moved. The
count is in `message` rather than in a field of its own because ADR 0008 leaves
`message` free to be reworded while a field would be `--json` contract for a
number nothing consumes; a consumer that wants the count can have a field on the
day something needs one.

**A tie at one offset keeps the parser's order**, and there is nothing better
available: two complaints about the same character are one point of failure
described twice, and neither is more true than the other.

**Nothing else is capped, and warnings are only capped as part of a failed
parse.** When the parse produced no errors there is no cascade, so every
`frontmatter-invalid` warning is reported as before. When it produced errors the
warnings are counted with them and not printed, because a warning about a
document that did not parse is describing the same wreckage. Every other code in
the reader and the validator is one fact per mistake and stays that way; the
suppression rule in ADR 0017 is the validator's equivalent and it works by not
making the claim rather than by trimming a list.

## Consequences

- **A cascade is gone from both places it was visible.** `dbmd check` groups by
  file, which made a cascade look like a cascade, which was as much as ADR 0020
  wanted that command to do about it; the studio's panel had the same list. Both
  inherit this without knowing it happened, which is the whole reason ADR 0017
  put the cap in the reader rather than at either printing site.
- **`docs/format.md` now documents an exception to "all of them in one pass"**,
  with the unterminated-`[` case as a `dbmd-error:` block, so the page's claim
  about the cap is executed on every run rather than remembered.
- **The reported message is chosen by an ordering `yaml` is not obliged to keep
  stable.** Offsets are, and the codes are, but which complaint sits at the
  earliest offset could change across a major version of the parser.
  `test/model/frontmatter-cap.test.ts` asserts the exact messages for the tab and
  the flow sequence and separately asserts that emission order still puts the
  flow message last, so an upgrade that changes this fails loudly and says which
  half moved.
- **Fourteen true diagnostics are no longer printed.** That is the trade, and it
  is only sound while the kept one names the real fault. The table above is the
  evidence it does; a break shape where it does not is a bug in this decision
  rather than in the code.
- **A file with two independent syntax errors reports the first, then the second
  on the next run.** Two runs to fix two mistakes is the cost, and it is the same
  cost a compiler charges. It is worth less than the alternative because a second
  syntax error in one file is rare and a cascade from the first is certain.

## Revisit when

- **Somebody reports a break shape whose earliest complaint is not the mistake.**
  That is the falsifier for this whole record. The fix is a preference among
  complaints at or near the earliest position, ordered by how specific the
  parser's code is, and it needs the failing shape in hand rather than a guess
  at which codes are specific.
- **A consumer wants the suppressed count as data.** It is a clause in a message
  today. A field on `Diagnostic` is additive under ADR 0006 and the moment to add
  it is when something reads it, not before.
- **`yaml` gains a way to ask for one error.** `parseDocument` has no such
  option today, and if it grows one this function becomes the option rather than
  a loop over `pos[0]`.

[adr17]: 0017-the-validator-is-a-second-opinion.md
