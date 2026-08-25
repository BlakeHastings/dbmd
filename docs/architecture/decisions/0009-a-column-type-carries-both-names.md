# 0009. A column type carries both the native name and the normalised one

## Context

ADR 0007 left this open and named the condition for settling it: "the normalised
type vocabulary starts losing information people care about, at which point the
model needs to keep the native type alongside the normalised one rather than
choosing".

Building the contract for dbmd-40 made it clear that the condition is not a
future event. The vocabulary loses information on the first column of the first
import anybody runs:

- `timestamp with time zone` and `timestamp without time zone` both normalise to
  `timestamp`, and SQL Server's `datetimeoffset` and `datetime2` do the same.
  Which one a column is is usually the most consequential fact about it.
- `nvarchar` and `varchar` both normalise to `string`, and the difference is what
  the column can hold.
- `money`, `citext`, PostGIS `geography`, a Postgres enum and any user-defined
  type normalise to `decimal`, `string`, `other`, `other` and `other`.

The two candidate shapes were one string or two. One string in the normalised
vocabulary is what the model can switch on without knowing the engine, which is
the entire reason the seam exists. One string in the engine's own spelling is
what a person recognises and what nothing generic can read.

The asymmetry that settles it is recovery. A model written from an import that
carried only the normalised name cannot get the native one back. Adding the field
later is additive and cheap in the code, per ADR 0006, and expensive everywhere
else: every markdown file already written from an import lacks it, and the fix is
asking every user to re-import against a database they may no longer have.

## Decision

**`ColumnType` carries `native` and `normalised`, and both are required.**

`native` is the engine's own name for the type, with no modifier: `nvarchar`
rather than `nvarchar(32)`, `numeric` rather than `numeric(12,2)`. The modifier
lives in `length`, `precision` and `scale`, so the two cannot drift apart.

`normalised` is a member of a closed vocabulary defined in `src/import/contract.ts`.
Anything outside it is `other` rather than a guess, and `native` is left to speak.

`EngineProvider.normaliseType` therefore returns that union rather than ADR 0007's
`string`. An open return type cannot be switched on, and being switchable on is
the only reason the normalised name exists.

## Consequences

- **Two fields per column instead of one**, in the JSON, in the types, and in
  every provider. That is the price and it is small.
- **A provider has one more way to be inconsistent**, which is why `native`
  carries no modifier: with the modifier in there, `native: 'nvarchar(32)'` and
  `length: 40` could disagree and neither would be obviously wrong.
- **`other` is a supported answer rather than a failure.** A provider for an
  engine full of types this vocabulary has never heard of still produces a valid
  document, and the information survives in `native`.
- **Growing the vocabulary is a version-visible change.** Adding a member means a
  file produced by a newer dbmd can carry a `normalised` value an older one
  rejects, which is a `dbmdIntrospection` bump and is what that field is for.

## Revisit when

- **Something starts parsing `native`.** A consumer picking substrings out of it
  means the normalised vocabulary is not carrying its weight and needs a member
  rather than a workaround.
- **`other` becomes common in a real model.** For enums in particular it hides
  the members, which is the first thing anyone will ask for.
- **A third engine has no stable native name to give.** SQLite's declared types
  are whatever the author typed, which makes `native` less reliable than it is
  here, and is the case that would test whether "required" was right.
