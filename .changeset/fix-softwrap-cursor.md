---
"@toiroakr/read-multiline": patch
---

Fix cursor reflow on soft-wrapped lines across editing, deletion, and history
navigation. Previously, several internal rendering paths assumed logical-row
math even after a line wrapped across multiple visual rows, which caused the
cursor to land on the wrong row when editing wrapped content, deleting through
a wrap boundary, or replaying history entries whose earlier lines wrap. The
underlying cursor-rewind primitive now accounts for soft-wrap reflow, and the
LEFT/RIGHT navigation no longer emits a stray column move at the deferred-wrap
edge.
