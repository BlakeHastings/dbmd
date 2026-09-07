// Fail when a class name both studio scenes use has a stylesheet rule that
// belongs to neither of them.
//
// WHAT THIS PREVENTS
// The studio's page is two independent scenes sharing one stylesheet: the
// canvas, built by `src/studio/client/canvas.ts`, and the inspector panel,
// built by `src/studio/client/inspector.ts`. A bare class selector matches
// both, and on 2026-09-07 that cost two defects hours apart.
//
// dbmd-34: the canvas note element was class `note`, and `#inspector .note` was
// already the panel's explanatory paragraph. The canvas rule was `position:
// absolute; top: 0; left: 0`, so every sentence in the panel was torn out of
// the column and stacked in the corner of the page.
//
// dbmd-49: `notes` was the canvas note *layer* and the inspector's red
// validation paragraph. Same three declarations, and neither `#inspector
// .notes` rule sets `position`, so nothing overrode it. Every red validation
// paragraph in the panel had been rendering behind the toolbar, including the
// create form's "there is already a table called `orders`", which the studio
// relies on somebody reading.
//
// Singular and plural, one character apart, found by two agents who did not
// know about each other. Neither was visible in a diff or in a test: both files
// were correct on their own, and the collision only existed once the browser
// put them on the same page. Both were found by driving it and noticing
// something in the wrong place. Twice is a property of the arrangement rather
// than an incident, which is what this script is for.
//
// WHAT IT ASKS
// Not "is this class name shared", because a shared name is not wrong. The
// seven `tint-*` classes are shared on purpose: a note, a group box and the
// inspector's colour swatches all read the same three variables, and that is
// the palette doing its job.
//
// What is wrong is a shared name whose rule belongs to neither scene. So:
//
//   for every class name both files use,
//   every rule in the stylesheet naming that class must be anchored.
//
// A selector is anchored when it names something that belongs to exactly one
// scene: `#inspector`, or one of the canvas's roots, or any class that only one
// of the two files uses. `.scene > .notes` is anchored by `.scene`. `#inspector
// .notes` is anchored by `#inspector`. `.box li .name::after` is anchored by
// `.box`, which only the canvas writes. A bare `.notes` is anchored by nothing,
// and that is the defect.
//
// This holds because the two scenes are siblings in `index.html`: `main.stage`
// and `aside#inspector`. A selector chain naming one of them cannot match an
// element inside the other, so a rule that names a single-scene ancestor stays
// in that scene however the shared class moves around.
//
// WHY NOT "EVERY CANVAS RULE MUST BE SCOPED"
// That was the other candidate and it is simpler to state. It was not taken
// because it is not free: forty-odd selectors would have to move under `.scene`
// or `.stage`, every one of them a specificity change, on a page whose current
// appearance is the only record of what it is supposed to look like. This item
// says do not restyle the page, and rewriting the canvas half of the stylesheet
// to satisfy a check is restyling it. The intersection is the smaller claim and
// it is the one the two defects actually had in common.
//
// WHAT IT CANNOT SEE, STATED PLAINLY
// It reads literals. A class name assembled at run time is invisible to it, and
// the `tint-*` classes are exactly that: `tintClass()` in `palette.ts` returns
// `tint-${color}`, and neither scene file contains the string. They are not
// reported because they cannot be seen, not because they were approved. Same
// for `main.ts`'s `item.className = diagnostic.severity`, which is why `.error`
// and `.warning` are invisible here too.
//
// It reads the stylesheet with a brace scan rather than a CSS parser, because
// the stylesheet lives inside `<style>` in `index.html` and a parser is not free
// there. The scan strips comments, descends into at-rules and splits a selector
// list on top-level commas. It would misread nested CSS written with `&`, and a
// selector list inside `:is()` or `:where()`. Neither is in this file, and both
// would be found by the same scan noticing a selector it could not anchor
// rather than by it quietly passing: an unrecognised token is not an anchor.
//
//   node scripts/check-scene-classes.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const STYLESHEET = 'src/studio/client/index.html'

/**
 * The two scenes, and what marks a selector as belonging to one of them.
 *
 * The roots are the elements in `index.html` that each scene lives inside.
 * `#canvas` is the pan host, `.stage` is the `<main>` around it and `.scene` is
 * the transformed layer holding everything in model coordinates; all three are
 * canvas and nothing else. `#inspector` is the panel. These are listed because
 * they are written in the page rather than by either file, so the extraction
 * below cannot learn them.
 */
const SCENES = [
  {
    name: 'canvas',
    file: 'src/studio/client/canvas.ts',
    roots: ['#canvas', '.stage', '.scene'],
  },
  {
    name: 'inspector',
    file: 'src/studio/client/inspector.ts',
    roots: ['#inspector'],
  },
]

function read(relative) {
  return readFileSync(join(ROOT, relative), 'utf8')
}

// ---------------------------------------------------------------------------
// What each scene calls things
// ---------------------------------------------------------------------------

/** A quoted string of any of the three kinds, as one alternation. */
const STRING = String.raw`'([^'\n]*)'|"([^"\n]*)"|` + '`([^`]*)`'

