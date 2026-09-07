---
kind: table
table: shipments
columns:
  - name: id
    type: uuid
    pk: true
  - name: order_id
    type: uuid
    nullable: false
    ref: orders.id
  - name: address_id
    type: uuid
    nullable: false
    ref: addresses.id
  - name: carrier
    type: text
    nullable: false
  - name: tracking
    type: text
    nullable: true
layout: { x: 480, y: 460 }
---

One row per parcel. An order split across two parcels is two rows, which is why
the tracking number lives here and not on the order.
