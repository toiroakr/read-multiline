# @toiroakr/read-multiline

## 0.4.1

### Patch Changes

- 79ab4dc: Fix cursor reflow on soft-wrapped lines across editing, deletion, and history
  navigation. Previously, several internal rendering paths assumed logical-row
  math even after a line wrapped across multiple visual rows, which caused the
  cursor to land on the wrong row when editing wrapped content, deleting through
  a wrap boundary, or replaying history entries whose earlier lines wrap. The
  underlying cursor-rewind primitive now accounts for soft-wrap reflow, and the
  LEFT/RIGHT navigation no longer emits a stray column move at the deferred-wrap
  edge.

## 0.4.0

### Minor Changes

- d6ac10c: Skip persisting empty submissions (`""`) to the history file by default. Previously
  a bare Enter produced a `""` entry on disk when `history.filePath` was set; now that
  entry is dropped unless the caller opts back in by providing their own `shouldPersist`
  callback (e.g. `shouldPersist: () => true`). Whitespace-only submissions are still
  persisted by default. Pass a custom predicate such as `(value) => value.trim() !== ""`
  to trim them as well.

### Patch Changes

- f735375: Apply the `highlight` callback when navigating history. Previously, loading
  a history entry (via Up/Down, Alt+Up/Down, Ctrl+P/N, or PageUp/PageDown) drew
  the content with `styledInput` only, bypassing the user-supplied `highlight`
  function. History content now renders through the same `renderLine` path as
  other draws, so syntax highlighting is preserved after switching entries.

## 0.3.2

### Patch Changes

- 5ecd285: Harden persistent history: add `shouldPersist` predicate and make file writes atomic

  - Add `HistoryOptions.shouldPersist?: (value: string) => boolean` so callers can opt submitted values out of the on-disk history (e.g. REPL meta commands, empty inputs) without losing the ability to accept them in `validate`.
  - Rewrite the persistence path as a read-modify-write using a sibling temp file plus `fs.rename`. Concurrent sessions that appended entries after this session started are now merged in instead of being clobbered, and readers never observe a partially written JSON document.

## 0.3.1

### Patch Changes

- e484633: Add `inlinePrompt` option to render the prompt header and the first input line on the same terminal line

  - New `inlinePrompt: boolean` option on `readMultiline`. When enabled, the prompt header (prefix + prompt) and the first input line share a single terminal line; subsequent lines still use the configured `linePrefix`.
  - Combine with a `Stateful` `prefix` and `theme.submitRender: "preserve"` to transition the prefix on submit (e.g. `"> "` → `"✔ "`).
  - Throws at call time if `inlinePrompt` is combined with a multi-line prompt header (`prefix` or `prompt` containing a newline); the option assumes a single-line header.
  - See `examples/inline-prompt.ts` for a runnable demo.

## 0.3.0

### Minor Changes

- 1416098: Extend submitRender/cancelRender with "ellipsis" and number modes to control how many input lines are displayed after submission or cancellation

### Patch Changes

- 22a4b48: Add explicit node types to tsconfig.json for TypeScript 6 compatibility
- d25b761: Add `highlight` and `transform` options to readMultiline

  - `highlight`: per-line syntax highlighting callback returning ANSI-decorated strings. Takes precedence over `theme.input` styling. Preserved across all edit operations (insert, backspace, delete). Skipped during paste for performance.
  - `transform`: post-edit state transformation callback (e.g., auto-close brackets, auto-indent). Receives `TransformState` and `TransformEvent`, returns modified state or `undefined`. Skipped during paste. Results validated with row/col clamping.
  - Export `TransformState` and `TransformEvent` types for consumer use.

## 0.2.1

### Patch Changes

- 8a6ad41: Fix Ctrl+J not inserting newline in terminals with kitty keyboard protocol support
- 73f3319: Use Node 24 in release workflow for npm trusted publishing support (requires npm >= 11.5.1)

## 0.2.0

### Minor Changes

- 110bfbe: Add `footer` option to display fixed text below the editor (e.g. help text). The footer appears below the status/error line and persists throughout the editing session.
- 317c248: Split single-file implementation into focused modules for improved maintainability. Fix onCancel to resolve the promise with current input content instead of leaving it pending. Reduce terminal flicker during screen redraw with output buffering and in-place rendering.

## 0.1.2

### Patch Changes

- 18050be: Require cursor at line boundary before history navigation. Up at first line moves cursor to start first; Down at last line moves cursor to end first.
- c6e4ec7: Migrate package manager from npm to pnpm

## 0.1.1

### Patch Changes

- c2a19f8: Add pkg-pr-new preview workflow for publishing preview packages on pull requests
- ba43b6a: Change Ctrl+D behavior with existing input from submit to delete-char (matching readline/shell conventions). Add `onCancel` option to allow custom Ctrl+C handling instead of throwing CancelError.
