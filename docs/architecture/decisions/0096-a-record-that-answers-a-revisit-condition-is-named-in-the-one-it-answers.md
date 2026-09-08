# 0096. A record that answers a revisit condition is named in the one it answers

## Context

A sweep on 2026-09-08 read all 331 `## Revisit when` conditions across the 92
decision records. 28 were already recorded as fired and skipped, 303 were
re-judged, and **5 had fired with nothing on the record saying so.**

Three of the five were one shape.

| the record that acted | the record it acted on | how often it names it | how often it is named back |
| --- | --- | --- | --- |
| 0092, which opens "Answers a condition ADR 0083 wrote down for itself" | 0083 | 7 | 0 |
| 0076, whose line 85 says in those words that it answers 0069's first entry | 0069 | 8 | 0 |
| 0082, whose Decision opens "ADR 0058's pattern fits here and is applied" | 0058 | 6 | 0 |

**The cost is not a missing link.** It is that each of 0083, 0069 and 0058 went
on presenting a condition as open after the condition was answered, in writing,
by a record sitting in the same directory. A sweep can only read the conditions
somebody wrote, which is ADR 0082's sentence and is the whole problem: the next
reader re-judges finished work as unfinished, and there is nothing on the page
that would stop them.

**One-way citation is normal and is not the problem.** A record is history. It
cites what came before it, and an earlier record has no reason to grow a link
every time a later one leans on it. So the rule cannot be that records cite each
other. It is a problem in exactly one situation: when the acting record answers a
`Revisit when` condition of the target.

**The measurement of that, and what it counts, because the count and the three
cases above do not obviously fit together.** A record declares its lineage in the
lines above its first `##` heading: "Refines ADR 0004", "Closes the last thing
ADR 0019 left open", "Answers a condition ADR 0083 wrote down for itself".
Counting only those, on `main` at c5e95a5, there are **27 declarations, of which
20 are never named back anywhere in the target.** The sweep judged 19 of the 20
harmless and one worth fixing.

**Three fixed and one harmful is not a contradiction, and the reason is worth
having.** Only 0092's declaration of 0083 is inside the 27. The other two name
the record they answer further down the page: 0076 does it in its Context, and
0082 has no preamble at all, so neither was ever in that count. A count of
lineage declarations and a count of answered conditions are two different
questions about the same directory, and reading one as the other is what made
this number look wrong. **The gap runs the other way too, and it is the sharpest
thing about this check's reach**: the one harmful pair the sweep's count contains
is 0092 to 0083, and this check cannot see it.

## Decision

**`scripts/check-adr-backlinks.mjs`, in `npm run check` as `check:backlinks`,
immediately after the numbering check that already reads this directory.**

It reads one line at a time and asks two questions. Does the line carry the words
"revisit entry" or "revisit condition"? Does it name another record on the same
line? Both, and the named record has to name this one somewhere. That is the
whole rule, and a four digit number that is not a record on disk is not a
reference, which is what keeps years and measurements out without a list of
exceptions to maintain.

**How narrow it is, said in its own summary line on every green run**, the way
`check-commands.mjs` states what it covers and `check-duplication.mjs` prints its
current margin. It sees a record that says in those words that it is acting on
another record's list. It does not see one that answers a condition without
saying so, and that is most of them. Of the three cases above it catches one:

```
0076 -> 0069   "This answers ADR 0069's first revisit entry"           caught
0092 -> 0083   "Answers a condition ADR 0083 wrote down for itself"    not caught
0082 -> 0058   "ADR 0058's own list came closer and still missed"      not caught
```

**The proposal this was built from said three occurrences and three hits, and
that did not reproduce.** Measured against `main` at c5e95a5, the tree this was
written against: **5 occurrences and 1 finding.** The other two of the three say
the same thing in different words and no phrase rule reaches them. The number in
the proposal is corrected here rather than repeated, because a guard credited
with three times its reach is worse than a guard nobody has heard of.

**Two widenings were measured and rejected.**

- **Adding "revisit when" to the phrase set** takes the same tree to 8
  occurrences and 2 findings, and the second finding is wrong. ADR 0063's own
  list points at ADR 0006's list as context for a decision nobody has taken,
  which is not a claim to have answered anything, so ADR 0006 owes it no link.
