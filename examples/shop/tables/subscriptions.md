---
kind: table
table: subscriptions
columns:
  - name: id
    type: uuid
    pk: true
  - name: customer_id
    type: uuid
    nullable: false
    ref: customers.id
  - name: style
    type: text
    nullable: false
    default: "'house'"
  - name: bag_grams
    type: integer
    nullable: false
    default: "250"
  - name: weeks_between
    type: integer
    nullable: false
    default: "2"
  - name: next_run_on
    type: date
    nullable: false
  - name: paused_until
    type: date
    nullable: true
  - name: cancelled_at
    type: timestamptz
    nullable: true
indexes:
  - name: subscriptions_due_idx
    columns: [next_run_on]
layout: { x: 40, y: 640 }
---

A standing order for coffee. Every Monday at 03:10 a job selects the rows whose
`next_run_on` is today or earlier and whose `cancelled_at` is null, creates an
order for each, and pushes `next_run_on` forward by `weeks_between`.
`subscriptions_due_idx` exists for that job and for nothing else, which is worth
knowing before you widen it.

**There is no `product_id`, and that is the interesting decision here.** A
subscriber is subscribed to a *style*, not to a coffee. `style` is one of
`house`, `bright` or `decaf`, and the roaster decides on roast day which bean
fills it, because in March we genuinely do not know what lot we will have in
June. Adding a `product_id` would let a subscription pin itself to a coffee we
then run out of, and the failure mode is an order that cannot be filled and a
customer who was promised something specific. If somebody wants a named coffee
every month, they buy it every month.

`paused_until` and `cancelled_at` are different things and support gets this
wrong about once a quarter. Paused means the customer is away: the row is live,
the job skips it while `paused_until` is in the future, and it resumes on its
own. Cancelled is final and the row stays only so that a returning customer's
history is intact. A cancelled subscription is never un-cancelled; the customer
gets a new row.

`weeks_between` is weeks and not days because roast days are weekly, so anything
that is not a whole number of weeks is a promise we cannot keep.
