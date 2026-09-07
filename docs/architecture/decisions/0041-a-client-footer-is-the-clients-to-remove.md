# 0041. A client footer is the client's to remove

## Context

`dbmd query --engine sqlserver` prints a comment block on top of its SQL, and
that block is the instructions rather than decoration. One of the three routes
it offered for saving the result was a copyable command:

```
sqlcmd -S server -d yourdb -y 0 -Y 0 -i query.sql -o model.json
```

Run exactly that and `dbmd import` refuses the file. Measured on 2026-09-07
against SQL Server 2022 (16.0.4265.3) in the
`mcr.microsoft.com/mssql/server:2022-latest` container, with `sqlcmd` 18.6.0002.1
and a six-column schema:

```
$ sqlcmd -S localhost -U sa -P ... -C -d Shop -y 0 -Y 0 -i query.sql -o model.json
$ tail -c 40 model.json | od -c
0000000   o   n   "   :   "   N   O   _   A   C   T   I   O   N   "   }
0000020   ]   }   ]   }  \n  \n   (   1       r   o   w   s       a   f
0000040   f   e   c   t   e   d   )  \n

$ dbmd import --file model.json --dir out
dbmd: model.json is not JSON: Unexpected non-whitespace character after JSON at position 2333
The usual cause is a paste that stopped early.
```

The file is 2351 bytes. The JSON is the first 2333 of them and is byte-for-byte
correct: cut the trailing 18 and the same file imports, `dbmd check` reports `2
tables, 0 notes, 0 groups, no problems.` and `--strict` exits 0, with
`nvarchar(max)`, `datetimeoffset(7)`, `decimal(12,2)` and the composite unique
index all right. **Nothing is truncated. The file is too long, not too short.**

That inverts the message the user is given. `dbmd import` says the usual cause is
a paste that stopped early and points at this very comment block for how to save
a result properly, so a user following the tool's own instruction is sent hunting
a truncation that did not happen, by a cross-reference that was built on purpose.
It is the first step of the journey for one of the two supported engines.

Four ways out were measured, and three of them are closed:

- **`-h -1`**, which does suppress the row count: `Sqlcmd: The -h and the -y 0
  options are mutually exclusive.` `-y 0` is what stops sqlcmd truncating the
  value at 256 characters, so it is not negotiable.
- **`-r1`**, which sends messages to stderr: the file still ends `(1 rows
  affected)`. The row count is not a message.
- **`-Q "SET NOCOUNT ON"` alongside `-i`**: `Sqlcmd: The i and the Q options are
  mutually exclusive.`
- **`SET NOCOUNT ON`**, which works. Both ways of running it were measured:
  prepended to the query text, and as a second input file. Each produces the
  same 2332 bytes ending `}]}]}\n`, and each imports first try.

So the question is not what fixes it. It is where `SET NOCOUNT ON` goes.

## Decision

**The introspection query carries no statement that exists for one client.** The
row count is sqlcmd writing into the file it was told to write; the query did not
put it there and no other client produces it. So it is removed on the sqlcmd
route, in a file of sqlcmd's own:

```
sqlcmd -S server -d yourdb -y 0 -Y 0 -i nocount.sql -i query.sql -o model.json
```

where `nocount.sql` is the single line `SET NOCOUNT ON;`. Two `-i` flags rather
than sqlcmd's documented `-i file1,file2` comma list, because the repeated form
works on both the ODBC `sqlcmd` this was measured on and go-sqlcmd, which takes
`-i` as a repeated flag.

**Prepending it to the query was rejected**, and not narrowly:

- **The query would stop being one statement.** The comment block's own first
  promise is that it is one statement with no `GO`, so it pastes whole into SSMS,
  Azure Data Studio, sqlcmd or a JDBC console alike. A client that executes the
  statement under the cursor rather than the buffer, which is the default binding
  in DBeaver and in several JDBC consoles, would then run `SET NOCOUNT ON` and
  show the user nothing at all. That is a new failure on a route that works today,
  traded for a fix on one that does not.
