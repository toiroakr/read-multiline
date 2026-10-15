# Full-document syntax highlighting: benchmark

`highlightLines` accepts all logical input lines and returns an ANSI string for
each one. The Twinkleplop SQL/GraphQL example tokenizes the complete buffer once
per redraw, retaining comments, block strings and context across line boundaries.
The core package still has zero runtime dependencies.

## Reproduce

From the repository root with Node.js 24 (native TypeScript stripping):

```bash
pnpm install --frozen-lockfile
node examples/benchmark-highlighting.ts > highlighting-results.json
```

Progress goes to stderr. The JSON contains exact installed versions, input sizes,
each sample, and medians. [Recorded raw results](highlighting-benchmark.json) are
included for this run.

## Recorded results

Measured on 2026-10-15, Apple M3, macOS (Darwin 25.6.0 arm64), Node.js v24.13.0.
Versions: `@twinkleplop/sql` 0.1.7, `@twinkleplop/graphql` 0.2.1 (both use
`@twinkleplop/core` 0.3.1), Shiki 4.5.0, sql-highlight 6.1.0.

Other compilation and desktop workloads were active. Wall times vary substantially;
CPU time is recorded alongside wall time to distinguish process work from elapsed
time. CPU time is not a typing-latency measurement and can still vary with JIT, GC,
CPU frequency, and memory pressure. These fixtures do not establish a universal
speedup. All values are medians of five fresh processes per provider/language.

| Language | Provider      | One-line CPU (µs) | 100-line document CPU (ms) | 100-line document wall (ms) |
| -------- | ------------- | ----------------: | -------------------------: | --------------------------: |
| sql      | twinkleplop   |              5.78 |                      0.340 |                       3.453 |
| sql      | shiki         |            615.80 |                     30.363 |                     139.507 |
| sql      | sql-highlight |             13.19 |                      1.267 |                       2.904 |
| graphql  | twinkleplop   |              4.62 |                      0.346 |                       0.679 |
| graphql  | shiki         |            178.26 |                      6.134 |                      12.781 |

Startup includes dynamic import, factory creation, and the first complete ANSI
string, but excludes Node startup and loading the benchmark itself. The filesystem
cache is warm. Twinkleplop includes loading the TypeScript ANSI adapter. Shiki
includes one language, the Nord theme, and its default regex engine.

| Language | Provider      | Startup CPU (ms) | Startup wall (ms) | Process RSS (MiB) |
| -------- | ------------- | ---------------: | ----------------: | ----------------: |
| sql      | twinkleplop   |            24.23 |             77.90 |              74.9 |
| sql      | shiki         |           254.77 |            760.99 |             105.4 |
| sql      | sql-highlight |            10.90 |             22.24 |              75.8 |
| graphql  | twinkleplop   |            21.94 |             52.75 |              77.0 |
| graphql  | shiki         |           216.18 |           1040.42 |              96.1 |

RSS is measured immediately after the first render and before warmup. It includes
Node and the benchmark, rather than library-only allocation or peak memory.

## Scenarios and method

Each scenario warms up for at least 100ms, then runs batches of 10 iterations for
at least 100ms. Providers rotate order across five rounds. `performance.now()`
records elapsed time and `process.cpuUsage()` records user plus system CPU time
for the process. Reported times are per-scenario averages; medians are taken across
the five processes. They are not per-keystroke percentiles.

- `line`: one call for the 51-character SQL or 47-character GraphQL fixture below.
- `document100`: 100 copies with every `id` changed to `id0` through `id99`, joined
  with newlines and highlighted in one call. Total size including 99 newlines is
  5,389 characters for SQL and 5,369 for GraphQL.
- `redraw100`: those same lines highlighted independently, for comparison with the
  legacy `highlight` callback. The example itself now uses `highlightLines`.
- `multiline`: one full SQL block comment followed by a statement, or a GraphQL
  query containing a block string. Exact fixtures are in the benchmark script.
- `typing`: every prefix of the single-line fixture, simulating 51 SQL or 47
  GraphQL edits. The time covers the whole sequence, not a single keystroke.

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

Before timing, every output is checked for ANSI styling and exact preservation of
its input after stripping ANSI. Output lengths are consumed during measurement.
All providers include tokenization plus ANSI construction, rather than HTML output
or tokenizer-only work. The SQL baseline uses the segment loop from `sql-editor.ts`;
Shiki converts its token colors to ANSI, including all token lines for document
scenarios. Palettes and token classifications differ; strings are not byte-identical.

## Scope and tradeoffs

Terminal I/O, input decoding, cursor management, snapshot copying, and screen
painting are excluded. These are small synthetic fixtures on a busy developer
machine. A highlighter speedup is not an end-to-end editor speedup; consult raw
samples before relying on a ratio. Neither correctness nor performance across all
SQL dialects and GraphQL documents is established here.

`highlightLines` redraws the complete buffer after each edit because changing a
later token can also recolor earlier lines. Its result is reused for every line in
that redraw, and bracketed paste is highlighted after completion. Full-buffer
parsing and repainting cost grows with input size. The existing `highlight` callback
retains its line-based behavior for consumers that do not need cross-line context.

The Twinkleplop adapter resets ANSI styling at each line boundary inside multiline
tokens, so line prefixes and footers retain their own colors. It preserves all
source text and accepts incomplete input, but adds no validation or auto-editing.
The adapter remains an example copied by consumers, not a core package export.
