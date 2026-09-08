# 0084. A shipped skill states the contract and cites the argument

## Context

`.claude/skills/dbmd/SKILL.md` is tracked, shipped with the repository and
loaded by any Claude session in this checkout. It is the fourth place this tree
describes what `dbmd import` does, after `dbmd import --help`,
[`docs/import-format.md`](../../import-format.md) and
[ADR 0050](0050-a-re-import-is-a-delta-somebody-confirmed.md).

One of its sentences was false, and it was about the one feature the owner
specified in their own words:

> `dbmd import` refuses a directory that exists and is not empty, so
> re-importing over a model is not a thing you can do by accident.

ADR 0050 retired that refusal and replaced it with a delta somebody confirms.
The skill went on describing the refusal for the feature that replaced it, which
is the worst shape a stale claim comes in: an agent reading it does not go and
look, because the sentence says there is nothing there to look at.

**A sweep of the whole file against the tree found four more, and that count is
the reason this record exists.** Measured on 2026-09-08, in a worktree, against
a build of the tree:

| what the skill said | what runs |
| --- | --- |
| import refuses a non-empty directory | it computes a delta, exit `1`, and `--confirm` writes it |
| `refs --json` has `path`, `inPrimaryKey` and `nullable` on every edge | only `from`, `to` and `path` are on every edge; the rest are omitted rather than written false, and `onDelete` and `onUpdate` were not mentioned at all |
| a column is `name`, `type`, `pk`, `nullable`, `default`, `ref` | ADR 0046 added `on delete` and `on update` after `ref` |
| an error blocks the canonicalise step | a whole-model error does not: with a live `ref-table-unknown`, `writeModel` wrote the file |
| `skipped` as `incomplete` is what a file dbmd cannot read gets | a file whose frontmatter never parsed is in neither list: `{ "written": [], "skipped": [] }` |

The last two are worth separating from the other three, because they are not
drift. They were **never** true, and the skill contradicted itself about them on
the same page: its own rename recipe canonicalises at step 5 while a
`ref-table-unknown` is live, which the "When the check fails" section said could
not work. Nobody had run the page against itself.

**What the five have in common is that the skill was paraphrasing.** Every one
of them is a sentence that restates, in the author's own words, something a
`--help` text or `docs/format.md` also says. `docs/process/orchestrating.md`
already has the name for this: a reference repeated everywhere is a reference
nobody checked. ADR 0080 met the same shape in four version pins that agreed
with each other and with nothing else.

**And the existing guard cannot reach it.** `scripts/check-commands.mjs` asks
whether a backticked `dbmd <word>` is a command that exists, which is why the
false sentence passed every run of `npm run check` it ever saw: `dbmd import` is
a real command, and what the sentence claims about it is prose. That guard was
built for the defect where the tool told people to run a command it did not
have (ADR 0036), and it is not wrong here; the claim is simply of a kind a
backtick does not mark.

## Decision

**A shipped skill states the contract a caller branches on, in its own words,
and cites the page that argues it rather than paraphrasing the argument.**

The contract is the small, checkable part: an exit code, a `code` on a `--json`
envelope, a key that is present or absent, the order of keys in a file. Those
are what an agent acts on, they are what ADR 0006 and ADR 0014 already promise
not to move quietly, and they are short enough that a person correcting one can
see the whole of what they are correcting. The re-import now reads as a table of
three exits, the `changes-not-confirmed` code, and the nine `kind` values, with
`dbmd import --help` named for the four paragraphs and ADR 0050 named for the
owner's sentence.

**Three consequences of that rule, taken here.**

**A refusal that moved is not deleted; it is re-pointed at what still refuses.**
`dbmd init` does refuse a directory that exists and is not empty, for the reason
the retired import refusal used to give. The skill now says so there. A reader
who half-remembered the old sentence meets the true version of it rather than
silence, which is what stops the correction being re-reverted by somebody's
memory.

**An absent key is stated as absent rather than listed as present.** The
`refs --json` bullet now says which keys are on every edge and which are there
only when the file said so, and says to test for the key rather than read its
value. That is the same fact ADR 0046 insisted on one layer down, and writing
"on every edge" about a key that is omitted is how a consumer ends up reading a
missing `onDelete` as `no action`.

**A page is read against itself before it is read against the tree.** The two
never-true claims were internal contradictions, findable with no build at all.
That is the cheapest pass available and it went first here.

**What this deliberately does not do is add a guard.** The tempting one reads
the skill's claims and checks them, and it cannot be written: "an error blocks
the canonicalise step" is a sentence, not a command name, and the rule that
matched it would have to understand what the sentence means. Inferring intent
from nearby words was refused once already, in ADR 0036, for exactly this
reason. What is available instead is the citation: a sentence that names the
record it came from is a sentence whose author can be found, and a record that
is superseded is a thing this repository already tracks. That is weaker than a
check and it is honest about being weaker.

## Consequences

- **The skill grew rather than shrank.** The re-import is now a subsection with
  a table in it where it used to be one wrong sentence, because the contract has
  three exits and nine change kinds and there is no shorter true version. The
  paraphrase of what a delta is for went to a citation, so the page pays for the
  contract by not restating ADR 0050's reasoning.
- **The nine `kind` values are now named in two places**, here and in
  `src/import/delta.ts`, and that is the shape this record warns about. It is
  taken knowingly: they are the branch an agent writes code against, a name that
  disappears is a branch that stops firing silently, and a name that appears is
  one an agent never learns about. The alternative, "branch on `kind`" with no
  list, tells a caller to write a switch over a vocabulary it cannot see.
- **`dbmd import --help` and the skill can still disagree.** Nothing here makes
  them agree; the skill just has less surface to disagree over. The four
  paragraphs about the pipeline cost, the standard input path and what a
  re-import never touches live in `--help` alone now.
- **This does not reach `README.md`, `docs/ci.md` or `AGENTS.md`**, which are
  the other pages that describe commands in prose. The rule is stated generally
  because the reasoning is general, and it has been applied to one file, which
  is the one that was found wrong.
- **The evidence is dated and lives in `docs/process/verified.md`**, not here.
  ADR 0082 is why: a claim about what was measured carries a date, and a record
  that copies the measurement in becomes a second place for it to go stale.

## Revisit when

- **A sixth stale claim is found in this file.** Then the citation habit is not
  holding and the question is what could be mechanised after all. The likeliest
  candidate is narrow and shaped like the existing guard: a marked claim, written
  by the author beside the sentence, naming the exit code or the diagnostic code
  it is about, checked against the CLI the way a backticked command already is.
- **A `kind` value is added to or removed from the delta.** The list above has
  to move with it, and if that turns out to be missed, the answer is to stop
  listing them and say where they are defined instead.
- **A second skill is shipped.** This was written from one file and the rule
  should be read against the second one before it is treated as the house style.
- **The studio API grows a version and a reference page.** The skill's paragraph
  about not driving it is a judgement about a moving surface, and ADR 0039 owns
  that condition. This record only notes that the paragraph's third reason has
  already moved once, when `dbmd refs` landed.
