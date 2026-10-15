import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

type Highlight = (line: string) => string;
type Language = "sql" | "graphql";
type Provider = "twinkleplop" | "shiki" | "sql-highlight";

const sources = {
  sql: "SELECT id, COUNT(*) FROM users WHERE active = true;",
  graphql: "query User($id: ID!) { user(id: $id) { name } }",
};

async function createHighlight(provider: Provider, lang: Language): Promise<Highlight> {
  if (provider === "twinkleplop") {
    const { createTwinkleplopHighlight } = await import("./twinkleplop-highlight.ts");
    const { tokenize } =
      lang === "sql" ? await import("@twinkleplop/sql") : await import("@twinkleplop/graphql");
    return createTwinkleplopHighlight(tokenize());
  }
  if (provider === "sql-highlight") {
    const { getSegments } = await import("sql-highlight");
    const colors: Record<string, string> = {
      keyword: "\x1b[34m",
      function: "\x1b[35m",
      identifier: "\x1b[33m",
      string: "\x1b[92m",
      number: "\x1b[36m",
      bracket: "\x1b[2;33m",
      special: "\x1b[90m",
    };
    return (line) => {
      let result = "";
      for (const segment of getSegments(line)) {
        const color = colors[segment.name];
        result += color ? color + segment.content + "\x1b[0m" : segment.content;
      }
      return result;
    };
  }
  const { createHighlighter } = await import("shiki");
  const highlighter = await createHighlighter({ themes: ["nord"], langs: [lang] });
  return (line) => {
    const tokens = highlighter.codeToTokensBase(line, { lang, theme: "nord" });
    let result = "";
    for (const token of tokens[0] ?? []) {
      let prefix = "";
      if (token.color) {
        const n = parseInt(token.color.replace("#", "").slice(0, 6), 16);
        prefix += `\x1b[38;2;${(n >> 16) & 0xff};${(n >> 8) & 0xff};${n & 0xff}m`;
      }
      if (token.fontStyle) {
        if (token.fontStyle & 1) prefix += "\x1b[3m";
        if (token.fontStyle & 2) prefix += "\x1b[1m";
      }
      result += prefix + token.content + "\x1b[0m";
    }
    return result;
  };
}

function scenarios(lang: Language): Record<string, string[]> {
  const source = sources[lang];
  return {
    line: [source],
    redraw100: Array.from({ length: 100 }, (_, i) => source.replace(/id/g, `id${i}`)),
    typing: Array.from({ length: source.length }, (_, i) => source.slice(0, i + 1)),
  };
}

function measure(highlight: Highlight, lines: string[]): number {
  for (const line of lines) {
    const output = highlight(line);
    assert.equal(stripVTControlCharacters(output), line);
    assert.notEqual(output, line);
  }
  let checksum = 0;
  const run = () => {
    for (const line of lines) checksum += highlight(line).length;
  };
  for (let i = 0; i < 100; i++) run();
  let iterations = 0;
  const start = performance.now();
  let elapsed: number;
  do {
    for (let i = 0; i < 10; i++) run();
    iterations += 10;
    elapsed = performance.now() - start;
  } while (elapsed < 100);
  assert(checksum > 0);
  return (elapsed * 1000) / iterations;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const [, , mode, providerArg, langArg] = process.argv;
if (mode === "--worker") {
  assert(["twinkleplop", "shiki", "sql-highlight"].includes(providerArg));
  assert(langArg === "sql" || langArg === "graphql");
  const provider = providerArg as Provider;
  const lang = langArg as Language;
  assert(provider !== "sql-highlight" || lang === "sql");
  const start = performance.now();
  const highlight = await createHighlight(provider, lang);
  const initialized = performance.now();
  const output = highlight(sources[lang]);
  const firstRendered = performance.now();
  assert.equal(stripVTControlCharacters(output), sources[lang]);
  const rssMiB = process.memoryUsage().rss / 1024 ** 2;
  const timings = Object.fromEntries(
    Object.entries(scenarios(lang)).map(([name, lines]) => [name, measure(highlight, lines)]),
  );
  process.stdout.write(
    JSON.stringify({
      setupMs: initialized - start,
      firstRenderMs: firstRendered - initialized,
      readyMs: firstRendered - start,
      rssMiB,
      timings,
    }),
  );
} else {
  assert(mode === undefined, "Usage: node examples/benchmark-highlighting.ts");
  const cases: { provider: Provider; lang: Language }[] = [
    { provider: "twinkleplop", lang: "sql" },
    { provider: "shiki", lang: "sql" },
    { provider: "sql-highlight", lang: "sql" },
    { provider: "twinkleplop", lang: "graphql" },
    { provider: "shiki", lang: "graphql" },
  ];
  const results = cases.map((entry) => ({
    ...entry,
    samples: [] as {
      setupMs: number;
      firstRenderMs: number;
      readyMs: number;
      rssMiB: number;
      timings: Record<string, number>;
    }[],
  }));
  for (let round = 0; round < 5; round++) {
    for (let offset = 0; offset < cases.length; offset++) {
      const entry = results[(round + offset) % cases.length];
      const output = execFileSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "--worker", entry.provider, entry.lang],
        { encoding: "utf8", timeout: 60_000 },
      );
      entry.samples.push(JSON.parse(output));
    }
    process.stderr.write(`Completed round ${round + 1}/5\n`);
  }
  const versions = Object.fromEntries(
    ["@twinkleplop/sql", "@twinkleplop/graphql", "shiki", "sql-highlight"].map((name) => [
      name,
      JSON.parse(
        readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8"),
      ).version,
    ]),
  );
  console.log(
    JSON.stringify(
      {
        environment: {
          date: new Date().toISOString(),
          node: process.version,
          os: `${platform()} ${release()} ${arch()}`,
          cpu: cpus()[0].model,
          versions,
        },
        method:
          "5 fresh processes per provider/language, rotating order; 100 warmup iterations and >=100ms per scenario; no terminal I/O; startup excludes Node startup and uses warm filesystem cache",
        scenarios: Object.fromEntries(
          Object.entries(sources).map(([lang]) => [
            lang,
            Object.fromEntries(
              Object.entries(scenarios(lang as Language)).map(([name, lines]) => [
                name,
                { lines: lines.length, characters: lines.reduce((n, line) => n + line.length, 0) },
              ]),
            ),
          ]),
        ),
        results: results.map((entry) => ({
          provider: entry.provider,
          language: entry.lang,
          median: {
            readyMs: median(entry.samples.map((s) => s.readyMs)),
            rssMiB: median(entry.samples.map((s) => s.rssMiB)),
            microseconds: Object.fromEntries(
              Object.keys(entry.samples[0].timings).map((name) => [
                name,
                median(entry.samples.map((s) => s.timings[name])),
              ]),
            ),
          },
          samples: entry.samples,
        })),
      },
      null,
      2,
    ),
  );
}
