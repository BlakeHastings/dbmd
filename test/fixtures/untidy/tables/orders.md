---
table: orders
kind: table
layout:
  y: 120
  x: 480
group: 'billing'
columns:
    - type: 'text'
      name: 'status'
      default: "'pending'"
      null: false
    - name: id
      pk: true
      type: 'uuid'
indexes:
  - columns:
      - customer_id
      - status
    name: orders_customer_status_idx
---

This whole file is CRLF, frontmatter and body alike. The frontmatter becomes LF
on the first save because the model does not record line endings; the body keeps
its carriage returns forever because it is opaque.
