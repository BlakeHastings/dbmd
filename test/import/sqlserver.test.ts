// The real SQL Server provider, over two fixtures that are real query output.
//
// `sqlserver-raw.json` is the cross-engine fixture dbmd-40 committed: the same
// logical schema as `postgres-raw.json`, so the two can be compared. It is now
// what the query in `src/import/providers/sqlserver.ts` actually printed for that
// schema rather than a hand-written guess at it, and one line of the guess had
// been wrong in a way only a server could tell you: it gave the two sides of a
// composite foreign key different collations, which SQL Server refuses with
// `Msg 1757`.
//
// `sqlserver-provider-raw.json` is this provider's own, and exists because the
// cross-engine one deliberately holds only what both engines can say. The
// branches SQL Server has and Postgres has no counterpart for are here: a
// bracket inside a table name, a schema with a space in it, an alias type, a
// `rowversion`, a `text`, an index over a computed column beside an index over a
// column that is literally called `lower(ledger_code)`, a columnstore index, a
// heap, and a unique index that is not a unique constraint.
//
// Both were produced by pasting `sqlserverProvider.introspectionQuery()` into
// sqlcmd against SQL Server 2022 CU26 (16.0.4265.3) in the
// mcr.microsoft.com/mssql/server:2022-latest container, and pretty-printing the
// single result value. ADR 0007 is clear about what that does and does not
// prove: these files prove `parse`, and only a real database proves the SQL.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { IntrospectionDocument, Table } from '../../src/import/contract.js'
import { INTROSPECTION_VERSION } from '../../src/import/contract.js'
import { registry } from '../../src/import/providers/index.js'
import { sqlserverProvider } from '../../src/import/providers/sqlserver.js'
import type { Diagnostic } from '../../src/import/diagnostics.js'
import { readIntrospection } from '../../src/import/read.js'

/**
 * Where an import diagnostic points, asserted rather than assumed: every
 * diagnostic this module raises points into the document, never at a file.
 */
function jsonPath(diagnostic: Diagnostic | undefined): string {
  if (diagnostic?.at.in !== 'document') throw new Error('not a document location')
  return diagnostic.at.jsonPath
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
}

/** Through the front door, so the registry and the contract validator run too. */
function read(name: string): IntrospectionDocument {
  const result = readIntrospection(fixture(name))
  if (!result.ok) {
    throw new Error(`${name} did not read: ${result.diagnostics.map((d) => d.message).join('; ')}`)
  }
  expect(result.diagnostics).toEqual([])
  return result.value
}

function tableNamed(document: IntrospectionDocument, schema: string, name: string): Table {
  const found = document.tables.find((t) => t.schema === schema && t.name === name)
  if (!found) throw new Error(`no table ${schema}.${name}`)
  return found
}

describe('the registry', () => {
  it('resolves a SQL Server file without anybody naming the engine', () => {
    expect(registry.ids).toContain('sqlserver')
    expect(read('sqlserver-raw').engine).toBe('sqlserver')
    expect(read('sqlserver-provider-raw').engine).toBe('sqlserver')
  })

  it('is one file and one line, which is the whole of ADR 0007', () => {
    // Two engines and nothing outside `providers/` knows either name.
    expect([...registry.ids]).toEqual(['postgres', 'sqlserver'])
  })
})

