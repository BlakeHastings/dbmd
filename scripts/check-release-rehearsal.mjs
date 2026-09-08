// Fail when the release rehearsal has drifted from the release it rehearses.
//
// WHAT THIS PREVENTS
// `.github/workflows/rehearse-release-ancestry.yml` exists to run, on a tag
// push, the one step of `.github/workflows/release.yml` that has never run. It
// can only do that by holding a copy of that step: the checkout it runs under,
// and the shell that reaches the verdict. A copy is a second place for the same
// configuration to go stale, and a rehearsal that has silently stopped matching
// the thing it rehearses is worse than no rehearsal, because it reports green
// about a setup nobody is using. That is the failure this repository has
// already paid for more than once.
//
// So the rehearsal is not allowed to be a copy nobody checks. This script reads
// both files and refuses unless the parts under rehearsal are the same parts.
//
// WHY A CHECKED COPY RATHER THAN ONE EXTRACTED FILE
// The obvious alternative is to lift the shell into a script both workflows
// run. It is not available and it would not be better if it were.
//
// It is not available because taking it would mean editing `release.yml`, and
// that is the one file in this repository where a wrong edit is expensive and
// unobservable until the afternoon somebody is trying to ship.
//
// It would not be better because of what `release.yml` is. Every line of that
// step's reasoning lives in the comment directly above it, which is most of
// ADR 0060, and moving the body out leaves the argument pointing at a file the
// reader has to go and find. It would also make the release depend on a path
// resolving at tag time, where today the step is self-contained in the file the
// owner reviews before they push. A rehearsal is a nice thing to have; the
// release working is not optional, and it should not grow a dependency to buy
// the rehearsal a convenience.
//
// A copy with an equality check has the property that actually matters: the two
// cannot differ without something going red. This script is that something.
//
// WHAT IT CHECKS, AND WHY EACH ONE
//
//   the checkout action and its `with:` block
//     The whole subject. Whether `actions/checkout@v7` with `fetch-depth: 0`
//     populates `refs/remotes/origin/main` on a tag push is the open question,
//     so a rehearsal running a different checkout, or the same checkout with
//     different options, answers a question nobody asked.
//
//   the ancestry shell, character for character
//     It is held once in the rehearsal, as a quoted heredoc, and run three
//     times against three states. `merge-base --is-ancestor` may not appear
//     anywhere else in the rehearsal, because a second copy of the comparison
//     is a second thing that can be right while the original is wrong.
//
//   the two tag patterns cannot both match one tag
//     If they could, a rehearsal tag would start a release. GitHub's filter
//     pattern cheat sheet gives tag patterns a whole-name match anchored at the
//     start (`v2*` "matches branch and tag names that start with `v2`"), so a
//     tag matching a pattern begins with that pattern's literal prefix. Two
//     patterns whose literal prefixes are not prefixes of each other therefore
//     cannot share a tag. That is what is checked, conservatively: any
//     construct this script cannot reduce to a literal prefix is a refusal
//     rather than a guess.
//
//   the rehearsal cannot publish
//     No `npm publish`, no `NPM_TOKEN`, no `secrets.` at all, no
//     `registry-url`, and read-only permissions. `release.yml` says why the
//     third of those matters on its own: without `registry-url` nothing writes
//     the `.npmrc` that `NODE_AUTH_TOKEN` is read through, so a token in this
//     job would be set and ignored. Four properties rather than one because
//     "structurally incapable" should not rest on a single line staying absent.
//
// WHY IT PARSES BY ANCHOR RATHER THAN BY YAML
// It reads the two files as lines and demands exact anchors: one
// `actions/checkout` step, a step by that name, one heredoc by that marker. A
// YAML parse would be tidier and would quietly succeed on a `release.yml`
// restructured so that none of those anchors exist any more, which is drift of
// exactly the kind this exists to catch. Refusing to find the anchor is the
// correct answer there. It also means this file imports nothing outside
// `node:`, so the rehearsal runs it on a runner with no `npm ci` and therefore
// no npm in the job at all.
//
//   node scripts/check-release-rehearsal.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const WORKFLOWS = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows')

