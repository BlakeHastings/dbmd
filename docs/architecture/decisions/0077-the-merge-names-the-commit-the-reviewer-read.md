# 0077. The merge names the commit the reviewer read

## Context

[`scripts/merge-pr.mjs`](../../../scripts/merge-pr.mjs) is the only sanctioned
way anything lands on `main` here, and both of the refusals it already had are
about the branch. It refuses required checks that are not green, and it refuses
a branch that is behind its base, and it judges both against the head commit it
is about to merge. Those two have caught several bad readings in a single day
and they work. [ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md)
is why they are known to work rather than assumed to, and
[ADR 0058](0058-a-decision-that-needs-the-network-is-two-things.md) is why they
are unit tests.

**What nothing checked is whether the person merging read that commit.**

On 2026-09-07 an orchestrator read a pull request body describing an eleven line
change, said so in a written report, and merged it about twenty minutes later.
In between, the agent that owned the branch had force-pushed a second commit
carrying a correction to its own earlier work, an append to a second decision
record, and a further finding. The merge was safe: the green the wrapper checked
was against the head it merged, and what landed was good. It was still merged
unread, and **nothing could have said so**.

That case is invisible to everything else in the file. A force-push leaves a
pull request whose checks are green against the new head and whose branch is
level with its base, which is the state the script exists to let through. What
distinguishes the reviewed commit from the merged one is a fact the script holds
on one side only: it knows the head sha, and it is never told which sha the
reviewer read. `docs/process/orchestrating.md` had already written the gap down
under "A pull request you reviewed is not the pull request you merge", and the
instruction it could offer was to remember, which is the thing that failed.

## Decision

**A merge names the commit it is merging, and the name comes from the reviewer.**

```bash
node scripts/merge-pr.mjs 42 a1b2c3d
```

Four refusals implement it, all of them in `decideMerge` where their facts are
arguments:

- **No second argument.** The script says it cannot know what you read and tells
  you where to read it. It does **not** print the head sha. That omission is the
  decision rather than an oversight: a refusal that handed you the sha would be
  answered by copying a sha you had not read, and the control would ask for
  nothing. The refusal says so in as many words, so the next reader does not
  helpfully add it.
- **A second argument that is not a sha.** At least seven hexadecimal
  characters, which is what git abbreviates to and what GitHub prints beside a
  commit. `main` is the plausible mistake and it gets its own sentence rather
  than being reported as a mismatch. [ADR 0060](0060-a-guard-that-fails-two-ways-says-which.md)
  is the precedent: a guard that can fail two ways says which one happened.
- **A sha that is not a prefix of the head.** This is the incident. It prints
  the two shas on adjacent lines, labelled `you read` and `would merge`, then
  the command to re-read the diff and the command to merge with the new head.
- **A pull request with no head sha.** Unreachable unless the API changes shape.
  Refusing is the safe direction, because the alternative is a check that passes
  by being unable to run.

**The comparison is a case-insensitive, whitespace-trimmed prefix match.** Seven
to twelve characters of typing is the whole cost, and the caller already has
them: reviewing is where the sha is read. A form that demanded forty characters,
or a lookup immediately before every merge, is a rule people route around, and
**a control people route around is worse than none because it looks like
safety**.

**It is asked last**, after every refusal about the branch. A caller who forgot
the sha on a branch whose checks are red hears about the red check, fixes the
real problem, and spends one round trip rather than two. The order is asserted
by a test, because it is a choice and not an accident.

**A merge that goes through prints the head sha it merged.** The terminal is the
record that outlives the session, and a success line naming only a number leaves
the reviewed commit nowhere a later reader can find it.

**The decision is in `decideMerge`, not in the argument parsing.** ADR 0058 says
a branch in `main()` that decides something is the defect it removed, one layer
down and just as invisible. So `main()` reads `process.argv[3] ?? null` and
hands it over, and the four refusals above are eight tests in
`test/guards/broken-on-purpose.test.ts` alongside the existing ones.

## Consequences

- **Every merge costs a few characters of typing, and one habit changes.** The
  sha is read at review time, from `gh pr view <n> --json headRefOid --jq
  .headRefOid` or from the pull request page. Three process documents that gave
  the merge command now give it with a sha.
- **This cannot make anybody read.** A caller who is refused for a mismatch can
  copy the head sha out of the refusal and merge without looking at the diff.
  That is deliberate and it is the price of the refusal being fixable by copying,
  which is what separates a control from an obstacle. What the control does buy
  is that **"the head moved and I did not know" stops being available**: the
  script says the head moved, in the terminal, at the moment of the merge, and
  what is left is a choice somebody made rather than a thing nobody could see.
- **The race between reading the head and merging it is still open.** The head
  can move in the seconds between `gh pr view` and the merge call. GitHub's merge
  endpoint takes a `sha` parameter that refuses when the head has moved, which
  would close it exactly. It is **not** added here, because nothing available
  could watch it refuse without performing a merge, and ADR 0034 is the record
  saying a guard is not believed until it has been seen to fail. Whoever can
  watch it should add it.
- **A reworded refusal turns tests red.** ADR 0034 accepted that cost and it
  applies to the four clauses added here. Each assertion pins a phrase rather
  than a whole message.
- **Nothing in the tree called the wrapper with one argument**, so nothing broke
  silently. It is called by hand, by a person or by an orchestrator, and both
  get a refusal that says what to add.

## Revisit when

- **Somebody is seen reading the head sha immediately before merging rather than
  at review time.** That is the control turning into a ritual: the lookup is
  satisfying the argument rather than checking the commit, and the argument is
  then costing typing and buying nothing. The answer is not a longer refusal; it
  is to ask what the merge could be given that only a reviewer holds.
- **Somebody can watch the merge endpoint's `sha` parameter refuse.** The
  consequence above is the whole condition, and closing it removes the last
  window in which a merge can be of a commit nobody named.
- **Seven characters stops being unambiguous.** It is a prefix match against one
  known head rather than a lookup, so a collision needs the reviewer to have read
  a commit sharing seven characters with this head. If it ever happens, the
  refusal is the safe direction and `REVIEWED_SHA_MIN_LENGTH` is one line.
- **A second caller appears.** A workflow that merges cannot have read anything,
  and giving it a way to satisfy this argument is giving everybody one. If a
  merge ever needs to be automated, that is a decision about review rather than
  about this script, and it belongs in its own record.
