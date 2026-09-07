/**
 * One `frontmatter-invalid` per file, and the right one.
 *
 * ADR 0017 decided the cap and dbmd-24 built it. The half that needs a test is
 * not the count, which is obvious from the code, but **which** diagnostic
 * survives, which is not: the parser's own order and the printed order both put
 * a consequence ahead of the mistake, and a cap that took either would hand a
 * reader one confidently wrong sentence instead of fifteen true ones. Every
 * assertion below is on the message, because the message is the thing that
 * would silently become wrong.
 *
 * The messages are YAML's, so they are the one thing here that a `yaml` upgrade
 * can legitimately reword. A failure that is only a rewording is a fixture
 * update; a failure where a *different* complaint won is this cap breaking.
 */

import { describe, expect, test } from 'vitest'
import { parseDocument } from 'yaml'
import { locationText } from '../../src/diagnostics.js'
import type { Diagnostic } from '../../src/model/types.js'
import { withModel } from './helpers.js'

function lines(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => `${locationText(d.at)} ${d.severity} ${d.code}: ${d.message}`)
}

/** A `\t` where two spaces belong: the most ordinary way there is to break a file. */
const ONE_TAB = [
  '---',
  'kind: table',
  'table: t',
  'columns:',
  '  - name: id',
  '\ttype: uuid',
  '    pk: true',
  '  - name: email',
  '    type: text',
  '  - name: display_name',
  '    type: text',
  '  - name: created_at',
  '    type: timestamptz',
  'layout: { x: 40, y: 40 }',
  '---',
  '',
  'Body.',
  '',
].join('\n')

/** An unterminated `[`, which swallows the rest of the document. */
const OPEN_FLOW_SEQUENCE = [
  '---',
  'kind: table',
  'table: t',
  'columns: [',
  '  - name: id',
  '    type: uuid',
  '    pk: true',
  '  - name: email',
  '    type: text',
  '  - name: created_at',
  '    type: timestamptz',
  'layout: { x: 40, y: 40 }',
  '---',
  '',
  'Body.',
  '',
].join('\n')

describe('one frontmatter error per file, not forty', () => {
  test('one tab is one diagnostic, and it is the one that says so', async () => {
    const { model, diagnostics } = await withModel({ 'tables/t.md': ONE_TAB })

    expect(lines(diagnostics)).toEqual([
      'tables/t.md:6 error frontmatter-invalid: Tabs are not allowed as indentation (and 14 more parse errors, not reported: they follow from this one)',
    ])
    // The file did not load, which is unchanged: a cap is about how loudly the
    // reader says so, not about what it accepts.
    expect(model.tables).toEqual([])
  })

  test('the tab beat the two complaints the printed order would have put first', async () => {
    // Not a restatement of the test above. `compareDiagnostics` sorts equal
    // lines by message text, so before the cap this file's first *printed*
    // diagnostic was `Implicit keys...`, and its second `Nested mappings...`,
    // both on line 6 alongside the tab. Capping on printed order would have
    // kept one of those and hidden the tab, which is the failure this asserts
    // against by naming the messages that must not win.
    const { diagnostics } = await withModel({ 'tables/t.md': ONE_TAB })
    const message = diagnostics[0]?.message ?? ''

    expect(message).toContain('Tabs')
    expect(message).not.toContain('Implicit keys')
    expect(message).not.toContain('Nested mappings')
  })

  test('an unterminated flow sequence keeps the complaint that names it', async () => {
    const { diagnostics } = await withModel({ 'tables/t.md': OPEN_FLOW_SEQUENCE })

    expect(lines(diagnostics)).toEqual([
      'tables/t.md:5 error frontmatter-invalid: Block collections are not allowed within flow collections (and 13 more parse errors, not reported: they follow from this one)',
    ])
  })

  test('the parser reported that one last, so emission order is not what the cap uses', () => {
    // The evidence for the assertion above being a real constraint rather than
    // a coincidence: `doc.errors` is emission order, the composer's complaints
    // are pushed before the lexer's, and the message naming the actual fault is
    // therefore at the end. If this ever stops being true the cap is still
    // right, but the reason it is right has changed and the comment in
    // `read.ts` should be reread.
    const yamlText = OPEN_FLOW_SEQUENCE.split('\n').slice(1, 12).join('\n')
    const doc = parseDocument(yamlText, { prettyErrors: false })

    expect(doc.errors[0]?.message).not.toContain('Block collections')
    expect(doc.errors.some((e) => e.message.includes('Block collections'))).toBe(true)
  })

  test('a file with one parse error says nothing about suppression', async () => {
    // The clause is earned rather than boilerplate: a reader who sees it knows
    // there is more, and a reader who does not see it knows there is not.
    const { diagnostics } = await withModel({
      'tables/t.md': '---\nkind: table\ntable: t\nlayout: { x: 40, y: 40\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/t.md:5 error frontmatter-invalid: Flow map in block collection must be sufficiently indented and end with a }',
    ])
  })

  test('the count is the number the file actually had', async () => {
    // Guards the off-by-one that a cap invites: fifteen complaints is one
    // reported and fourteen suppressed, not fifteen suppressed.
    const yamlText = ONE_TAB.split('\n').slice(1, 14).join('\n')
    const doc = parseDocument(yamlText, { prettyErrors: false })
    const { diagnostics } = await withModel({ 'tables/t.md': ONE_TAB })

    expect(doc.errors.length).toBe(15)
    expect(diagnostics[0]?.message).toContain(`and ${doc.errors.length - 1} more parse errors`)
  })
})

describe('the cap is the parser cascade and nothing else', () => {
  test('a missing closing --- is still its own code, with no line and no count', async () => {
    // A different mistake with a different shape: the frontmatter never parses
    // at all, so there is no cascade to cap and the split reports it instead.
    const { diagnostics } = await withModel({
      'tables/t.md': '---\nkind: table\ntable: t\ncolumns:\n  - name: id\n\nBody.\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/t.md error frontmatter-unterminated: the frontmatter opens with `---` and is never closed by a `---` line',
    ])
  })

  test('a file that parses still reports every problem it has', async () => {
    // The cap must not become "one diagnostic per file". Everything here is a
    // separate fact about a file the parser read fine, and all of them survive.
    const { diagnostics } = await withModel({
      'tables/t.md': [
        '---',
        'kind: table',
        'table: elsewhere',
        'columns:',
        '  - name: ""',
        '    type: uuid',
        '    unqiue: true',
        'group: nothing',
        '---',
        '',
      ].join('\n'),
    })

    expect(diagnostics.map((d) => d.code)).toEqual([
      'name-mismatch',
      'empty-value',
      'unknown-key',
      'group-unknown',
    ])
  })

  test('two broken files are two diagnostics, one each', async () => {
    // Per file, not per run: `dbmd check` still reports the shape of the damage
    // across a repository, which is what ADR 0020 grouped output for.
    const { diagnostics } = await withModel({
      'tables/a.md': ONE_TAB,
      'tables/b.md': OPEN_FLOW_SEQUENCE,
    })

    expect(diagnostics.map((d) => locationText(d.at))).toEqual(['tables/a.md:6', 'tables/b.md:5'])
  })
})
