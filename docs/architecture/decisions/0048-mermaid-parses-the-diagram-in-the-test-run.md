# 0048. Mermaid parses the diagram, in the test run

## Context

`dbmd export` writes an `erDiagram` into a README so that a pull request shows a
changed picture. ADR 0023 is careful about the way that fails: a name mermaid's
grammar cannot spell produces no error anywhere a person looks, and what GitHub
renders is a blank box, in somebody else's pull request, days later.

The prevention was built and the detection was not. `test/export/mermaid.test.ts`
said so in its own first paragraph:

> The claim every test here is really making is that the emitted diagram
> **parses** ... There is no mermaid parser in this repository to assert that
> against, and adding one would be a dependency the size of a browser, so what
> these tests assert is the shape the diagram was measured to need.

So every assertion in that file stood in for a claim it could not make, and the
rules it stood in for were measured by hand once, against mermaid 11.17, and
believed afterwards. dbmd-7s6 was raised to settle the parenthetical rather than
to assume it. Measured on 2026-09-07, on Node 24.19 and mermaid 11.17.2:

- **`@mermaid-js/parser` 1.2.1 does not cover `erDiagram`.** It is the Langium
  package the project is migrating grammars into, it is small, and its `parse`
  is typed for `info`, `packet`, `pie`, `treeView`, `architecture`, `gitGraph`,
  `eventmodeling`, `radar`, `railroad`, `treemap`, `wardley` and `cynefin`. ER is
  not among them; it is still the jison grammar compiled inside `mermaid`.
- **`@mermaid-js/mermaid-cli` is the dependency the size of a browser.** It
  renders through puppeteer and downloads Chromium. Refused, and the original
  sentence was right about it.
- **`mermaid` itself parses without a DOM.** `mermaid.parse('erDiagram ...')`
  resolves in plain Node with `typeof document` and `typeof window` both
  `undefined`: no jsdom, no browser, no globals installed. Rendering needs a
  DOM; parsing was never the same thing, and that is the half of the recorded
  reason that was wrong. The import costs about a second once, and a parse about
  two milliseconds.
- **The grammar cannot be vendored.** The published `mermaid` tarball ships
  `dist/` only, with no `.jison` sources, so there is nothing to compile against
  a `jison` devDependency. Writing a parser here instead was refused for a
  better reason than size: it would be a second derivation of the same guesses
  `src/export/mermaid.ts` already makes, and it would agree with them.

The cost is real and it is all on this side of the `files` allowlist, which is
`dist` and nothing else (ADR 0024). A dev install goes from 56 packages and
64 MB to 169 and 209 MB. Nothing in the tree has install scripts or native code,
and `check:pack` reads the manifest inside the tarball, so a devDependency that
leaked into what a stranger downloads would fail the gate rather than ship.

## Decision

**`mermaid` is a devDependency, and the tests hand every diagram they build to
`mermaid.parse` before asserting anything about it.** The one property this
module exists to have is now asserted by the same grammar GitHub renders with,
on every run, instead of by a person with a browser tab open once.

**What is parsed is what an import produces, not `examples/shop`.** The tame
model proves the least interesting case. The cases asserted are the two
committed provider payloads, a diagram a live SQL Server 2022 produced through
import and export, and, for the characters no filesystem will hold, models built
in memory: `mermaidDiagram` is public API (ADR 0006), so a caller can hand it a
name that was never a file.

**The parser is asserted to refuse things too.** A block of ten strings, each
one what this module would emit if a rule of ADR 0023 were dropped, is asserted
to be a parse error. ADR 0034's rule applies here as much as to any script: a
check that has never said no looks exactly like one that cannot.

**The first run corrected three rules and found a fourth thing.** This is the
part worth the dependency, and all four came out of the first hour:

1. **A word may not open with `-`, `.`, `[`, `]`, `(` or `)`.** All of them are
   legal in the middle of a type or a name and a parse error at the front of
   one, in both positions. `word` guarded a leading digit only, so `[int]`,
   which is how the SQL Server catalogue spells a type to itself, and a column
   called `(deleted)` each produced a diagram that renders as nothing. The rule
   is now the one that was already there, generalised: a word opens with a
   letter of any script or an underscore, or it gains a leading underscore, and
   `attribute` writes the true `type name` into the row's comment because the
   word changed.
2. **A `\` and a `%` are refused inside a quoted entity name.** ADR 0023 records
   that a quoted name took "every character tried", and these two were not
   tried. `a\b` is a legal table name on Linux and `%%` opens a comment to
   mermaid's lexer. Their numeric escapes, `#92;` and `#37;`, are accepted where
   the characters are not, so they join `#`, `"`, `<` and `>` in `escaped`.
3. **An empty entity name is a parse error.** `readModel` skips dot-files so a
   table read from a directory is never called nothing, but a model built by a
   caller of the library can be, and ADR 0027 is explicit that an empty name is
   kept rather than lost. A nameless table now draws a nameless box, `" "`,
   rather than a name this module invented or a diagram that does not render.
4. **A bare entity name has stopped failing loudly.** `order items {` parses in
   mermaid 11.17 as the entity `order` with the alias `items`, where ADR 0023
   measured it as a parse error. Nothing here depends on that, because every
   entity name is quoted, but it changes what dropping the quotes would cost:
   not a blank box, which somebody eventually reports, but a picture of a table
   nobody has. ADR 0023 is amended by appending rather than edited, per the
   decisions README.

## Consequences

- **A mermaid release can turn this suite red for something nobody changed.**
  That is the arrangement working: the grammar is somebody else's and this is
  the only place the drift is observable. `package-lock.json` pins the version
  `npm ci` installs, so the day it moves is a day somebody chose.
- **`npm ci` is slower and `node_modules` is three times the size.** Both are
  dev-only. CI already caches npm and runs two Node versions, and the parse
  assertions add about a second per test file, once, for the import.
- **A diagram nobody wrote a test for is still unparsed.** This asserts the
  cases in the file, not every model in the world. `dbmd export` does not parse
  what it writes at runtime, and that stays true: the dependency is not shipped
  and the command must run on an install that does not have it.
- **`mermaid.parse` is not `mermaid.render`.** A diagram that parses can still
  lay out into a wall nobody can read, which ADR 0023 already answers with a
  sentence and `dbmd studio`.
- **Two of the four findings above are corrections to a decision record.** The
  record is amended by appending, and the reasoning that turned out to be wrong
  is still readable, which is the whole point of the convention.

## Revisit when

- **`erDiagram` moves to `@mermaid-js/parser`.** That package is one dependency
  and a few hundred kilobytes, and the migration is why it exists. On the day ER
  appears in its `parse` overloads, this can shrink to it and the whole cost
  argument above goes away.
- **A blank box is reported anyway.** That is the evidence that what is parsed
  and what GitHub renders have come apart, and the first thing to check is
  whether GitHub's mermaid is older than the pinned one.
- **The install cost starts being paid by somebody who is not developing dbmd.**
  It is a devDependency today. If a consumer ever needs the diagram validated at
  runtime, that is a different decision with a different dependency, and it
  starts by reading what `files` promises.