describe('the query', () => {
  // These are cheap guards on the property the whole design leans on, which is
  // that a person can satisfy themselves by reading the query that it cannot
  // write. They fail the moment somebody adds a statement that could.
  const sql = sqlserverProvider.introspectionQuery()
  const withoutComments = sql
    .split('\n')
    .map((line) => (line.trimStart().startsWith('--') ? '' : line))
    .join('\n')

  /**
   * The comment block as one run of words.
   *
   * The assertions below are on sentences, and a sentence in a block wrapped to
   * 80 columns breaks wherever it happens to break. Reflowing a comment is not a
   * regression and is not worth a red build, so the markers come off and the
   * whitespace flattens: what is asserted is then what the block says rather
   * than where it wraps. Asserted against the raw text, `Results to File` and
   * `stopped early` both went red the first time somebody improved the
   * paragraph, which teaches people not to improve it. dbmd-aud.
   *
   * The one thing still asserted line by line is the sqlcmd invocation, which
   * has to stay on one line to be copyable and is found as a line on purpose.
   */
  const prose = sql.replace(/^--\s?/gm, '').replace(/\s+/g, ' ')

  it('is one statement, so it pastes into any client', () => {
    expect(withoutComments.match(/;/g)).toHaveLength(1)
    expect(withoutComments.trimEnd().endsWith(';')).toBe(true)
    // A GO would make it SSMS-and-sqlcmd only, and would also make it two
    // batches rather than one statement.
    expect(withoutComments).not.toMatch(/^\s*GO\s*$/im)
  })

  it('contains nothing that could write', () => {
    for (const keyword of [
      'insert',
      'update',
      'delete',
      'merge',
      'create',
      'alter',
      'drop',
      'truncate',
      'grant',
      'revoke',
      'backup',
      'restore',
      'exec',
      'execute',
      'into',
      'set',
    ]) {
      expect(withoutComments).not.toMatch(new RegExp(`\\b${keyword}\\b`, 'i'))
    }
  })

  it('reads only the catalog, so it cannot reach a row of user data', () => {
    const referenced = [...withoutComments.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)/g)].map(
      (match) => match[1] ?? '',
    )
    expect(referenced.length).toBeGreaterThan(0)
    for (const name of referenced) expect(name.startsWith('sys.')).toBe(true)
  })

  it('writes the version this build reads, so the two cannot drift', () => {
    expect(withoutComments).toContain(`1 AS dbmdIntrospection`)
    expect(INTROSPECTION_VERSION).toBe(1)
  })

  it('warns about the truncated paste in the text a user actually reads', () => {
    // The item this provider came from calls the 2033-character split the single
    // most likely support question the import feature will ever generate. The
    // warning therefore lives above the SQL, where somebody about to copy a
    // result out of the grid is certainly looking, and not only in a document.
    // If this assertion is ever in the way, the fix is to move the warning, not
    // to delete it.
    expect(prose).toMatch(/2033-character/)
    expect(prose).toMatch(/SSMS/)
    expect(prose).toMatch(/Results to File/)
    // And what happens on a server too old for FOR JSON, named rather than left
    // as a syntax error nobody can interpret.
    expect(prose).toMatch(/SQL Server 2016 or later/)
    expect(prose).toMatch(/Incorrect syntax near 'JSON'/)
  })

  it('gives a sqlcmd recipe that produces a file dbmd import accepts', () => {
    // The recipe it used to give was `sqlcmd -S server -d yourdb -y 0 -Y 0 -i
    // query.sql -o model.json`, and running exactly that produced a file
    // `dbmd import` refused: sqlcmd writes "(1 rows affected)" after the JSON,
    // so the file is 18 bytes too long rather than truncated, and the error the
    // user gets talks about a paste that stopped early. ADR 0041.
    //
    // Nothing here can run sqlcmd. What it can do is fail the day somebody
    // simplifies the recipe back to the one-file form, which is exactly how it
    // will be tempted to go: the extra file looks like clutter until you know
    // what it is for.
    const recipe = sql.split('\n').find((line) => line.includes('sqlcmd -S'))
    expect(recipe).toBeDefined()
    // Both flags. -y 0 stops the 256-character truncation, and the second input
    // file is what removes the row count.
    expect(recipe).toContain('-y 0')
    expect(recipe).toMatch(/-i\s+\S+\s+-i\s+\S+/)
    // And the block has to say what the second file holds, or the command is
    // uncopyable.
    expect(prose).toMatch(/SET NOCOUNT ON;/)
    expect(prose).toMatch(/\(1 rows affected\)/)
    // -h -1 is the obvious alternative and sqlcmd refuses it beside -y 0, which
    // is worth one sentence so nobody spends an afternoon rediscovering it.
    expect(prose).toMatch(/-h/)

    // SET NOCOUNT ON is named in the comment block and is not in the query, so
    // the query is still one statement and the read-only list above is still
    // true. `contains nothing that could write` asserts the second half; this
    // is the first.
    expect(withoutComments).not.toMatch(/NOCOUNT/i)
  })

  it('tells a footer apart from a truncation, because the position does', () => {
    // A file that is too long and a file that is too short both arrive as "not
    // JSON", and until ADR 0041 the block said it was always the second. The
    // position `dbmd import` prints is what separates them here, and `dbmd
    // import` now separates them itself from the file's two ends: ADR 0045.
    // Neither may go back to promising a truncation.
    expect(prose).toMatch(/stopped early/)
    expect(prose).toMatch(/row count/)
  })

  it('wraps its FOR JSON so the server cannot split the result across rows', () => {
    // Removing this wrapper is what re-opens the 2033-character split, and it
    // looks like a harmless simplification, so it is asserted rather than
    // trusted to the comment beside it.
    expect(withoutComments.trimStart().startsWith('SELECT (')).toBe(true)
    expect(withoutComments.trimEnd().endsWith(') AS dbmd_introspection;')).toBe(true)
  })
})

