---
kind: table
table: promotions
columns:
  - name: code
    type: text
    nullable: false
  - name: percent_off
    type: integer
    nullable: false
layout: { x: 920, y: 40 }
---

No `pk: true` anywhere: `primary-key-missing`, a warning, because a table
without a key is a real thing to have and usually a thing to fix later.

`code` is therefore neither a primary key nor covered by a unique index, which
is what makes `orders.promo_code` a `ref-target-not-unique`.
