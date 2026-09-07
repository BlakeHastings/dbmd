# 0043. A command owes the README an entry, and the heading stopped counting

## Context

ADR 0036 made a backticked command name a claim and checked it.
`scripts/check-commands.mjs` fails the build when something in this tree names a
command that does not exist. It found `dbmd query`, which seven places named and
nothing provided.

Nothing checks the other direction, and the other direction went wrong twice in
one day.

`dbmd import` shipped and left `README.md` saying the import path was
unfinished. `dbmd query` shipped and left a heading reading "The five commands"
over five entries while the CLI had six, and left a sentence saying that
printing the introspection query from dbmd was still open work, which had
stopped being true in the same commit. Every check in the gate passed on both.
Both were found by an agent who had come to build something else.

The defect is invisible for the same reason ADR 0036's was. A page that is
merely out of date is consistent with itself: there is nothing for a reader to
notice and nothing for a grep to find, and the only way to see it is to know
what the CLI does and read the page against that.

**The two halves of what broke are not the same kind of thing.** The count in
the heading is a fact somebody has to maintain. The entries are content that has
to exist. A check that reads a heading and counts the entries under it would
have caught the first, and it would be a check whose job a rewrite removes.

**The history says which halves go stale, and it is about distance.**
`AGENTS.md` has carried a count of the commands through five arrivals, from two
to seven, and has never once been wrong, because its count and its list are the
same sentence: editing the list puts your cursor next to the number. The README
heading counted entries that ended two hundred lines below it, and it was wrong
twice out of three chances.

## Decision

**The heading stops counting, and the registry decides what `README.md` owes.**

**"The seven commands" is "The commands".** Nothing checks it, because there is
nothing left in it that can go stale.

**`scripts/check-commands.mjs` fails when a command on the `COMMANDS` array in
`src/cli/main.ts` has no entry in `README.md`.** It is the same script and the
same read of the registry, asked a second question. A second script would work
out the command list a second way, and two lists of one fact that can disagree
is the defect ADR 0036 exists about.

**An entry is a paragraph that opens with the command in bold code**, which is
how all seven are already written:

    **`dbmd refs <table> [directory]`** answers "what points at this table".

The check recognises that convention rather than imposing one, and reads only
the word after `dbmd`. The arguments and flags beside it are the entry's own
business.

**`README.md` and nothing else.** It is the only file in this tree that promises
to document them all.

| File                | Names commands           | Checked |
| ------------------- | ------------------------ | ------- |
| `README.md`         | one entry each, in order | yes     |
| `AGENTS.md`         | one sentence listing all | no      |
| `docs/ci.md`        | two of them, on purpose  | no      |
| `docs/format.md`    | in passing               | no      |

Requiring an entry in the others would be asking for prose nobody wants to read
and would make `docs/ci.md` argue with its own subject. `AGENTS.md` is the
interesting exclusion: it does claim a complete list, and it is not checked
because its record is perfect and the reason is structural, above.

**The hypothetical marker needs no special case.** A command that exists is not
hypothetical, and ADR 0036's stale-marker rule already fails on the day one
becomes real. The two rules cannot both apply to the same name.

## Consequences

- **Adding a command is at least two files now**, its module and `README.md`,
  and the build says so at the moment the command is written rather than weeks
  later. That is the cost and it is also the point.
- **Being mentioned is not being documented**, and that is the near miss worth
  naming: a README that talks about the command in a sentence satisfies ADR
  0036, looks fine to a grep, and leaves a reader with nowhere to go. It fails
  this.
- **Being documented well is not checked and cannot be.** An entry that is
  present and wrong passes. This buys the floor, which is that a reader sent to
  the README for a command finds a heading about it.
- **A number that comes back into a heading is not caught.** Removing the fact
  was chosen over checking it, so nothing stops somebody writing "The eight
  commands" tomorrow. Review is the only guard there, which is acceptable
  because a number written today is read by the person writing it.
- **If the entry convention is restructured the check fails loudly**, for every
  command at once, rather than quietly matching nothing. A rewrite of the
  README's shape is a change to this rule and will present itself as one.
- **It is broken on purpose in `test/guards/broken-on-purpose.test.ts`**, which
  ADR 0034 requires of every guard in `scripts/`. Two cases: a registry command
  with no entry, and the same tree where the command is mentioned rather than
  documented.
- **It adds nothing measurable to the gate.** One more file read and one regex
  over it, inside a script that already reads 167.

## Revisit when

- **A second file starts promising a complete list.** A documentation site, or a
  `docs/commands.md`. Then it either joins this rule or it should say in its own
  words that it is a subset, the way `docs/ci.md` does.
- **`AGENTS.md`'s count goes wrong.** It never has. The day it does, the answer
  is the one taken here: the sentence loses its number, rather than gaining a
  check.
- **An entry is found that is present and badly wrong.** That is the case this
  deliberately does not cover, and it is the evidence for whether the floor is
  high enough.
- **A command is added that genuinely should not be in the README.** A debugging
  subcommand, say. There is no exemption today, on purpose: the first one should
  be argued for here rather than added quietly to a list in the script.
