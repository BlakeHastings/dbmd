---
kind:     table
table:    "customers"
columns:
  - {name: id, type: uuid, pk: true}
  - name: 'email'
    type: citext
    nullable: false
layout: {x: 120, y: 120}
group:   billing
---

Flow mappings, alignment padding, a second member for `billing` so that a group
drag has more than one file to write, and a file that ends without a newline.