# 0073. Enter again goes into the panel, and Escape comes back

## Context

ADR 0067 gave the canvas one tab stop and made the arrows move it, and
`index.html` described the result to a screen reader in one sentence:

> Tab reaches one object on the canvas. Arrow keys move between objects, Home and
> End go to the first and the last, and Enter opens the panel for the one you are
> on.

Every clause of it was driven in Chromium on 2026-09-08 against the studio
running on [`examples/shop`](../../../examples/shop), and every clause is true.
`Tab` lands on `article#table-addresses`, `ArrowRight` reaches `table-order_items`
then `table-products`, `ArrowLeft` comes back, `Home` and `End` reach the first
and the last, and `Enter` opens `aside#inspector` with the heading `addresses`
while the status line says `Selected table addresses.` No page errors anywhere.

**What the sentence does not say is how to get into the panel it just opened.**
Focus stays on the canvas object. Counted in the same run: reaching the first
control in the panel from there takes **nine presses of `Tab`**, and the route is

```
div.note-body -> #zoom-out -> #zoom-in -> #zoom-reset -> #zoom-fit
             -> #add-table -> #add-note -> #add-group -> input
```

a note's scrollable body, then the whole toolbar, then the panel. The panel held
**117 of the page's 125 focusable elements** at that moment, so the thing a person
came for is on the far side of everything else the page has.

**Focus staying put is defensible and this record keeps it.** The obvious fix is
to move focus into the panel on `Enter`, and it was weighed and refused.
Somebody walking the canvas with the arrows and pressing `Enter` on each object
to hear what is there would be thrown off the drawing every time, and getting
back would be a `Shift`+`Tab` through the toolbar in the other direction. ADR
0067 separated moving from selecting so that the drawing would not relay out
under a person on every press; throwing their focus across the page on every
`Enter` is the same cost in a different place.

One argument for moving focus turned out not to exist. It reads well: leave focus
on the canvas and somebody can arrow to the next table and watch the panel
follow. The canvas does not do that. ADR 0067 made the arrows move the tab stop
and deliberately not the selection, so arrowing off a selected box leaves the
panel showing the box you left. That is the right behaviour and it is not a
reason for anything here.

Escape was the other half. From inside the panel it did nothing at all: the
document handler in `main.ts` returned early on `inspectorHost.contains(
document.activeElement)`, with a comment saying Escape there is the field's own.
Two fields do answer it, the rename input and the create input. Everything else
in the panel had no answer and got the early return, so the press was swallowed
by a rule written for the two that were not.

## Decision

**`Enter` on an object whose panel is already open moves focus into that panel,
at its heading. `Escape` from inside the panel moves focus back to the canvas
object, leaving the panel open and the selection standing.**

**The second press and not the first**, for the reason ADR 0067 made moving and
selecting two presses. The first `Enter` opens the panel and changes nothing
about where anybody is standing, so a person walking the drawing keeps walking
it. The second is unambiguous: the panel it would take you to is the one already
on screen, and there is nothing else the press could mean. It also costs no new
key, which was the alternative: `F6` is the platform convention for cycling
panes and it is already the browser's.

**The heading and not the first control.** `<h2>` is the first thing in all four
panels `inspector.ts` builds, so landing there says "addresses, heading level 2"
before anything else, which is the answer to "which of the eleven boxes am I
looking at". Its `tabindex` is `-1`, set when it is focused rather than when it
is built, so the tab order through the page is exactly what it was and the first
control is one further `Tab` on, where it already was.

**Escape leaves rather than closes.** The panel stays open and the selection
stands, because this press is somebody going back to the drawing and not
somebody cancelling. Closing it would also be the lost edit the old comment was
protecting against. The two fields that answer Escape themselves now call
`stopPropagation`, so their press never reaches the document handler: one press
should have one answer, and two answers to it is one of them happening by
accident.

**And the sentence in `index.html` says both**, because that sentence is the only
thing on the page that tells anybody the keys exist, and it was one step short of
useful.

## Consequences

- **Nine presses of `Tab` became one press of `Enter`.** Measured before and
  after by driving it rather than by describing it: nine, then zero, because the
  second `Enter` lands in the panel directly. The first control is one `Tab`
  further, so a person who wants the control rather than the heading pays two
  presses against nine.
- **Every clause that was true is still true.** Driven again after the change on
  all three kinds of object: `Tab`, `ArrowRight`, `ArrowLeft`, `Home`, `End`,
  `Enter`, second `Enter`, `Escape`, and then `ArrowRight` to prove the canvas is
  still walkable from where Escape put you. A note (`note-the-copies-are-
  deliberate`) and a group (`warehouse`) answer the pair exactly as a table does,
  and both come back to the object they left. No page errors on any run.
- **Escape now means two things and which one it means depends on where focus
  is.** On the canvas it clears the selection, as it always did; in the panel it
  goes back. That is one word for two things and it is the cost of not inventing
  a key. What makes it readable is that both are "leave what I am in", and the
  sentence in `index.html` says the panel one out loud. Confirmed still working
  on the canvas after the change: Escape there closes the panel and empties the
  status line.
- **The two fields that answer Escape kept it, and now keep it on purpose.**
  Before, the document handler's early return was what protected them, which
  meant the protection covered every other control in the panel too. Driven:
  typing over the rename field and pressing Escape puts `addresses` back and
  leaves focus in the field; pressing Escape in the prose textarea, which has no
  answer of its own, goes back to the canvas.
- **`Canvas` gained a public `takeFocus()` and a fifth handler.** The handler is
  how the canvas asks for something it must not know how to do, which is the
  argument this file's header already makes about `onSelect`. `takeFocus` returns
  to `focused` before `selected`, because `focused` is the object carrying
  `tabindex="0"` and coming back to anything else would move the tab stop as a
  side effect.
- **A press that does nothing is not swallowed.** `onEnterPanel` returns whether
  focus moved, and the canvas leaves the key alone when it did not, so a second
  `Enter` on an object whose panel has been emptied under it is not a consumed
  press. That path is reasoned rather than driven: it needs a delete racing a
  selection.
- **`Space` follows `Enter`**, because the canvas has always treated them as one
  key. The sentence names only `Enter`, which is what it named before.

## Revisit when

- **The panel gets more than one heading.** `takeFocus` takes the first `h2` in
  the panel, which is exact today because each of the four panels opens with
  one. A panel built out of sections with their own headings makes "the first
  one" a choice rather than a fact.
- **Something else on the page wants Escape.** The word now carries the canvas's
  meaning, the panel's, the placement mode's, and two fields' own. That is four,
  the routing is positional, and a fifth claimant is the point at which it should
  be written down in one place rather than discovered in four.
- **An edge becomes reachable by keyboard.** ADR 0071 and ADR 0072 both leave
  this open. An edge is not in `reachables()` and so is not in the reading order
  the arrows walk; when it is, "the panel for the one you are on" has to mean
  something for a relationship, and the sentence in `index.html` grows again.
- **The toolbar stops sitting between the canvas and the panel.** Nine was a
  count of what happens to be in the way, and the argument here is about the
  route existing at all rather than about its length. A rearranged page that made
  it three would not make this wrong, only cheaper.
