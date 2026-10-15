import { tokenize as graphql } from "@twinkleplop/graphql";
import { tokenize as sql } from "@twinkleplop/sql";
import { Terminal } from "@xterm/headless";
import { PassThrough, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { readMultiline } from "../src/index.js";
import { createTwinkleplopHighlight } from "./twinkleplop-highlight.ts";

describe.each([
  { language: "SQL", tokenize: sql, source: "SELECT id, COUNT(*) FROM users WHERE active = true;" },
  {
    language: "GraphQL",
    tokenize: graphql,
    source: "query User($id: ID!) { user(id: $id) { name } }",
  },
])("Twinkleplop $language ANSI adapter", ({ tokenize, source }) => {
  const highlight = createTwinkleplopHighlight(tokenize());

  it("colors syntax without changing the submitted text", () => {
    const rendered = highlight(source);
    expect(rendered).toContain("\x1b[34m");
    expect(stripVTControlCharacters(rendered)).toBe(source);
    expect(rendered.endsWith("\x1b[0m")).toBe(true);
  });

  it.each([
    "",
    "   ",
    "\t 日本語 😀  ",
    "  'unfinished",
    '  "unfinished',
    "/* unfinished",
    '"""unfinished',
  ])("preserves whitespace, Unicode and incomplete input: %j", (line) => {
    expect(stripVTControlCharacters(highlight(line))).toBe(line);
  });

  it("does not carry state from another line or a previous edit", () => {
    const expected = highlight(source);
    highlight('/* """');
    expect(highlight(source)).toBe(expected);
  });

  it("renders colored pasted input, undo and redo in a terminal and submits plain text", async () => {
    const terminal = new Terminal({
      cols: 100,
      rows: 24,
      convertEol: true,
      allowProposedApi: true,
    });
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
    const output = Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          terminal.write(chunk.toString());
          done();
        },
      }),
      { columns: 100 },
    );
    const send = (text: string) => input.emit("data", Buffer.from(text));
    const flush = () => new Promise<void>((resolve) => terminal.write("", resolve));
    const text = source + "\n  日本語  ";
    const result = readMultiline("", {
      input,
      output,
      prefix: "",
      linePrefix: "",
      highlight,
      helpFooter: false,
    });
    try {
      send("\x1b[200~" + text + "\x1b[201~");
      await flush();
      expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(source);
      expect(terminal.buffer.active.getLine(0)?.getCell(0)?.getFgColor()).toBe(4);
      expect(terminal.buffer.active.cursorX).toBe(10);
      send("\x1a");
      await flush();
      expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("");
      send("\x19");
      await flush();
      expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(source);
      send("\r");
      expect(await result).toEqual([text, null]);
    } finally {
      send("\x03");
      await result;
      terminal.dispose();
      input.destroy();
      output.destroy();
    }
  });
});

describe.each([
  { name: "SQL block comment", tokenize: sql, text: "/*\nbody\n*/\nSELECT 1", color: 8 },
  {
    name: "GraphQL block string",
    tokenize: graphql,
    text: 'query { field(arg: """\nbody\n""") }\nquery { id }',
    color: 2,
  },
])("$name", ({ tokenize, text, color }) => {
  const highlight = createTwinkleplopHighlight(tokenize());

  it("preserves the document and resets each colored line", () => {
    const rendered = highlight(text);
    expect(stripVTControlCharacters(rendered)).toBe(text);
    const lines = rendered.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`\x1b[${color === 8 ? 90 : 32}mbody\x1b[0m`);
  });

  it("recolors later lines after delimiter edits, paste, undo, redo and history", async () => {
    const terminal = new Terminal({ cols: 80, rows: 24, convertEol: true, allowProposedApi: true });
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
    const output = Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          terminal.write(chunk.toString());
          done();
        },
      }),
      { columns: 80 },
    );
    const send = (value: string) => input.emit("data", Buffer.from(value));
    const flush = () => new Promise<void>((resolve) => terminal.write("", resolve));
    const bodyColor = () => terminal.buffer.active.getLine(1)?.getCell(2)?.getFgColor();
    const result = readMultiline("", {
      input,
      output,
      prefix: "",
      linePrefix: "| ",
      helpFooter: false,
      history: [text],
      highlightLines: (lines) => highlight(lines.join("\n")).split("\n"),
      theme: { submitRender: "preserve" },
    });
    try {
      send("\x1b[200~" + text + "\x1b[201~");
      await flush();
      expect(bodyColor()).toBe(color);
      expect(terminal.buffer.active.getLine(1)?.getCell(0)?.isFgDefault()).toBe(true);
      send("\x1b[1;9A");
      send("\x0b");
      await flush();
      expect(bodyColor()).not.toBe(color);
      send("\x1a");
      await flush();
      expect(bodyColor()).toBe(color);
      send("\x19");
      await flush();
      expect(bodyColor()).not.toBe(color);
      send("\x1b[5~");
      await flush();
      expect(bodyColor()).toBe(color);
      send("\r");
      expect(await result).toEqual([text, null]);
      await flush();
      expect(bodyColor()).toBe(color);
    } finally {
      send("\x03");
      await result;
      terminal.dispose();
      input.destroy();
      output.destroy();
    }
  });
});

it("preserves gaps and unrecognized token categories", () => {
  const highlight = createTwinkleplopHighlight(() => ({
    token_types: ["future-category"],
    tokens: new Uint32Array([0, 2, 5]),
  }));
  expect(highlight("  abc  ")).toBe("  abc  ");
});
