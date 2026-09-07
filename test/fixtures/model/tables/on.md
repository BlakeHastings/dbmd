---
kind: table
table: on
columns:
  - name: y
    type: off
    nullable: false
layout: { x: 120, y: 420 }
---

A table called `on` with a column called `y` of type `off`. Nothing about this
is sensible schema design; it is here because YAML 1.1 reads all three of those
words as booleans, and a reader that resolved them that way would produce a
model that is silently wrong and looks right.