/**
 * An assignment to `className`, whose whole right-hand side is read.
 *
 * Every string in it, rather than the one that follows the `=`, because the
 * canvas writes `element.className = table.complete ? 'box' : 'box broken'` and
 * `box` is the class that anchors four other rules. Reading only the first
 * literal saw `boxes` and not `box`, and the check then reported `.box li .type`
 * as belonging to neither scene, which is the opposite of true.
 *
 * A template literal is read for its static text with the interpolations
 * blanked: the canvas writes `` `note-card ${tintClass(note.color)}` ``, and
 * `note-card` is a name this must see even though the tint is not.
 */
const CLASS_NAME_ASSIGNMENT = /\.className\s*=\s*(.*)$/

/**
 * The other places a class name is written, where only the first argument is
 * one. `classList.toggle('selected', this.isSelected('table', name))` has two
 * strings in it and one of them is a class.
 */
const SITES = [
  {
    what: 'classList',
    pattern: new RegExp(
      String.raw`\.classList\.(?:add|remove|toggle|replace|contains)\(\s*(?:${STRING})`,
      'g',
    ),
  },
]

/**
 * Local helpers that take a class name as an argument, declared because a
 * regular expression cannot infer one.
 *
 * `el('p', 'notes')` is how the inspector writes almost every class it has, and
 * a check that read only `className` would have found one shared name where
 * there are three. `textField(item, 'name', ...)` is the second: it passes its
 * key straight to `el` as the class, so `name` and `type` are inspector classes
 * even though neither string is ever written next to the word class.
 *
 * Each one is verified to still be declared in the file it belongs to, so this
 * throws on the day somebody renames it rather than silently seeing fewer
 * classes than there are. That is the failure mode this whole script exists to
 * avoid, and it would be a poor joke to build it in.
 */
const HELPERS = [
  { file: 'src/studio/client/inspector.ts', call: 'el', argument: 2 },
  { file: 'src/studio/client/inspector.ts', call: 'textField', argument: 2 },
]

/** The static tokens of a class-name expression, with interpolations dropped. */
function tokens(raw) {
  return raw
    .replace(/\$\{[^}]*\}/g, ' ')
    .split(/\s+/)
    .filter((token) => /^-?[_a-zA-Z][\w-]*$/.test(token))
}

/**
 * Every class name one scene file writes, and the line it first writes it on.
 *
 * Line by line rather than over the whole text, because the line is what a
 * failure has to print: "these two files share a name" is a fact somebody then
 * has to go and find.
 */
function classesIn(file) {
  const text = read(file)
  const sites = [...SITES]

  for (const helper of HELPERS) {
    if (helper.file !== file) continue
    const declared = new RegExp(String.raw`function\s+${helper.call}\s*[<(]`)
    if (!declared.test(text)) {
      throw new Error(
        `${file} no longer declares ${helper.call}(), which this check reads class names from. ` +
          'Update HELPERS in scripts/check-scene-classes.mjs, or it will see fewer classes than there are.',
      )
    }
    const skipped = String.raw`(?:[^,()]*,\s*){${helper.argument - 1}}`
    sites.push({
      what: `${helper.call}()`,
      pattern: new RegExp(
        String.raw`(?<![\w.$])${helper.call}\(\s*${skipped}(?:${STRING})`,
        'g',
      ),
    })
  }

  const every = new RegExp(String.raw`(?:${STRING})`, 'g')
  const found = new Map()
  const keep = (token, line, what) => {
    if (!found.has(token)) found.set(token, { line, what })
  }

  text.split(/\r?\n/).forEach((line, index) => {
    const assigned = CLASS_NAME_ASSIGNMENT.exec(line)
    if (assigned) {
      for (const match of assigned[1].matchAll(every)) {
        const raw = match[1] ?? match[2] ?? match[3] ?? ''
        for (const token of tokens(raw)) keep(token, index + 1, 'className')
      }
    }
    for (const { what, pattern } of sites) {
      for (const match of line.matchAll(pattern)) {
        const raw = match[1] ?? match[2] ?? match[3] ?? ''
        for (const token of tokens(raw)) keep(token, index + 1, what)
      }
    }
  })
  return found
}

// ---------------------------------------------------------------------------
// What the stylesheet says
// ---------------------------------------------------------------------------

/**
 * The rules in the page's `<style>` block, each with the line it starts on.
 *
 * Comments are blanked rather than removed so that every offset still points at
 * the line it came from: the two comments this check is about are long, and a
 * failure that named a line eighteen short of the rule would be worse than no
 * line at all.
 */
