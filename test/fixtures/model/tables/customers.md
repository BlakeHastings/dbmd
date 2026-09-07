---
kind: table
table: customers
columns:
  - name: id
    type: uuid
    pk: true
  - name: email
    type: citext
    nullable: false
  - name: "null"
    type: boolean
    nullable: false
    default: 'false'
layout: { x: 120, y: 120 }
---

Imported from the old billing system in 2019, which is where the column named
`null` came from. Nobody has dared rename it because the reporting views spell
it out.

The import ran as:

```sql
COPY customers FROM STDIN WITH (FORMAT csv);
---
-- three dashes above, on purpose: the body is opaque and this must not be
-- mistaken for a frontmatter delimiter
```

Everything after the closing delimiter is the body, so the fence and its dashes
survive unchanged.