const RELEASE = 'release.yml'
const REHEARSAL = 'rehearse-release-ancestry.yml'

/** The name of the `release.yml` step whose body the rehearsal copies. */
const ANCESTRY_STEP = 'the tagged commit is on main'

/** The heredoc the rehearsal holds that body in. */
const MARKER = 'ANCESTRY'

/** The comparison that decides the verdict, and may live in exactly one place. */
const COMPARISON = 'merge-base --is-ancestor'

const problems = []

/** Everything wrong with one file, gathered so a reader fixes them in one pass. */
function refuse(file, what, detail) {
  problems.push({ file, what, detail })
}

function read(file) {
  try {
    return readFileSync(join(WORKFLOWS, file), 'utf8').split(/\r?\n/)
  } catch {
    refuse(file, 'is not there', `Expected .github/workflows/${file}.`)
    return null
  }
}

/** The column of the first non-space character, or -1 for a blank line. */
function indentOf(line) {
  const at = line.search(/\S/)
  return at
}

/** A line that carries no YAML: blank, or a comment on its own. */
function isNoise(line) {
  return line.trim() === '' || line.trim().startsWith('#')
}

/**
 * The lines of the block that starts at `start`: that line, plus every
 * following line indented further than it. Trailing blanks are dropped.
 */
function blockAt(lines, start) {
  const indent = indentOf(lines[start])
  const out = [lines[start]]
  for (let i = start + 1; i < lines.length; i++) {
    const here = indentOf(lines[i])
    if (here === -1) {
      out.push(lines[i])
      continue
    }
    if (here <= indent) break
    out.push(lines[i])
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return out
}

/** Remove `amount` columns of leading space from every non-blank line. */
function dedent(lines, amount) {
  return lines.map((line) => (line.trim() === '' ? '' : line.slice(amount)))
}

/**
 * The one `actions/checkout` step: which version it pins, and the settings it
 * was handed. Comments inside `with:` are dropped, because a rehearsal is
 * expected to explain itself and `release.yml` is expected to explain itself,
 * and neither explanation is configuration.
 */
function checkoutStep(lines, file) {
  const found = []
  lines.forEach((line, index) => {
    if (/^\s*-?\s*uses:\s*actions\/checkout@/.test(line)) found.push(index)
  })
  if (found.length !== 1) {
    refuse(
      file,
      `has ${found.length} actions/checkout steps and this check needs exactly one`,
      'The rehearsal is a claim about one checkout. Two of them, or none, means\n' +
        'the claim no longer has a subject and this script cannot say which one.',
    )
    return null
  }
  const block = blockAt(lines, found[0])
  const uses = /uses:\s*(\S+)/.exec(block[0])[1]
  const withAt = block.findIndex((line) => /^\s*with:\s*$/.test(line))
  if (withAt === -1) return { uses, with: [] }
  const settings = blockAt(block, withAt)
    .slice(1)
    .filter((line) => !isNoise(line))
    .map((line) => line.trim())
  return { uses, with: settings }
}

/** The `run:` body of the step with this name, dedented, as one string. */
function namedStepRun(lines, file, name) {
  const at = lines.findIndex((line) => new RegExp(`^\\s*-\\s*name:\\s*${name}\\s*$`).test(line))
  if (at === -1) {
    refuse(
      file,
      `has no step named "${name}"`,
      'That step is what the rehearsal copies. If it was renamed, rename it in\n' +
        'both places and in this script; if it was removed, this whole rehearsal\n' +
        'has lost its subject and should go with it.',
    )
    return null
  }
  const block = blockAt(lines, at)
  const runAt = block.findIndex((line) => /^\s*run:\s*\|-?\s*$/.test(line))
  if (runAt === -1) {
    refuse(
      file,
      `step "${name}" no longer has a literal block \`run: |\` body`,
      'This script reads that body as text to compare it. A folded or inline\n' +
        'body would need a different reader and a different argument.',
    )
    return null
  }
  const body = blockAt(block, runAt).slice(1)
  const amount = Math.min(...body.filter((l) => l.trim() !== '').map(indentOf))
  return dedent(body, amount).join('\n').trimEnd()
}

/** The payload of the one `<<'MARKER'` heredoc, dedented, as one string. */
function heredocPayload(lines, file, marker) {
  const opens = []
  lines.forEach((line, index) => {
    if (line.includes(`<<'${marker}'`)) opens.push(index)
  })
  if (opens.length !== 1) {
    refuse(
      file,
      `holds ${opens.length} <<'${marker}' heredocs and this check needs exactly one`,
      'The shell under rehearsal is written out once and run three times. More\n' +
        'than one copy of it is the drift this script exists to refuse.',
    )
    return null
  }
  const start = opens[0]
  const amount = indentOf(lines[start])
  let end = -1
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === marker) {
      end = i
      break
    }
  }
  if (end === -1) {
    refuse(file, `has a <<'${marker}' heredoc that is never closed`, 'Nothing to compare.')
    return null
  }
  const body = lines.slice(start + 1, end)
  const short = body.find((line) => line.trim() !== '' && indentOf(line) < amount)
  if (short !== undefined) {
    refuse(
      file,
      `has a <<'${marker}' payload line indented less than the heredoc that opens it`,
      `  ${short}\n` +
        'A YAML block scalar is dedented by its own base indent, so a line above\n' +
        'that base would leave the shell script mis-indented. Nothing here can\n' +
        'compare a payload it cannot dedent.',
    )
    return null
  }
  return { text: dedent(body, amount).join('\n').trimEnd(), start, end }
}

