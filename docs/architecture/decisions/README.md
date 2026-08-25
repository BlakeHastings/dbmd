# Decision records

One file per decision, numbered, never renumbered. `NNNN-kebab-title.md`.

A record has four parts and no template beyond them: **Context** (what was true
when this was decided), **Decision** (what we are doing), **Consequences** (what
this costs, including what it makes harder), and **Revisit when** (the observable
condition that should make somebody read this again).

Numbers are handed out by the orchestrator, checked against `main` and every
open pull request. Do not take "the next free number" yourself: two agents doing
that collide, and a caught collision still costs a rebase.

Superseded records stay. Append the correction rather than editing the original,
so the reasoning that turned out to be wrong is still readable.
