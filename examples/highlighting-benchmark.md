# Optional syntax highlighting: benchmark

Twinkleplop can supply SQL and GraphQL tokens to `readMultiline` through the
existing line-based `highlight` callback. No changes to the core API or runtime
dependencies are needed. These results compare tokenization plus ANSI string
construction, rather than HTML output or tokenizer-only performance.

## Reproduce

From the repository root with Node.js 24 (native TypeScript stripping):

```bash
pnpm install --frozen-lockfile
node examples/benchmark-highlighting.ts > highlighting-results.json
```

The JSON includes environment details, exact installed versions, each sample, and
medians. Progress goes to stderr. [Recorded raw results](highlighting-benchmark.json)
are included for this run.

## Recorded results

Measured on 2026-10-15, Apple M3, macOS (Darwin 25.6.0 arm64), Node.js v24.13.0.
Versions: `@twinkleplop/sql` 0.1.7, `@twinkleplop/graphql` 0.2.1 (both use
`@twinkleplop/core` 0.3.1), Shiki 4.5.0, sql-highlight 6.1.0.

All values below are medians of five fresh processes per provider/language.

| Language | Provider      | Import → first ANSI (ms) | One line (µs) | 100 lines (ms) | Typing sequence (ms) | Process RSS (MiB) |
| -------- | ------------- | -----------------------: | ------------: | -------------: | -------------------: | ----------------: |
| sql      | twinkleplop   |                    41.96 |          3.55 |          0.532 |                0.108 |              78.2 |
| sql      | shiki         |                   459.97 |        574.07 |         22.740 |                8.031 |             102.9 |
| sql      | sql-highlight |                     9.43 |         15.39 |          1.564 |                0.460 |              76.1 |
| graphql  | twinkleplop   |                    19.60 |          2.23 |          0.358 |                0.082 |              78.3 |
| graphql  | shiki         |                   224.24 |         59.10 |          4.587 |                1.113 |             107.9 |

Twinkleplop spends less time generating ANSI in these fixtures than Shiki and
sql-highlight. sql-highlight starts faster for SQL. This supports trying
Twinkleplop as an optional highlighter; it does not establish a universal speedup
or a difference in perceived typing latency.

## What is measured

- Startup: dynamic import, factory creation, and the first complete ANSI string
  in a fresh Node process. Node startup and loading this benchmark are excluded.
  The OS filesystem cache is warm; this is not a cold-disk measurement. Twinkleplop
  includes loading the TypeScript ANSI adapter; Shiki includes one language, the
  Nord theme, and its default regex engine.
- Steady state: 100 untimed scenario iterations, then batches of 10 iterations
  for at least 100ms. Providers rotate order across five rounds. The table reports
  the median per-scenario average, not a per-keystroke percentile.
- One line: the 51-character SQL or 47-character GraphQL fixture below.
- 100 lines: 100 independent calls, changing every `id` to `id0` through `id99`.
  Total source length is 5,290 characters for SQL and 5,270 for GraphQL.
- Typing: highlight every prefix, from the first character through the complete
  fixture (51 SQL calls or 47 GraphQL calls). This is the time for the entire
  simulated sequence, not one keystroke.
- Memory: total process RSS immediately after the first ANSI string, before
  warmup. This includes Node and the benchmark; it is not the library's allocation
  size or peak memory usage.

```sql
SELECT id, COUNT(*) FROM users WHERE active = true;
```

```graphql
query User($id: ID!) {
  user(id: $id) {
    name
  }
}
```

Before timing each scenario, the script verifies that every output contains ANSI
styling and that stripping ANSI recovers the exact input. Output lengths are
consumed during timing. The SQL baseline follows `sql-editor.ts`'s segment loop;
the Shiki baseline follows `shiki-highlight.ts`'s token-to-true-color conversion.
Palettes and token classifications differ, so the strings are not byte-identical.

## Limits

These are small synthetic fixtures on a shared developer machine. Individual
samples vary; consult the raw JSON before relying on a ratio. Terminal writes,
cursor management, input decoding, and screen painting are excluded. A measured
highlighter speedup is not an end-to-end editor speedup. Neither correctness nor
performance across all SQL dialects or GraphQL documents is established here.

All providers are reset for each line, matching the current callback and Shiki
example. Multi-line SQL block comments and GraphQL block strings lose their
context between lines; contextual classification such as GraphQL argument names
can also differ across lines. The adapter handles incomplete text without
requiring a valid document, but provides no syntax validation or auto-editing.
Whole-document highlighting would require a separate API/rendering change.

Twinkleplop's built-in themes target CSS. This example maps token categories to
ANSI colors directly, preserves unclassified gaps and Unicode, and resets color
after each styled token. It is an example adapter copied by consumers, not an
export of `@toiroakr/read-multiline`.
