---
"@toiroakr/read-multiline": minor
---

Skip persisting empty submissions (`""`) to the history file by default. Previously
a bare Enter produced a `""` entry on disk when `history.filePath` was set; now that
entry is dropped unless the caller opts back in by providing their own `shouldPersist`
callback (e.g. `shouldPersist: () => true`). Whitespace-only submissions are still
persisted by default. Pass a custom predicate such as `(value) => value.trim() !== ""`
to trim them as well.