describe('normaliseType', () => {
  it('maps what TYPE_NAME prints', () => {
    expect(sqlserverProvider.normaliseType('nvarchar')).toBe('string')
    expect(sqlserverProvider.normaliseType('NVARCHAR')).toBe('string')
    expect(sqlserverProvider.normaliseType('bigint')).toBe('integer')
    expect(sqlserverProvider.normaliseType('bit')).toBe('boolean')
    expect(sqlserverProvider.normaliseType('decimal')).toBe('decimal')
    expect(sqlserverProvider.normaliseType('money')).toBe('decimal')
    expect(sqlserverProvider.normaliseType('datetimeoffset')).toBe('timestamp')
    expect(sqlserverProvider.normaliseType('uniqueidentifier')).toBe('uuid')
    expect(sqlserverProvider.normaliseType('varbinary')).toBe('binary')
    expect(sqlserverProvider.normaliseType('xml')).toBe('xml')
  })

  it('does not read SQL Server `timestamp` as a time, because it is not one', () => {
    // A rowversion column reports `timestamp` from TYPE_NAME, and it is eight
    // bytes of row version rather than a moment. This is the one type name in
    // either engine that collides with a normalised name and means something
    // else, so it is the one mapping that has to be there rather than left to
    // fall through to `other`.
    expect(sqlserverProvider.normaliseType('timestamp')).toBe('binary')
    expect(sqlserverProvider.normaliseType('rowversion')).toBe('binary')
    expect(sqlserverProvider.normaliseType('datetime2')).toBe('timestamp')
  })

  it('says other rather than guessing, and lets native speak', () => {
    // A CLR type, an alias type and sql_variant all land here. ADR 0009.
    expect(sqlserverProvider.normaliseType('geography')).toBe('other')
    expect(sqlserverProvider.normaliseType('hierarchyid')).toBe('other')
    expect(sqlserverProvider.normaliseType('sql_variant')).toBe('other')
    expect(sqlserverProvider.normaliseType('PostCode')).toBe('other')
    expect(sqlserverProvider.normaliseType('')).toBe('other')
  })
})

describe('quoteIdentifier', () => {
  it('doubles the bracket SQL Server closes with', () => {
    expect(sqlserverProvider.quoteIdentifier('Order')).toBe('[Order]')
    expect(sqlserverProvider.quoteIdentifier('Order Book')).toBe('[Order Book]')
    // Only the closing bracket needs escaping, and it needs it: the fixture has
    // a table called `Ledger [Entry]`, whose DDL will not compile without this.
    expect(sqlserverProvider.quoteIdentifier('Ledger [Entry]')).toBe('[Ledger [Entry]]]')
    expect(sqlserverProvider.quoteIdentifier('lower(ledger_code)')).toBe('[lower(ledger_code)]')
  })
})