/**
 * The tag patterns a workflow triggers on, and a refusal for anything this
 * script cannot read as a plain list under `on: push: tags:`.
 */
function tagPatterns(lines, file) {
  const found = []
  lines.forEach((line, index) => {
    if (/^\s*tags:\s*/.test(line)) found.push(index)
  })
  if (found.length !== 1) {
    refuse(
      file,
      `has ${found.length} \`tags:\` keys and this check needs exactly one`,
      'The two workflows are kept apart by their tag patterns, so a file with\n' +
        'more than one list of them is not something this script should guess at.',
    )
    return null
  }
  const at = found[0]
  const rest = lines[at].slice(lines[at].indexOf('tags:') + 5).trim()
  let raw
  if (rest.startsWith('[')) {
    raw = rest
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
  } else if (rest === '') {
    raw = blockAt(lines, at)
      .slice(1)
      .filter((line) => !isNoise(line))
      .map((line) => /^\s*-\s*(.+?)\s*$/.exec(line)?.[1])
      .filter((part) => part !== undefined)
  } else {
    refuse(file, `writes \`tags: ${rest}\`, which this check cannot read`, 'Use a list.')
    return null
  }
  return raw.map((part) => part.replace(/^['"]|['"]$/g, ''))
}

/**
 * The part of a pattern every matching tag must begin with.
 *
 * GitHub's filter patterns are anchored, so a tag matching a pattern starts
 * with whatever the pattern says before its first wildcard. `?` and `+` bind to
 * the character before them, so that character is not literal either. Anything
 * this cannot reduce, it reduces to the empty string, and an empty prefix is a
 * refusal below rather than a pattern this script pretends to understand.
 */
function literalPrefix(pattern) {
  if (pattern.startsWith('!')) return ''
  let prefix = ''
  for (let i = 0; i < pattern.length; i++) {
    const here = pattern[i]
    if (here === '*' || here === '[') break
    const next = pattern[i + 1]
    if (next === '?' || next === '+') break
    prefix += here
  }
  return prefix
}

const release = read(RELEASE)
const rehearsal = read(REHEARSAL)

if (release !== null && rehearsal !== null) {
  // ---- the checkout, which is the whole subject -----------------------------
  const theirs = checkoutStep(release, RELEASE)
  const ours = checkoutStep(rehearsal, REHEARSAL)
  if (theirs !== null && ours !== null) {
    if (theirs.uses !== ours.uses) {
      refuse(
        REHEARSAL,
        'checks out with a different action than the release does',
        `  ${RELEASE}:   ${theirs.uses}\n` +
          `  ${REHEARSAL}: ${ours.uses}\n` +
          'Whether that action populates refs/remotes/origin/main on a tag push is\n' +
          'the entire question. Rehearsing a different one answers nothing.',
      )
    }
    if (theirs.with.join('\n') !== ours.with.join('\n')) {
      refuse(
        REHEARSAL,
        'hands the checkout different settings than the release does',
        `  ${RELEASE}:   ${theirs.with.join(', ') || '(none)'}\n` +
          `  ${REHEARSAL}: ${ours.with.join(', ') || '(none)'}\n` +
          'fetch-depth is why origin/main is expected to be there at all, so the\n' +
          'two `with:` blocks agreeing is the difference between a rehearsal and a\n' +
          'workflow that happens to run git.',
      )
    }
  }

  // ---- the shell that reaches the verdict -----------------------------------
  const body = namedStepRun(release, RELEASE, ANCESTRY_STEP)
  const copy = heredocPayload(rehearsal, REHEARSAL, MARKER)
  if (body !== null && copy !== null) {
    if (body !== copy.text) {
      const mine = copy.text.split('\n')
      const yours = body.split('\n')
      const line = yours.findIndex((text, index) => mine[index] !== text)
      refuse(
        REHEARSAL,
        'runs a different shell than the release does',
        `  first difference at line ${line + 1} of the step body\n` +
          `  ${RELEASE}:   ${JSON.stringify(yours[line] ?? '(nothing, it is shorter)')}\n` +
          `  ${REHEARSAL}: ${JSON.stringify(mine[line] ?? '(nothing, it is shorter)')}\n` +
          'The rehearsal is only worth reading if it ran the release\'s own lines.\n' +
          `Copy the \`run:\` body of "${ANCESTRY_STEP}" into the heredoc verbatim.`,
      )
    }
    const elsewhere = []
    rehearsal.forEach((line, index) => {
      if (!line.includes(COMPARISON)) return
      if (index > copy.start && index < copy.end) return
      elsewhere.push(index + 1)
    })
    if (elsewhere.length > 0) {
      refuse(
        REHEARSAL,
        `runs \`${COMPARISON}\` outside the copied shell, at line ${elsewhere.join(', ')}`,
        'One copy of the comparison, in one place, checked against the release.\n' +
          'A second one is a second thing that can be right while the first is\n' +
          'wrong, which is the whole failure this script exists to refuse.',
      )
    }
  }

  // ---- the two tags cannot be one tag ---------------------------------------
  const releaseTags = tagPatterns(release, RELEASE)
  const rehearsalTags = tagPatterns(rehearsal, REHEARSAL)
  if (releaseTags !== null && rehearsalTags !== null) {
    for (const mine of rehearsalTags) {
      const ourPrefix = literalPrefix(mine)
      for (const yours of releaseTags) {
        const theirPrefix = literalPrefix(yours)
        const unreadable = ourPrefix === '' || theirPrefix === ''
        const overlap =
          unreadable || ourPrefix.startsWith(theirPrefix) || theirPrefix.startsWith(ourPrefix)
        if (!overlap) continue
        refuse(
          REHEARSAL,
          `triggers on \`${mine}\`, which this check cannot rule out matching \`${yours}\``,
          `  ${REHEARSAL} matches tags beginning ${JSON.stringify(ourPrefix)}\n` +
            `  ${RELEASE} matches tags beginning ${JSON.stringify(theirPrefix)}\n` +
            (unreadable
              ? 'One of those is empty, which means this script could not reduce the\n' +
                'pattern to a prefix and is refusing rather than guessing.\n'
              : 'One of those is a prefix of the other, so a single tag could fire\n' +
                'both workflows, and a rehearsal that starts a release is not a\n' +
                'rehearsal.\n') +
            'Pick patterns whose literal prefixes diverge at the first character.',
        )
      }
    }
  }

  // ---- and it cannot publish ------------------------------------------------
  const forbidden = [
    ['npm publish', 'the rehearsal must have no publish step at all'],
    ['NPM_TOKEN', 'the rehearsal must not name the publishing token'],
    ['secrets.', 'the rehearsal must not read any secret'],
    ['registry-url', 'without it no .npmrc is written and NODE_AUTH_TOKEN is ignored'],
  ]
  for (const [needle, why] of forbidden) {
    const lines = []
    rehearsal.forEach((line, index) => {
      // A comment cannot publish, and the rehearsal's header names all four of
      // these while explaining why it does not have them. So a line that is
      // nothing but a comment is skipped, and a trailing comment on a real line
      // is not: the point is what the runner executes.
      if (isNoise(line)) return
      if (line.includes(needle)) lines.push(index + 1)
    })
    if (lines.length === 0) continue
    refuse(
      REHEARSAL,
      `writes \`${needle}\` at line ${lines.join(', ')}`,
      `${why}.\nA rehearsal that can reach the registry is a release with a different name.`,
    )
  }
  const permissionsAt = rehearsal.findIndex((line) => /^permissions:\s*$/.test(line))
  const granted =
    permissionsAt === -1
      ? null
      : blockAt(rehearsal, permissionsAt)
          .slice(1)
          .filter((line) => !isNoise(line))
          .map((line) => line.trim())
  if (granted === null || granted.join(', ') !== 'contents: read') {
    refuse(
      REHEARSAL,
      'no longer declares exactly `permissions: contents: read`',
      `  found: ${granted === null ? '(no top level permissions block)' : granted.join(', ')}\n` +
        'Read-only is the fourth of the four reasons this job cannot publish, and\n' +
        'the only one a reader sees without following an argument.',
    )
  }

  // ---- and the trigger is the one thing it claims to be ---------------------
  const onAt = rehearsal.findIndex((line) => /^on:\s*$/.test(line))
  const triggers =
    onAt === -1
      ? []
      : blockAt(rehearsal, onAt)
          .slice(1)
          .filter((line) => !isNoise(line))
          .map((line) => line.trim())
  if (triggers.length !== 2 || triggers[0] !== 'push:' || !triggers[1].startsWith('tags:')) {
    refuse(
      REHEARSAL,
      'triggers on something other than a tag push, and only a tag push',
      `  found: ${triggers.join(' / ') || '(no on: block)'}\n` +
        'What a tag push hands the checkout is the subject. A run on any other\n' +
        'event is green about a case nobody is asking about, which is the shape\n' +
        'of rehearsal this repository would rather not have.',
    )
  }
}

if (problems.length > 0) {
  console.error(
    `The release rehearsal has drifted from the release, in ${problems.length} ` +
      `place${problems.length === 1 ? '' : 's'}:\n`,
  )
  for (const problem of problems) {
    console.error(`  ${problem.file} ${problem.what}`)
    for (const line of problem.detail.split('\n')) console.error(`    ${line}`)
    console.error('')
  }
  console.error(
    'Fix the rehearsal, not the release. .github/workflows/release.yml is the\n' +
      'thing being rehearsed and the one file here where a wrong edit is expensive\n' +
      'and unobservable until somebody is trying to ship. ADR 0097.',
  )
  process.exit(1)
}

console.log(
  `${REHEARSAL} still rehearses ${RELEASE}: same checkout action and \`with:\` block, ` +
    `the same "${ANCESTRY_STEP}" shell character for character and nowhere else, ` +
    'tag patterns that cannot both match one tag, and no way to publish. ' +
    'It does not check the setup-node, npm ci or publish steps, which the rehearsal ' +
    'deliberately does not have.',
)
