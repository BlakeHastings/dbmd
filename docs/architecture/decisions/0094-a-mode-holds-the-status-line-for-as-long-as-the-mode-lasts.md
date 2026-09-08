# 0094. A mode holds the status line for as long as the mode lasts

## Context

The canvas has one mode. `Add table` and `Add note` arm it, the cursor becomes a
crosshair, the next press on the canvas is a coordinate rather than a grab, and
`canvas.ts` says in as many words why that is the only mode there is: a mode the
developer forgot they were in is a click that did something they did not ask
for.

The mode announces itself twice, on the button as `aria-pressed` and on the
status line as `Click the canvas where the new note goes. Escape cancels.`

Measured in Chromium on 2026-09-08, against a studio pointed at a throwaway copy
of `examples/shop`, with a `MutationObserver` on `#status-text`:

|      | what the line said | `aria-pressed` | `.placing` |
| --- | --- | --- | --- |
| 693 ms | `Nothing written this session. Undo is git checkout.` | false | false |
| 716 ms | `Click the canvas where the new note goes. Escape cancels.` | true | true |
| 2028 ms | `Nothing written this session. Undo is git checkout.` | true | true |
| 4026 ms | the same | true | true |
| 9734 ms | the same | true | true |

**The mode lasted indefinitely and its explanation lasted under two seconds.**
At 9.7 seconds the button was still pressed, the canvas still carried
`.placing`, and a click on the canvas still placed the note: measured, it landed
at 973, 584 and opened the panel for it. The only thing that had gone was the
sentence saying so.

The mechanism is that `showArmed` wrote the sentence straight into the element
and nothing ever wrote it again, while `showStatus` renders `WireStatus` on
every heartbeat and never asked whether the canvas was in a mode. Two seconds is
`HEARTBEAT_MS`.

**What replaced it in the measured run was `4 edits were dropped rather than
written. Each line below says why.`** which is an alarming thing to read while
the cursor is a crosshair waiting for a click, with nothing on the page saying
what the crosshair is for.

## Decision

**Everything that writes the status line goes through one gate, and while the
canvas is placing that gate renders the mode's sentence instead.**

`showLine` in `main.ts` is the gate. `say`, every render of a `WireStatus`, and
the read that failed all come through it. One gate rather than a branch in each,
because the rule is about the element and a rule enforced in three places is a
rule that is true in two of them.

**The mode wins over the refusals, and that is the part worth arguing.**
`standing` with a bad tone, `stale` and `writeError` are in the precedence order
precisely because they are the only places a developer is told an edit did not
happen, and this puts a sentence in front of them.

It is a postponement rather than a loss, and a short one:

- The mode ends on the next press or on Escape, and both are immediate. There is
  no timer and nothing else can end it.
- The line the mode borrowed is kept current underneath it. It starts as the
  line that was on screen when the mode was armed, because arming produces no
  response to redraw from, and every render that arrives while the mode is on
  replaces it. So what is handed back is the newest answer rather than the one
  from the press.
- A conflict is a list in the footer with its own name and its own box, and it
  is on screen the whole time either way. The status line's conflict sentence is
  the pointer at that list, not the news itself.

Against that, the alternative is a crosshair nobody can explain.

**Rejected: end the mode when its sentence goes.** This is the other half of the
brief that produced this record, and it is worse in both directions. A mode that
expires on a heartbeat is a mode that ends while somebody is deciding where to
put the box, and the press they then make is a press that does something they
did not ask for, which is the whole thing the one mode is careful about. It also
makes the mode's lifetime a function of the poll interval, which is a number
chosen for how often to ask the server whether a file changed.

**Rejected: a second line, so both can be read.** The footer is one line by
design and the selection announcement already shares it. Two lines is a layout
change and a live region question, and it would buy the ability to read a
refusal a second earlier than Escape would have given it.

## Consequences

Measured after the change, same page, same observer:

|      | what the line said | `aria-pressed` | `.placing` |
| --- | --- | --- | --- |
| 725 ms | `Nothing written this session. Undo is git checkout.` | false | false |
| 743 ms | `Click the canvas where the new note goes. Escape cancels.` | true | true |
| 2038 ms | the same | true | true |
| 8035 ms | the same | true | true |
| 9759 ms | the same | true | true |

- **The page and the pointer now say the same thing.** For as long as there is a
  crosshair there is a sentence saying what it is for.
- **The line that comes back is current.** Driven: a drag, then `Add table`
  armed while the write was still pending, then Escape three seconds later. The
  line came back as `Wrote tables/orders.md at 4:10:21 AM. Undo is git
  checkout.`, which is the sentence that arrived while the mode was on and not
  the one that was on screen when it started.
- **A placement completed promptly is unchanged.** Armed, clicked, and the line
  went straight to the ordinary status with `aria-pressed` false and `.placing`
  off, the panel open on the new note. That is the path everybody takes and it
  looks exactly as it did.
- **`showStatus` no longer decides what the line says.** It computes it, in
  `statusLine`, and hands it over. That split is what let the mode branch exist
  in one place, and it is also what makes the precedence order readable as a
  list of returns rather than as a chain of writes into an element.
- **A refusal can now be up to one mode late.** Nothing else changed about the
  refusals: they are computed the same way, in the same order, and rendered the
  moment the mode ends.

## Revisit when

- **A second mode appears on the canvas.** The gate asks `canvas.placing`, which
  is one boolean, and a second mode would want the question to be "is any mode
  on" and the sentence to come from whichever one it is.
- **Somebody arms a placement and walks away.** The mode has no timeout, on
  purpose, and this record makes the sentence last as long as the mode. If that
  turns out to be a line somebody stares past for ten minutes, the answer is
  about ending the mode and not about the sentence.
- **The footer gains a second line.** Both rejections above lean on there being
  one line to share.
