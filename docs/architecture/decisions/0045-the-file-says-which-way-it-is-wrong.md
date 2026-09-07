# 0045. The file says which way it is wrong

## Context

`src/cli/import.ts` owns the one failure no provider can own, because a provider
is handed a value and never the characters: the pasted text is not JSON. Until
this record it said the same thing every time.

```
dbmd: model.json is not JSON: <what JSON.parse said>
The usual cause is a paste that stopped early. A client that hands a long result
back in pieces produces JSON that looks finished and is not, which is why the
comment above the query you ran says how to save its result rather than copy it.
```

That was true when it was written, and
[ADR 0041](0041-a-client-footer-is-the-clients-to-remove.md) measured it being
wrong for **both** documented routes at once, in the same direction:

- **sqlcmd** appends `(1 rows affected)` unless `SET NOCOUNT ON` runs first, so
  the file is too **long** and the failure is at the very end.
- **psql** without `-t` writes a column header, a rule of dashes and a `(1 row)`
  footer, so the file is too **long** and the failure is at the very **front**,
  before a byte of JSON has been read.

Each engine's comment block now answers this locally, which is where a user who
has just run the query is looking. The shared message still sent everybody
hunting a truncation, and it is the message a user reaches first.

### The position is not the thing to branch on

The obvious fix is to read the position `JSON.parse` reports, since a failure at
position 0 is not a paste that stopped early. Measured on Node 24.19.0, V8
13.6.233.17, over files built to match the two routes above:

```
$ node dist/cli.js import --file header.json --dir out
dbmd: header.json is not JSON: Unexpected token 'd', " dbmd_intro"... is not valid JSON

$ node dist/cli.js import --file footer.json --dir out
dbmd: footer.json is not JSON: Unexpected non-whitespace character after JSON at position 3933 (line 3 column 1)
```

**The case a position would settle most cleanly is the case the position is
missing from.** V8 prints an offending token and a fifteen-character excerpt,
and no position at all, when the parse fails at the front. So a branch on the
position would have got psql exactly as wrong as the old sentence did, and would
have looked correct in review.

What is always there is the text. The shape it has to have is the shape both
engines' comment blocks already state: one value that begins `{` and ends `}`,
with no header above it, no row count under it and no padding round it.

## Decision

**`dbmd import` reads the file's own two ends, and says which of four things
happened.** In order, over the text with any byte-order mark removed and the
outer whitespace trimmed:

1. **It does not begin with `{`.** The parse stopped in front of the schema
   rather than inside it, so nothing was truncated, and what is above the JSON
   is the client's own: a column header, a rule of dashes, a frame round the
   value. `likelyCause: a header in front of the JSON`.
2. **It holds a whole JSON value and then more.** The text up to the last `}`
   is parsed, and if that succeeds the file is too long rather than too short and
   what follows is the client's own footer. `likelyCause: a footer after the
   JSON`.
3. **It begins `{` and does not end `}`.** A paste that stopped early, which is
   still what this usually is and is still right for a copy out of a grid.
   `likelyCause: the paste stopped early`.
4. **It begins `{` and ends `}` and still will not parse.** Both ends are right
   and the damage is between them, at the position the parser named. A client
   that breaks a long value across lines writes a continuation character into
   every break, and a copy that lost a piece in the middle looks identical from
   here, so **the message names neither** and says where to look instead.
   `likelyCause: a break inside the JSON`.

**The second case is decided by parsing, not by guessing.** A prefix ending at
the last `}` either is a whole JSON value with something written after it, or it
is not. Nothing is kept from that parse and the file is still refused: a client's
footer is the client's to remove, which is ADR 0041's position and this record
does not reopen it.

**The shape sentence is printed in all four cases, not only in the fourth.** It
is the one line a reader can act on without knowing which case they are in, and
it is what the Postgres comment block settled on for the clients nobody could
measure. The message names no engine, so the reference to the per-client fix
stays a pointer at the comment block above the query, which is where an engine's
name is allowed to live. ADR 0007.

## Consequences

- **The message is six lines rather than four.** This is the first step of the
  journey for both engines and the most likely support question the import path
  will ever produce, so it buys the extra two lines. Every line is constant text:
  no count and no excerpt is interpolated, so a sentence cannot be made to wrap
  differently by the file it is describing.
- **`likelyCause` in `--json` now has four values rather than one.** It was
  prose before and is prose now, and a caller that compared it to
  `the paste stopped early` still matches the case that string describes. The
  four are listed in `docs/import-format.md`.
- **A file that is too long is still refused rather than trimmed.** dbmd could
  now import case 2 by cutting at the last `}`, since it has just proved that
  prefix parses. It does not, and the reason is that the tool would then be
  silently accepting whatever a client wrapped a result in, which is exactly the
  habit the comment blocks exist to break. If that ever becomes desirable it is
  a flag somebody asks for, not a default.
- **`test/import/sqlserver.test.ts` stopped asserting the comment block raw.**
  It matched `/stopped early/` and `/Results to File/` against the SQL text, so
  rewrapping a paragraph to 80 columns turned the build red while deleting the
  paragraph's meaning did not. The Postgres guard next to it already flattened
  the block first, and that is the shape both now use: strip the `--` markers,
  collapse the whitespace, assert the sentence. **A guard on prose asserts what
  the prose says, never where it wraps**, and the same helper does it for the
  narration in `test/cli/import.test.ts`.
- **One assertion depends on a V8 message.** `test/cli/import.test.ts` asserts
  that the parser names no position for the header case, because that is the
  evidence for reading the file instead. If a future V8 adds one, that test goes
  red and this record is the thing to reread. The classification itself does not
  change: it never read the position in the first place.

## Revisit when

- **A fifth shape turns up.** The four here are the ones two engines and their
  documented clients produce. A client that writes a footer containing `}`, or
  one that emits two values, lands in case 2 or case 4 and is told something
  true but vague. Add a case only with a file that a real client produced.
- **`JSON.parse` starts reporting a position for a failure at the front.** That
  would make the position a usable signal again, and it would still be a weaker
  one than the text: a position of 0 says the parse failed early and does not
  say the file is too long.
- **Somebody proposes trimming the file to the JSON.** Read the third
  consequence above, and ADR 0041, before agreeing.
