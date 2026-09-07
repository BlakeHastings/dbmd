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
    ref: custmers.id
  - name: basket_id
    type: uuid
    nullable: true
    ref: baskets.reference
  - name: promo_code
    type: text
    nullable: true
    ref: promotions.code
  - name: coupon_code
    type: text
    nullable: true
    ref: coupons.code
indexes:
  - name: orders_status_idx
    columns: [status]
layout: { x: 40, y: 40 }
---

Four refs and an index, and only one of the four refs is right.

`custmers.id` is a typo in the table half: `ref-table-unknown`.
`baskets.reference` names a table that exists and a column it does not have:
`ref-column-unknown`. `promotions.code` names a column that exists and that
nothing declares unique: `ref-target-not-unique`, a warning rather than an error
because it is occasionally what somebody meant.

`coupons.code` is the same shape as `promotions.code` and is silent, because
`coupons` carries a single-column unique index over it. That pair is the whole
reason the warning is worth having.

The index names `status`, which this table does not have:
`index-column-unknown`.