describe('parse, over the cross-engine fixture', () => {
  const document = read('sqlserver-raw')

  it('carries nvarchar length in characters, not the bytes sys.columns reports', () => {
    const code = tableNamed(document, 'dbo', 'Order').columns.find((c) => c.name === 'Code')
    // The file says maxLength 64 for nvarchar(32), because that column is bytes.
    expect(code?.type).toEqual({
      native: 'nvarchar',
      normalised: 'string',
      length: 32,
    })
  })

  it('turns the -1 that means (max) into the only non-numeric length there is', () => {
    const notes = tableNamed(document, 'dbo', 'Order').columns.find((c) => c.name === 'Notes')
    expect(notes?.type.length).toBe('max')
  })

  it('drops the precision sys.columns invents for every type', () => {
    // sys.columns says precision 19 for bigint and 0 for nvarchar. Both are true
    // and useless, and neither reaches the canonical document.
    const id = tableNamed(document, 'dbo', 'Order').columns.find((c) => c.name === 'Id')
    expect(id?.type).toEqual({ native: 'bigint', normalised: 'integer' })
  })

  it('keeps precision and scale where somebody wrote them down', () => {
    const total = tableNamed(document, 'dbo', 'Order').columns.find((c) => c.name === 'Total')
    expect(total?.type).toEqual({
      native: 'decimal',
      normalised: 'decimal',
      precision: 12,
      scale: 2,
    })
  })

  it('keeps a default expression verbatim, and the name of the constraint holding it', () => {
    const quantity = tableNamed(document, 'sales', 'OrderLine').columns.find(
      (c) => c.name === 'Quantity',
    )
    expect(quantity?.default).toEqual({
      expression: '((0))',
      constraintName: 'DF_OrderLine_Quantity',
    })
  })

  it('reads a composite primary key and a multi-column foreign key as ordinary', () => {
    const orderLine = tableNamed(document, 'sales', 'OrderLine')
    expect(orderLine.primaryKey).toEqual({
      name: 'PK_OrderLine',
      columns: ['OrderId', 'LineNo'],
      isClustered: true,
    })
    const composite = orderLine.foreignKeys.find((f) => f.columns.length === 2)
    expect(composite).toEqual({
      name: 'FK_OrderLine_Order',
      columns: ['TenantId', 'OrderCode'],
      referencedSchema: 'dbo',
      referencedTable: 'Order',
      referencedColumns: ['TenantId', 'Code'],
      onDelete: 'cascade',
      onUpdate: 'noAction',
    })
  })

  it('carries a filtered index, its included column and its direction', () => {
    expect(tableNamed(document, 'sales', 'OrderLine').indexes).toEqual([
      {
        name: 'IX_OrderLine_Open',
        columns: [{ column: 'OrderId' }, { column: 'LineNo', descending: true }],
        includedColumns: ['Quantity'],
        isUnique: false,
        isClustered: false,
        filterExpression: '([Quantity]>(0))',
      },
    ])
  })

  it('does not repeat the primary key index, and marks the one a constraint owns', () => {
    const order = tableNamed(document, 'dbo', 'Order')
    expect(order.indexes.map((i) => i.name)).toEqual(['UQ_Order_TenantCode'])
    expect(order.indexes[0]?.isUnique).toBe(true)
    expect(order.indexes[0]?.isUniqueConstraint).toBe(true)
  })

  it('records a persisted computed column, which Postgres has no flag for', () => {
    const lineTotal = tableNamed(document, 'sales', 'OrderLine').columns.find(
      (c) => c.name === 'LineTotal',
    )
    expect(lineTotal?.generated).toEqual({
      expression: '([Quantity]*[UnitPrice])',
      persisted: true,
    })
    // And SQL Server calls it nullable even though both operands are NOT NULL,
    // because it will not promise the multiplication cannot overflow. The
    // provider reports what the catalog says rather than what the DDL looks like.
    expect(lineTotal?.nullable).toBe(true)
  })

  it('treats dbo as a schema name and not as the absence of one', () => {
    expect(document.tables.map((t) => `${t.schema}.${t.name}`)).toEqual([
      'dbo.Order',
      'sales.OrderLine',
    ])
    for (const table of document.tables) expect(table.schema).not.toBe('')
  })

  it('says where the file came from without deciding anything about case', () => {
    expect(document.source).toEqual({
      database: 'Shop',
      engineVersion: '16.0.4265.3',
      defaultCollation: 'SQL_Latin1_General_CP1_CI_AS',
    })
  })
})

