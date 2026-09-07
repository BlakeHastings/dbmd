# 0037. A class name two scenes share says which one it means

## Context

The studio is one page holding two independent scenes. `main.stage` is the
canvas, drawn by `src/studio/client/canvas.ts`; `aside#inspector` is the panel,
drawn by `src/studio/client/inspector.ts`. They are siblings, they share one
`<style>` block inside `src/studio/client/index.html`, and **a bare class
selector matches both.**

On 2026-09-07 that cost two defects hours apart.

**dbmd-34.** The canvas note element was class `note`. `#inspector .note` was
already the panel's explanatory paragraph, and the canvas rule was `position:
absolute; top: 0; left: 0`. Every explanatory sentence in the panel was torn out
of the column and stacked in the corner of the page. Fixed by renaming the
canvas element `note-card`.

**dbmd-49.** `notes` was the canvas note *layer* and the inspector's red
validation paragraph. The same three declarations, and neither `#inspector
.notes` rule sets `position`, so nothing overrode it. Every red validation
paragraph in the panel had been rendering behind the toolbar, including the
create form's "there is already a table called `orders`", which the studio
relies on somebody reading. Fixed by scoping the three scene layers to
`.scene >`.

Singular and plural, one character apart, found by two agents who did not know
about each other.

**Neither was visible in a diff or in a test.** Each file was correct on its
own. The collision existed only once a browser put both on the same page, so the
only way to see it was to drive the page and notice something in the wrong
place, which is what happened twice. Twice is a property of the arrangement
rather than an incident: one stylesheet, two scenes, and nothing that knows the
difference.

The intersection is small and it is in the source. On `main` today the canvas
and the inspector share exactly three class names: `notes`, `name` and `type`.
Every one of them already has an anchored rule, and neither defect would have
needed a browser to find if anything had been asking.

## Decision

**A class name used by both scene files is a name whose every rule has to say
which scene it means.** `scripts/check-scene-classes.mjs` runs in `npm run
check`, beside `check:commands`, and fails the build otherwise.

A selector **is anchored** when it names something belonging to exactly one
scene:

| Anchor                                | Example                     |
| ------------------------------------- | --------------------------- |
| `#inspector`                          | `#inspector .notes`         |
| `#canvas`, `.stage`, `.scene`         | `.scene > .notes`           |
| a class only one scene file writes    | `.box li .type`             |

The four roots are listed in the script because they are written in the page
rather than by either file, so nothing can derive them. Everything else is
derived: the class names each file writes are read out of the source, and the
ones exactly one file writes become anchors.

**A shared name is not the defect, so a shared name is not the failure.** The
seven `tint-*` classes are shared on purpose: a note, a group box and the
inspector's colour swatches read the same three variables, which is ADR 0005's
palette doing its job. A rule that says nothing about which scene it is in is
the failure, and that is what both defects were.

**Anchoring to a single-scene class counts.** `.box li .type` is safe because it
has already said `.box`, and the two scenes are siblings, so a chain naming one
of them cannot match inside the other. Requiring `.scene` in front of it as well
would be a specificity change to a rule that was never wrong, and there are
forty-odd of those.

### Requiring every canvas rule to be scoped was considered and rejected

It is simpler to state and it is what the item offered as the honest fallback.
It was rejected on cost: it would move forty-odd selectors under `.scene` or
`.stage`, every one a specificity change, on a page whose current appearance is
the only record of what it is supposed to look like. The item that asked for
this check also said do not restyle the page, and rewriting the canvas half of
the stylesheet to satisfy a check is restyling it.

The intersection is the smaller claim, it is the thing the two defects actually
had in common, and it is enforceable today with nothing moved. The larger rule
stays available: it is what to reach for if the intersection is ever found to
have missed one.

### How it reads the two files, and the one thing it is told

`className = ...` is read for every string on the right-hand side, because the
canvas writes `element.className = table.complete ? 'box' : 'box broken'` and
`box` is the class that anchors four other rules. `classList.add/remove/toggle`
is read for its first argument only, because `classList.toggle('selected',
this.isSelected('table', name))` has two strings in it and one of them is a
class.

**Two helper functions are named in the script, and that is the only thing it is
told rather than shown.** The inspector writes almost none of its classes with
`className`: they go through `el(tag, className, text)`, and `textField(parent,
key, ...)` passes its key on to `el` as the class. Without those, the check sees
an inspector with two classes instead of twenty-one and finds one shared name
where there are three. Each helper is verified to still be declared, so a rename
throws with a sentence naming it rather than quietly passing everything. That
failure mode — a check that stops seeing its subject and reports nothing — is
the one this whole record is about, and building it in would have been a poor
joke.

### How it reads the stylesheet

**A brace scan, not a CSS parser.** The stylesheet lives inside `<style>` in
`index.html`, so a parser is not free: it would mean a dependency, or an HTML
extraction step that is itself the thing to get wrong. The scan blanks comments
in place so every offset still points at the line it came from, walks into
at-rules, records the selector list in front of each declaration block, and
splits that list on top-level commas. `.scene > .notes, .notes` is half the
convention and half the defect, and a check reading the list as one string would
see the anchor and pass.

## Consequences

- **`npm run check` grows about 0.1s.** It reads three files once. No build, no
  network, no git, which is why it sits with the other cheap checks.
- **The shared list is printed on a passing run**, because the list is the
  finding whether or not anything is wrong. Today it is `.name`, `.notes`,
  `.type`.
- **A class name assembled at run time is invisible to it.** `tintClass()` in
  `palette.ts` returns `` `tint-${color}` ``, and neither scene file contains the
  string, so the `tint-*` classes are not reported. They are not reported because
  they cannot be seen, not because they were approved. `main.ts` writes
  `item.className = diagnostic.severity`, which is why `.error` and `.warning`
  are invisible the same way. If a third collision is ever a computed name, this
  check will not have caught it, and the fix is to say so here rather than to
  claim it would have.
- **Only the two scene files are read.** `main.ts` owns the footer and
  `index.html` writes `.toolbar`, `.divider`, `.line` and `.stage` itself.
  Neither is a scene in the sense this record means, and a class used by neither
  scene file is not an anchor either, which is the conservative direction.
- **Nested CSS would be misread.** The scan understands `@media` and flat rules,
  which is what this stylesheet is. `&` and a selector list inside `:is()` are
  not in it. Both would surface as a selector the scan could not anchor rather
  than as a quiet pass, because an unrecognised token is not an anchor.
- **Nothing in the stylesheet moved to make this pass.** It was green on `main`
  as it stood, which is the point: the convention `.scene >` and the rename to
  `note-card` were already the answer, and this makes them enforceable rather
  than replacing them.
- **It is broken on purpose in `test/guards/broken-on-purpose.test.ts`**, eight
  cases, including both original defects reduced to their shape. ADR 0034
  requires that of any guard added to `scripts/`.

## Revisit when

- **A third collision is found by driving the page.** That is the observable
  condition, and what matters is which half it lands in: a name this check could
  not see says the extraction needs another site, and a name it could see but did
  not judge wrong says the anchor rule is too generous. Either way write it here
  before fixing it.
- **The stylesheet stops being flat.** Nested CSS, or a build step that assembles
  the page from parts, and the brace scan is reading something it was not written
  for.
- **A third scene appears.** `SCENES` is a list and the intersection is written
  for any number of them, but "used by every scene" stops being the interesting
  question the moment there are three: two scenes sharing a name that the third
  does not would slip through.
- **The canvas half of the stylesheet is being rewritten anyway.** That is the
  moment the rejected rule becomes cheap, and requiring every canvas rule to be
  scoped is a stronger claim than this one.