function rules() {
  const html = read(STYLESHEET)
  const open = html.indexOf('<style>')
  const close = html.indexOf('</style>', open)
  if (open === -1 || close === -1) {
    throw new Error(`${STYLESHEET} has no <style> block, so there is no stylesheet to read`)
  }
  const start = open + '<style>'.length
  const css = html
    .slice(start, close)
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))

  const lineOf = (offset) => html.slice(0, start + offset).split('\n').length

  const found = []
  let index = 0
  let prelude = ''
  let preludeAt = 0

  while (index < css.length) {
    const character = css[index]
    if (character === '{') {
      const selector = prelude.trim()
      if (selector.startsWith('@')) {
        // An at-rule with a block: `@media` holds rules, so walk into it.
        index += 1
      } else {
        const offset = preludeAt + prelude.indexOf(selector.slice(0, 1))
        for (const part of selectorParts(selector, offset)) found.push(part)
        // Declarations, which hold no selectors. Skip to the closing brace.
        let depth = 1
        index += 1
        while (index < css.length && depth > 0) {
          if (css[index] === '{') depth += 1
          else if (css[index] === '}') depth -= 1
          index += 1
        }
      }
      prelude = ''
      preludeAt = index
      continue
    }
    if (character === '}') {
      index += 1
      prelude = ''
      preludeAt = index
      continue
    }
    prelude += character
    index += 1
  }

  return found.map(({ selector, offset }) => ({ selector, line: lineOf(offset) }))
}

/**
 * One selector list, as its parts, each with where it starts.
 *
 * Split on commas outside parentheses, so a `:not(a, b)` would stay whole. The
 * parts are checked one at a time because a list is a list of rules: `.scene >
 * .notes, .notes` is half anchored and half the defect.
 */
function selectorParts(selector, offset) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i <= selector.length; i++) {
    const character = selector[i]
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    if (i === selector.length || (character === ',' && depth === 0)) {
      const text = selector.slice(start, i)
      const lead = text.length - text.trimStart().length
      if (text.trim() !== '') parts.push({ selector: text.trim(), offset: offset + start + lead })
      start = i + 1
    }
  }
  return parts
}

const CLASS_IN_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g
const ID_IN_SELECTOR = /#(-?[_a-zA-Z][\w-]*)/g

function classesOf(selector) {
  return new Set([...selector.matchAll(CLASS_IN_SELECTOR)].map((match) => match[1]))
}

function idsOf(selector) {
  return new Set([...selector.matchAll(ID_IN_SELECTOR)].map((match) => match[1]))
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

const used = SCENES.map((scene) => ({ ...scene, classes: classesIn(scene.file) }))

/**
 * The names that anchor a selector to one scene.
 *
 * The roots, plus every class only one scene writes. The second half is what
 * lets `.box li .name::after` stand as it is: `name` is shared, `box` is the
 * canvas's alone, and a rule that has already said `.box` has said which scene
 * it is in.
 */
const anchors = { classes: new Set(), ids: new Set() }
for (const scene of used) {
  for (const root of scene.roots) {
    if (root.startsWith('#')) anchors.ids.add(root.slice(1))
    else anchors.classes.add(root.slice(1))
  }
}
for (const scene of used) {
  const others = used.filter((other) => other !== scene)
  for (const name of scene.classes.keys()) {
    if (!others.some((other) => other.classes.has(name))) anchors.classes.add(name)
  }
}

/** Used by every scene, which for two scenes is the intersection. */
const shared = [...used[0].classes.keys()]
  .filter((name) => used.every((scene) => scene.classes.has(name)))
  .sort()

function anchored(selector) {
  for (const id of idsOf(selector)) if (anchors.ids.has(id)) return true
  for (const name of classesOf(selector)) if (anchors.classes.has(name)) return true
  return false
}

const problems = []
for (const { selector, line } of rules()) {
  if (anchored(selector)) continue
  for (const name of classesOf(selector)) {
    if (!shared.includes(name)) continue
    const where = used
      .map((scene) => `${scene.file.split('/').pop()}:${scene.classes.get(name).line}`)
      .join(' and ')
    problems.push({ line, selector, name, where })
  }
}

if (problems.length > 0) {
  console.error(
    `${problems.length} rule${problems.length === 1 ? '' : 's'} on a class name both studio scenes use, anchored to neither:\n`,
  )
  for (const { line, selector, name, where } of problems) {
    const names = selector === `.${name}` ? '' : ` names \`.${name}\`, which is`
    console.error(`  ${STYLESHEET}:${line}`)
    console.error(`    \`${selector}\`${names} written by ${where}`)
  }
  console.error(`
The studio's page is two scenes sharing one stylesheet, and a bare class
selector matches both. \`.note\` was the canvas note and the inspector's
explanatory paragraph, and the panel's sentences ended up stacked in the corner
of the page. \`.notes\` was the canvas note layer and the inspector's red
validation paragraph, and every one of those paragraphs rendered behind the
toolbar, including "there is already a table called ...".

A shared name is fine. A rule on a shared name that says nothing about which
scene it is in is not. Say which:

    .scene > .notes { ... }     the canvas layer
    #inspector .notes { ... }   the panel's validation line

Anchoring to a class only one scene uses counts too, which is why
\`.box li .type\` stands as it is. ADR 0037.
`)
  process.exit(1)
}

console.log(
  shared.length === 0
    ? 'The canvas and the inspector share no class name, so no rule can reach across.'
    : `${shared.length} class name${shared.length === 1 ? '' : 's'} used by both studio scenes (${shared
        .map((name) => `.${name}`)
        .join(', ')}); every rule naming one is anchored to a scene.`,
)