describe('parse, over the branches only SQL Server has', () => {
  const document = read('sqlserver-provider-raw')

  it('emits identifiers as the catalog holds them, brackets and spaces and all', () => {
    expect(document.tables.map((t) => `${t.schema}.${t.name}`)).toEqual([
      'Order Book.Ledger Line',
      'Order Book.Ledger [Entry]',
      'dbo.Audit Trail',
    ])
    // Nothing quotes on the way through. Quoting is what `quoteIdentifier` is
    // for, and it happens where SQL is written rather than where it is read.
    expect(tableNamed(document, 'Order Book', 'Ledger [Entry]').name).not.toContain(']]')
  })

  it('halves an nvarchar and leaves a varchar alone, because one counts two bytes', () => {
    const columns = tableNamed(document, 'Order Book', 'Ledger [Entry]').columns
    // nvarchar(50) reports 100.
    expect(columns.find((c) => c.name === 'Ledger Code')?.type).toEqual({
      native: 'nvarchar',
      normalised: 'string',
      length: 50,
    })
    // varchar(20) reports 20, and halving it would be the same bug the other way.
    expect(columns.find((c) => c.name === 'Region')?.type).toEqual({
      native: 'varchar',
      normalised: 'string',
      length: 20,
    })
  })

  it('sizes an alias type by the system type under it and names it by the alias', () => {
    // CREATE TYPE PostCode FROM nvarchar(16). The catalog reports maxLength 32,
    // and only the system type says those are bytes. Naming it `PostCode` and
    // normalising it to `other` is the honest answer; getting the unit wrong
    // would silently double it.
    const post = tableNamed(document, 'Order Book', 'Ledger [Entry]').columns.find(
      (c) => c.name === 'Post',
    )
    expect(post?.type).toEqual({ native: 'PostCode', normalised: 'other', length: 16 })
  })

  it('gives no length to the types whose max_length is not a length', () => {
    const columns = tableNamed(document, 'Order Book', 'Ledger [Entry]').columns
    // `text` reports 16, which is the pointer rather than the data.
    expect(columns.find((c) => c.name === 'Legacy')?.type).toEqual({
      native: 'text',
      normalised: 'string',
    })
    // `xml` and `geography` report -1, which here does not mean (max).
    expect(columns.find((c) => c.name === 'Doc')?.type).toEqual({
      native: 'xml',
      normalised: 'xml',
    })
    expect(columns.find((c) => c.name === 'Shape')?.type).toEqual({
      native: 'geography',
      normalised: 'other',
    })
    // varbinary(max) does report -1 and does mean it.
    expect(columns.find((c) => c.name === 'Payload')?.type).toEqual({
      native: 'varbinary',
      normalised: 'binary',
      length: 'max',
    })
  })

  it('reads a rowversion as the eight bytes it is rather than as a moment', () => {
    const version = tableNamed(document, 'Order Book', 'Ledger [Entry]').columns.find(
      (c) => c.name === 'Version',
    )
    expect(version?.type).toEqual({ native: 'timestamp', normalised: 'binary' })
  })

  it('carries an identity seed and increment, which Postgres keeps elsewhere', () => {
    const id = tableNamed(document, 'Order Book', 'Ledger [Entry]').columns.find(
      (c) => c.name === 'Id',
    )
    expect(id?.identity).toEqual({ generation: 'always', seed: 100, increment: 5 })
    expect(id?.default).toBeUndefined()
  })

  it('separates a unique index from a unique constraint, which are different things', () => {
    const indexes = tableNamed(document, 'Order Book', 'Ledger [Entry]').indexes
    const constraint = indexes.find((i) => i.name === 'UQ_Ledger_Code')
    const plain = indexes.find((i) => i.name === 'UX_Ledger_Ref')
    expect(constraint?.isUnique).toBe(true)
    expect(constraint?.isUniqueConstraint).toBe(true)
    // Unique, and dropping it drops an index rather than a constraint.
    expect(plain?.isUnique).toBe(true)
    expect(plain?.isUniqueConstraint).toBeUndefined()
    expect(plain?.filterExpression).toBe('([Ref] IS NOT NULL)')
  })

  // ADR 0022 in the other dialect. SQL Server has no functional index: an index
  // over an expression is an index over a computed column. So the key is a
  // column either way, the expression lives on the column, and the two indexes
  // below are distinguishable without `IndexKeyExpression` ever appearing.
  it('reaches an expression index through a computed column, and stays unambiguous', () => {
    const table = tableNamed(document, 'Order Book', 'Ledger [Entry]')
    const overComputed = table.indexes.find((i) => i.name === 'IX_Ledger_NoteLower')
    const overOddColumn = table.indexes.find((i) => i.name === 'IX_Ledger_lower(ledger_code)')

    expect(overComputed?.columns).toEqual([{ column: 'NoteLower' }])
    expect(table.columns.find((c) => c.name === 'NoteLower')?.generated).toEqual({
      expression: '(lower([Note]))',
      persisted: false,
    })

    // And a column literally called `lower(ledger_code)`, which is a different
    // schema and a legal one. It is an ordinary column with no `generated`, and
    // that is the whole difference.
    expect(overOddColumn?.columns).toEqual([{ column: 'lower(ledger_code)' }])
    expect(table.columns.find((c) => c.name === 'lower(ledger_code)')?.generated).toBeUndefined()

    // No SQL Server index key is ever an expression, so nothing in either
    // document exercises the other half of the union.
    for (const t of document.tables) {
      for (const index of t.indexes) {
        for (const key of index.columns) expect(key).not.toHaveProperty('expression')
      }
    }
  })

  it('drops the index rows that are not indexes anybody modelled', () => {
    // sys.indexes has a row for the heap itself, with no name, and a row for the
    // columnstore index on Ledger Line, which has no ordered key list to report.
    // The query excludes both by access method, so neither arrives as an index
    // with no keys.
    const names = document.tables.flatMap((t) => t.indexes.map((i) => i.name))
    expect(names).not.toContain('')
    expect(names).not.toContain('CS_LedgerLine')
    expect(tableNamed(document, 'dbo', 'Audit Trail').indexes).toEqual([])
    expect(tableNamed(document, 'Order Book', 'Ledger Line').indexes).toEqual([])
  })

  it('keeps a non-clustered primary key non-clustered', () => {
    expect(tableNamed(document, 'Order Book', 'Ledger [Entry]').primaryKey).toEqual({
      name: 'PK_Ledger [Entry]',
      columns: ['TenantId', 'Id'],
      isClustered: false,
    })
    expect(tableNamed(document, 'Order Book', 'Ledger Line').primaryKey?.isClustered).toBe(true)
  })

  it('has a table with no primary key at all, and says so by leaving it out', () => {
    expect(tableNamed(document, 'dbo', 'Audit Trail').primaryKey).toBeUndefined()
  })

  it('translates the referential actions SQL Server spells in words', () => {
    const fks = tableNamed(document, 'Order Book', 'Ledger Line').foreignKeys
    const setNull = fks.find((f) => f.name === 'FK_LedgerLine_Code')
    expect(setNull?.onDelete).toBe('setNull')
    expect(setNull?.onUpdate).toBe('cascade')
    expect(setNull?.columns).toEqual(['RefTenantId', 'RefCode'])
    expect(setNull?.referencedTable).toBe('Ledger [Entry]')
    expect(fks.find((f) => f.name === 'FK_LedgerLine_Entry')?.onDelete).toBe('noAction')
  })

  it('leaves the view and the columnstore table alone but keeps the heap', () => {
    // A view is not a table. A heap with no key is.
    expect(document.tables.map((t) => t.name)).not.toContain('OpenLine')
    expect(document.tables.map((t) => t.name)).toContain('Audit Trail')
  })

  it('says nothing rather than saying null, which is FOR JSON doing it for us', () => {
    // FOR JSON omits a null column unless asked otherwise, which is the reason
    // the contract treats absent and null the same. Both fixtures are the file a
    // user pastes, so it is checkable here.
    const nulls: string[] = []
    const walk = (value: unknown, path: string): void => {
      if (value === null) nulls.push(path)
      else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`))
      else if (typeof value === 'object')
        for (const [key, item] of Object.entries(value as object)) walk(item, `${path}.${key}`)
    }
    walk(fixture('sqlserver-provider-raw'), '$')
    walk(fixture('sqlserver-raw'), '$')
    expect(nulls).toEqual([])
  })
})

describe('parse, when the file is not what the query prints', () => {
  it('names the truncated paste, because that is what it usually is', () => {
    // The first 2033 characters of the result, which is exactly what SQL Server
    // hands the client as one row and exactly what somebody copies out of the
    // SSMS grid.
    const whole = JSON.stringify(fixture('sqlserver-raw'))
    const result = sqlserverProvider.parse(whole.slice(0, 2033))
    expect(result.ok).toBe(false)
    expect(result.diagnostics.map((d) => d.code)).toEqual(['import/not-an-object'])
    expect(jsonPath(result.diagnostics[0])).toBe('$')
    expect(result.diagnostics[0]?.message).toContain('2033-character pieces')
    expect(result.diagnostics[0]?.message).toContain('Save Results As')
  })

  it('rejects a tables that is not a list, with the path to it', () => {
    const result = sqlserverProvider.parse({ tables: 'Order, OrderLine' })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('import/wrong-type')
    expect(jsonPath(result.diagnostics[0])).toBe('$.tables')
  })

  it('leaves the rest to the contract validator, which has the paths', () => {
    // A table with no schema is a provider bug, and it surfaces as a diagnostic
    // pointing at where it is rather than as a crash. See provider.ts.
    const result = readIntrospection({
      dbmdIntrospection: INTROSPECTION_VERSION,
      engine: 'sqlserver',
      tables: [{ name: 'Order', columns: [] }],
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics.map(jsonPath)).toContain('$.tables[0].schema')
  })
})
