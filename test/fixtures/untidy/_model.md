---
engine:   postgres
name: 'shop'
kind: model
---

Every file under `untidy/` parses, and not one of them is canonical. Key order,
indentation, quoting style and line endings are all wrong in a different way in
each file, which is what makes it the fixture for "normalises once, then never
moves".
