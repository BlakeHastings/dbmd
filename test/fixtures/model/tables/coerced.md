---
kind: table
table: coerced
columns:
  - name: id
    type: uuid
    pk: true
  - name: null
    type: text
  - name: flag
    type: true
  - name: created_at
    type: timestamptz
    default: 0
    unqiue: true
---

Every column below `id` is a way of writing something YAML resolves to a value
that is not a string. Each one is a diagnostic rather than a coercion.
