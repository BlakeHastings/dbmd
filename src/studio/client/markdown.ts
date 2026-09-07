/**
 * Just enough markdown to draw a sticky note, parsed into a value.
 *
 * A note's body *is* the note (ADR 0005), and the whole reason this project
 * stores prose rather than a label is that somebody wrote a paragraph worth
 * reading. Showing that paragraph on the canvas with its asterisks and
 * backticks still in it would be showing the source of the thing rather than
 * the thing.
 *
 * **It parses to a value and renders nowhere.** Nothing here touches the DOM,
 * for the same reason nothing in `geometry.ts` does: this is the half a test
 * can hold without a browser, and the rendering is six lines in `canvas.ts`
 * that build elements out of what this returns. That split is also what makes
 * the safety property obvious rather than argued: the renderer creates text
 * nodes and never assigns `innerHTML`, so a note whose body is `<script>` is a
 * note that says `<script>`.
 *
 * **It is deliberately small, and the list is the specification.** Headings,
 * paragraphs, bullet lists, fenced and indented code as preformatted text, and
 * inline code, bold and italic. No links, no images, no tables, no HTML. A
 * fuller markdown implementation is a dependency this page does not have and a
 * decision this item did not need to take: what is here covers every note in
 * `examples/shop` and in `dbmd init`, and anything it does not understand is
 * shown as the characters the author typed, which is the honest failure.
 *
 * The inspector edits the same body as plain text in a textarea, because the
 * text is what reaches the file and a rich editor would be a second opinion
 * about what the author wrote.
 */

/** A run of text, with at most the two emphases this understands. */
export interface Span {
  readonly text: string
  readonly code?: true
  readonly strong?: true
  readonly emphasis?: true
}

export type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly spans: readonly Span[] }
  | { readonly kind: 'paragraph'; readonly spans: readonly Span[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly Span[])[] }
  /** Verbatim, from a fence or an indent. Never re-parsed, never emphasised. */
  | { readonly kind: 'code'; readonly text: string }

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const FENCE = /^\s*(?:```|~~~)/

/**
 * A body as blocks.
 *
 * Line endings are normalised for the parse and only for the parse: the body on
 * disk keeps its own, byte for byte, and this function never gives its input
 * back. `inspector.ts` has the same rule about a textarea and the reason it
 * matters.
 */
export function parseMarkdown(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  let items: string[] = []

  const endParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join(' ')) })
      paragraph = []
    }
  }
  const endList = (): void => {
    if (items.length > 0) {
      blocks.push({ kind: 'list', items: items.map((item) => parseInline(item)) })
      items = []
    }
  }
  const endAll = (): void => {
    endParagraph()
    endList()
  }

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? ''

    if (FENCE.test(line)) {
      endAll()
      const held: string[] = []
      at += 1
      // An unterminated fence takes the rest of the note rather than being
      // dropped. Somebody typing a note is halfway through it most of the time.
      for (; at < lines.length && !FENCE.test(lines[at] ?? ''); at += 1) {
        held.push(lines[at] ?? '')
      }
      blocks.push({ kind: 'code', text: held.join('\n') })
      continue
    }

    if (line.trim() === '') {
      endAll()
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      endAll()
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        spans: parseInline(heading[2] ?? ''),
      })
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet !== null) {
      endParagraph()
      items.push(bullet[1] ?? '')
      continue
    }

    // A continuation line of the item above rather than a new paragraph, which
    // is what a wrapped bullet is in every note anybody writes.
    if (items.length > 0 && /^\s+\S/.test(line)) {
      items[items.length - 1] = `${items[items.length - 1] ?? ''} ${line.trim()}`
      continue
    }

    endList()
    paragraph.push(line.trim())
  }

  endAll()
  return blocks
}

/**
 * One line of prose as spans.
 *
 * Code first and unconditionally, because a backtick span is verbatim: the
 * whole point of `` `**not bold**` `` is that it is not bold. Everything after
 * the first pass only ever looks at the runs that were not code.
 */
export function parseInline(text: string): Span[] {
  const spans: Span[] = []
  let plain = ''

  const flush = (): void => {
    if (plain !== '') {
      spans.push(...emphasise(plain))
      plain = ''
    }
  }

  for (let at = 0; at < text.length; at += 1) {
    if (text[at] !== '`') {
      plain += text[at]
      continue
    }
    const close = text.indexOf('`', at + 1)
    if (close === -1) {
      plain += text[at]
      continue
    }
    flush()
    spans.push({ text: text.slice(at + 1, close), code: true })
    at = close
  }
  flush()
  return spans
}

const EMPHASIS = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/

function emphasise(text: string): Span[] {
  const spans: Span[] = []
  let rest = text
  for (;;) {
    const match = EMPHASIS.exec(rest)
    if (match === null || match.index === undefined) break
    if (match.index > 0) spans.push({ text: rest.slice(0, match.index) })
    if (match[2] !== undefined) spans.push({ text: match[2], strong: true })
    else spans.push({ text: match[4] ?? '', emphasis: true })
    rest = rest.slice(match.index + match[0].length)
  }
  if (rest !== '') spans.push({ text: rest })
  return spans
}