- **Reading a paragraph instead of a line** takes it to 17 and 12. Almost all of
  the 12 are a record's own `Revisit when` bullet naming other records as
  context. The same defect as the one above, one order of magnitude louder.

**A fenced block and a blockquote are skipped, and this record is why.** The
first run of the finished check over a tree containing this record refused it, on
the fenced block above: it quotes all three of the sentences the rule was built
from, so it reads as this record claiming to answer 0069's and 0083's conditions.
That is the rule working as written and answering the wrong question. A record
quoting somebody else's sentence is not making a claim of its own, so a line
inside a fence and a line beginning with `>` are not read. The table row above
was reworded for the same reason rather than exempted, because a table row is
this record's own prose and the fence below it already carries the quotation.

**Rejected: matching the quotation rather than the phrase.** A record that
answers a condition usually quotes it, and a longest-run comparison against the
target's `Revisit when` section does catch all three. It was written and measured
before this was: at an 80 character window it reports 10 occurrences and 7
findings, and 4 of the 7 are one record restating another's condition as context
rather than answering it. ADR 0030's first entry restates ADR 0005's first entry
in nearly the same words, on purpose and while naming it, and 0005 owes it
nothing. A guard whose findings are more than half wrong is one people learn to
skim.

**Why this scans `docs/architecture/decisions/` when `check-commands.mjs`
deliberately does not.** The two guards make opposite choices about one directory
and both are right, because they ask opposite questions of it.
`check-commands.mjs` fails a page that names something which no longer exists,
and a record says what was true when it was decided, so pointing it here would
fail the build until an author edited history. Its header says exactly that. This
check never asks a record to change a word it wrote. It asks the *other* record
to append a section saying it was answered, which is what
`docs/architecture/decisions/README.md` already tells everybody to do: superseded
records stay, and the correction is appended.

## Consequences

- **It costs under a tenth of a second.** Three runs at 95ms, 81ms and 74ms wall
  clock on this machine, against a `node -e "0"` baseline of 67ms, 50ms and 53ms,
  so the work itself is roughly 25ms and the rest is Node starting. The gate is
  58 to 60 seconds idle. It reads every record in this directory once, calls no
  `git`, touches no network and imports nothing outside `node:`.
- **It refuses `main` as it stands.** The 0076 finding is real on c5e95a5, and
  the section appended to ADR 0069 in this pull request is what makes the check
  green. A guard installed over a tree it has never refused is the thing ADR 0034
  is about.
- **It catches one of three, and the number is on the summary line.** Nobody has
  to open the script to learn what it does not do.
- **The appended sections in this pull request were written so this check can see
  them.** Each heading carries the words and the number, so 0083, 0069 and 0058
  now hold covered occurrences of the very pattern that went unnoticed in them.
  That is the check being fed rather than the check working, and it is worth
  saying out loud: it raises the count without raising the reach.
- **`test/guards/broken-on-purpose.test.ts` has five cases**, and the third one
  is the unusual one. It asserts the summary line still says "invisible to it"
  over a tree holding a 0092-shaped sentence the check cannot see, so the
  admission is a test rather than a comment somebody can quietly delete. The
  fifth holds the fence rule this record's own refusal produced.
- **`AGENTS.md`'s list of what `npm run check` is gains a clause.** That sentence
  enumerates the steps in order and a new step makes it wrong, which is the class
  of stale claim ADR 0084 exists over.

## Revisit when

- **A fourth condition is answered without those words.** Then the phrase set is
  the wrong shape rather than a narrow one, and the question becomes what a
  record answering a condition actually has in common. Two mechanical proxies for
  that were measured above and both are worse than nothing; a third would need
  its own measurement before it went in.
- **A finding turns out to be wrong.** One already did, on this record, and the
  answer was the fence rule above rather than a narrower phrase. The next one is
  the argument for narrowing the phrase set or for moving the rule off a line and
  onto a sentence, and it should be recorded here with the sentence that caused
  it.
- **Somebody wants this over `docs/process/` as well.** It reads only
  `docs/architecture/decisions/`, because `Revisit when` is a decision record's
  section. A process page that answers a record's condition is not covered and
  nothing here would notice.
- **The count on the summary line stops moving while records are still being
  answered.** That is what a sweep quietly ceasing to find anything looks like,
  and it is the reason the count is printed at all rather than a bare "no
  problems".
