---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    pk: true
  - name: customer_id
    type: uuid
    nullable: false
    ref: customers.id
    on delete: restrict
  - name: shipping_address_id
    type: uuid
    nullable: false
    ref: addresses.id
    on delete: restrict
  - name: subscription_id
    type: uuid
    nullable: true
    ref: subscriptions.id
    on delete: restrict
  - name: status
    type: text
    nullable: false
    default: "'placed'"
  - name: total_pence
    type: integer
    nullable: false
  - name: psp_reference
    type: text
    nullable: true
  - name: roast_day
    type: date
    nullable: true
  - name: placed_at
    type: timestamptz
    nullable: false
    default: now()
indexes:
  - name: orders_customer_placed_idx
    columns: [customer_id, placed_at]
  - name: orders_open_idx
    columns: [status, roast_day]
layout: { x: 480, y: 340 }
---

One row per order, whether a person placed it in the shop or the Monday
subscription job created it. `subscription_id` is what tells the two apart, and
it is null for a normal order rather than pointing at a fake subscription, so
`where subscription_id is null` is the shop's own sales.

**Rows are never deleted.** A cancelled order keeps its row with
`status = 'cancelled'` and keeps its lines, because the finance export replays a
date range and a row that disappears silently changes a number in a quarter that
has already been reported.

The statuses, and what they actually mean here:

- `placed` : paid for, waiting to be assigned to a roast day.
- `roasting` : assigned to `roast_day` and waiting for it. **This is not a
  warehouse state.** An order sits in `roasting` for up to four days because we
  roast on Thursdays and Mondays, and that is normal rather than a fault. Every
  few months somebody builds an alert on "orders stuck in a state for more than
  a day" and this is the state that pages them at 2am.
- `packed` : bagged and labelled, in the depot, not yet handed over.
- `shipped` : at least one `shipments` row has a `shipped_at`. An order with two
  parcels is `shipped` when the first one goes, which is a lie the customer
  emails about occasionally and which we have decided to live with.
- `cancelled` : before roasting, refunded in full.
- `refunded` : after shipping, and the money is the PSP's record, not ours.

`total_pence` is what the customer was charged, stored, and it is deliberately
not recomputed from `order_items`. If re-adding the lines today gives a
different answer, the lines are right about what was ordered and this column is
right about what was paid, and the difference is a bug worth a person looking at
rather than a number worth quietly correcting.

`psp_reference` is the only thing we keep about the payment. Everything else,
including whether a refund succeeded, is a question for the payment provider.

`orders_open_idx` serves the roast-day planner, which asks for everything not
yet packed grouped by the day it is due. It is not much use for anything else,
because `status` has six values and four of them are historical.
