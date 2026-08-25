---
kind: table
table: customers
columns:
  - name: id
    type: uuid
    pk: true
  - name: email
    type: citext
    null: false
  - name: display_name
    type: text
    null: false
  - name: marketing_opt_in
    type: boolean
    null: false
    default: 'false'
  - name: anonymised_at
    type: timestamptz
    null: true
  - name: created_at
    type: timestamptz
    null: false
    default: now()
indexes:
  - name: customers_email_key
    columns: [email]
layout: { x: 40, y: 340 }
---

One row per person who has ever checked out. There is no separate accounts
table: a guest checkout creates a customer row with no password, and setting a
password later is an update to the auth service, not to this row.

`email` is `citext` rather than `text` because people type their own address in
whatever case their phone decides on, and we had two customers with the same
address in different cases before this changed. `customers_email_key` is a
unique index; the format cannot say so yet, so this comment is the only place
that fact is written down. Treat it as a rule until it can be declared.

**An erasure request does not delete this row.** It rewrites `email` and
`display_name` to placeholders and stamps `anonymised_at`. The row has to
survive because `orders` points at it and the finance export replays whole
quarters: deleting a customer would change a number in a report that was already
signed off. When you write anything that shows a customer to a human, check
`anonymised_at` first, because a table full of `deleted-4f2a@invalid` is
alarming in a support tool that does not expect it.

`marketing_opt_in` is only ever set by the customer, never by us, and never
defaulted to true on any code path. The default is false here so that a new code
path that forgets to ask gets the safe answer rather than the convenient one.
