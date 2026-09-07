import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, type Block } from '../../src/studio/client/markdown.js'

/**
 * What a sticky note says, as a value.
 *
 * A note's body is the note (ADR 0005) and the canvas renders it rather than
 * showing its source, so there is a parser, and a parser is the part of the
 * drawing a screenshot proves worst: a picture of a rendered note looks the
 * same whether the asterisks were understood or merely absent.
 *
 * The renderer itself is six lines in `canvas.ts` that turn these blocks into
 * elements with `textContent`, never `innerHTML`. That split is why the safety
 * property is a fact about the code rather than a claim in a test: this file
 * proves the parse, and the renderer has no way to produce markup at all.
 */

function texts(blocks: readonly Block[]): string[] {
  return blocks.map((block) =>
    block.kind === 'code'
      ? block.text
      : block.kind === 'list'
        ? block.items.map((item) => item.map((span) => span.text).join('')).join(' | ')
        : block.spans.map((span) => span.text).join(''),
  )
}

describe('blocks', () => {
  it('splits paragraphs on blank lines and joins the lines inside one', () => {
    const blocks = parseMarkdown('one\nline\n\nsecond')
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph'])
    expect(texts(blocks)).toEqual(['one line', 'second'])
  })

  it('reads a heading, and never a level that would collide with the page', () => {
    const blocks = parseMarkdown('# Title\n\nbody')
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 })
  })

  it('reads a bullet list, and folds a wrapped item back into its own bullet', () => {
    const blocks = parseMarkdown('- first\n  continued\n- second')
    expect(blocks[0]?.kind).toBe('list')
    expect(texts(blocks)).toEqual(['first continued | second'])
  })

  it('takes a fenced block verbatim and does not emphasise inside it', () => {
    const blocks = parseMarkdown('```\nselect **all**\n```')
    expect(blocks[0]).toEqual({ kind: 'code', text: 'select **all**' })
  })

  it('takes the rest of the note when a fence is not closed', () => {
    // A note is halfway through being typed most of the time it is being typed,
    // and dropping the text after an unmatched fence would make the canvas go
    // blank on a keystroke.
    expect(parseMarkdown('```\nstill writing')).toEqual([{ kind: 'code', text: 'still writing' }])
  })

  it('reads the same body the same way whatever its line endings are', () => {
    // The body reaches disk byte for byte, CRLF and all (ADR 0010), so the
    // parser normalises for the parse and gives nothing back.
    expect(parseMarkdown('a\r\n\r\nb')).toEqual(parseMarkdown('a\n\nb'))
  })

  it('has nothing to say about an empty note', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n\n')).toEqual([])
  })
})

describe('inline', () => {
  it('reads code, bold and italic', () => {
    expect(parseInline('a `b` c')).toEqual([
      { text: 'a ' },
      { text: 'b', code: true },
      { text: ' c' },
    ])
    expect(parseInline('**loud**')).toEqual([{ text: 'loud', strong: true }])
    expect(parseInline('_quiet_')).toEqual([{ text: 'quiet', emphasis: true }])
  })

  it('leaves a code span verbatim, which is the whole point of one', () => {
    // ``**not bold**`` is a person showing somebody the characters.
    expect(parseInline('`**not bold**`')).toEqual([{ text: '**not bold**', code: true }])
  })

  it('shows an unmatched backtick as a backtick rather than eating the line', () => {
    expect(parseInline('a ` b')).toEqual([{ text: 'a ` b' }])
  })

  it('carries a tag through as text, because the renderer makes text nodes', () => {
    // Nothing downstream parses this. The assertion is that the parser does not
    // quietly drop it either: a note that says `<script>` shows `<script>`.
    expect(parseInline('<script>x</script>')).toEqual([{ text: '<script>x</script>' }])
  })

  it('keeps a line with nothing to mark up as one span', () => {
    expect(parseInline('plain words')).toEqual([{ text: 'plain words' }])
  })
})