- **It would weaken the read-only claim, which is the query's whole pitch.** The
  block says the query is "written to be checked rather than trusted" and lists
  what is not in it: "There is no INSERT, UPDATE, DELETE, MERGE, CREATE, ALTER,
  DROP, TRUNCATE, GRANT, BACKUP, EXEC or SET anywhere in it". A DBA can verify
  that by searching for those words. Adding a `SET` turns a mechanically
  checkable claim into one with an exception, permanently, for every reader on
  every route, to fix an artefact of one of them. `test/import/sqlserver.test.ts`
  already asserts that list, `set` included, so the repository had encoded this
  position before anybody wrote it down.
- **It is not true of the query.** `SET NOCOUNT ON` is session state. A query
  that describes itself as creating nothing would begin by changing something.

**The comment block also stops promising that a JSON failure means truncation.**
The position `dbmd import` prints tells the two apart, and now says so: short of
the end of the schema is a copy that stopped early; at the end of the JSON with
something after it is the client's own footer, whether that is a row count, a
column header or a table frame.

## Consequences

- **The sqlcmd route now costs a second file.** It is one line and the user
  writes it once. The alternative that costs nothing at the prompt costs the
  paste-whole property instead, which is the more expensive of the two.
- **The query text did not change**, which matters more than it looks: it is
  proven against live databases and `test/import/fixtures/sqlserver-raw.json` is
  real output from it. Nothing in the fixtures, the parser or the contract is
  touched by this record, and the SQL below the comment block is byte-for-byte
  what it was.
- **The comment block is longer**, and it is the block that is already the
  longest thing in the file. That is the standing bet in `sqlserver.ts`: the
  person about to copy a result is certainly reading this and is certainly not
  reading a documentation page.
- **The asymmetry with Postgres is now a stated gap rather than an accident.**
  The Postgres query gives no client invocation at all, only "Save that value to
  a file", and it was assumed that this made it safe. It does not. Measured the
  same day, on `postgres:16`:

  ```
  $ psql -d shop -f pg.sql -o pgout.json
  $ tail -c 80 pgout.json
  umns":["id"]},"indexes":[],"foreign_keys":[],"check_constraints":[]}]}
  (1 row)

  $ dbmd import --file pgout.json --dir out
  dbmd: pgout.json is not JSON: Unexpected token 'd', ..."          dbmd_intro"... is not valid JSON
  ```

  psql's default output pads the value into a column, puts a header on it and a
  `(1 row)` footer under it. `psql -t -A` removes all three and the result
  imports first try. So Postgres has the same class of trap, one position
  earlier and with a worse message, and says nothing about it. This record's
  position applies there too: name the client's footer, and give the flags that
  remove it, without putting anything in the query. That change is not made here
  because this branch is scoped to `sqlserver.ts`, and it is owed.
- **A copyable command in a comment block is still a promise nothing can test.**
  No check in this repository runs sqlcmd, and none can. `test/import/sqlserver.test.ts`
  asserts that the recipe names `SET NOCOUNT ON` and both flags, which catches a
  future simplification back to the broken form, and does not catch sqlcmd
  changing under it.

## Revisit when

- **A client turns up whose footer `SET NOCOUNT ON` does not remove.** The answer
  then is not another special case in the block: it is that the block stops
  giving invocations and gives the shape of a correct file instead, which is what
  the Postgres block does today by accident rather than on purpose.
- **`dbmd query` grows a way to ask for a client's route**, such as printing the
  `SET NOCOUNT ON` line itself when asked. That would put the client-specific
  statement in the command rather than in the query, which is this record's
  position, and would make the second file unnecessary. It was not done here
  because it is new CLI surface for a documentation defect.
- **Somebody proposes putting `SET NOCOUNT ON` in the query again.** Read the
  three reasons above before agreeing; the cheap-looking fix is the one that was
  measured and rejected, not the one nobody thought of.
