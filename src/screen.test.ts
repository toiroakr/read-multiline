import { Terminal } from "@xterm/headless";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMultiline, type TTYInput } from "./index.js";

// Virtual terminal that feeds ANSI output into @xterm/headless
function createVirtualTerminal(cols = 80, rows = 24) {
  const term = new Terminal({
    cols,
    rows,
    allowProposedApi: true,
    convertEol: true,
  });
  const stream = {
    columns: cols,
    write(data: string) {
      term.write(data);
      return true;
    },
  } as NodeJS.WritableStream;
  return { term, stream };
}

function createTTYInput(): TTYInput & EventEmitter & { send: (data: string) => void } {
  const emitter = new EventEmitter() as TTYInput & EventEmitter & { send: (data: string) => void };
  emitter.isTTY = true;
  emitter.setRawMode = vi.fn();
  emitter.resume = vi.fn();
  emitter.pause = vi.fn();
  emitter.read = vi.fn();
  emitter.send = (data: string) => {
    emitter.emit("data", Buffer.from(data));
  };
  return emitter;
}

// Wait for xterm to flush its write queue
function flush(term: Terminal): Promise<void> {
  return new Promise((resolve) => term.write("", resolve));
}

// Read a screen line, trimming trailing whitespace
// translateToString(true) trims empty cells but not explicitly written spaces,
// so we also trim trailing spaces from the result.
function screenLine(term: Terminal, row: number): string {
  return (term.buffer.active.getLine(row)?.translateToString(true) ?? "").trimEnd();
}

function rawScreenLine(term: Terminal, row: number): string {
  return term.buffer.active.getLine(row)?.translateToString(false) ?? "";
}

function isWrappedRow(term: Terminal, row: number): boolean {
  return term.buffer.active.getLine(row)?.isWrapped ?? false;
}

function cursorPos(term: Terminal) {
  return { x: term.buffer.active.cursorX, y: term.buffer.active.cursorY };
}

const KEY = {
  ENTER: "\r",
  SHIFT_ENTER: "\x1b[13;2u",
  BACKSPACE: "\x7f",
  DELETE: "\x1b[3~",
  CTRL_C: "\x03",
  CTRL_W: "\x17",
  CTRL_U: "\x15",
  CTRL_K: "\x0b",
  CTRL_L: "\x0c",
  CTRL_Z: "\x1a",
  CTRL_Y: "\x19",
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  RIGHT: "\x1b[C",
  LEFT: "\x1b[D",
  ALT_LEFT: "\x1b[1;3D",
  ALT_RIGHT: "\x1b[1;3C",
  CMD_LEFT: "\x1b[1;9D",
  CMD_RIGHT: "\x1b[1;9C",
  CMD_UP: "\x1b[1;9A",
  CMD_DOWN: "\x1b[1;9B",
  HOME: "\x1b[H",
  END: "\x1b[F",
};

describe("Screen rendering (virtual terminal)", () => {
  let input: ReturnType<typeof createTTYInput>;
  let vt: ReturnType<typeof createVirtualTerminal>;

  beforeEach(() => {
    input = createTTYInput();
    vt = createVirtualTerminal();
  });

  afterEach(() => {
    vt.term.dispose();
  });

  // --- Basic rendering ---
  // New layout: prompt header on line 0 (prefix + prompt), input lines below with linePrefix

  it("displays prefix header and typed text", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix: "> ", linePrefix: "> "
    });
    input.send("hello");
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe(">"); // prompt header (prefix only, trimmed)
    expect(screenLine(vt.term, 1)).toBe("> hello"); // linePrefix + text
    expect(cursorPos(vt.term)).toEqual({ x: 7, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("displays continuation lines with linePrefix", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("line1");
    input.send(KEY.SHIFT_ENTER);
    input.send("line2");
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe(">"); // prompt header
    expect(screenLine(vt.term, 1)).toBe("  line1");
    expect(screenLine(vt.term, 2)).toBe("  line2");
    expect(cursorPos(vt.term)).toEqual({ x: 7, y: 2 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("displays three lines correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("aaa");
    input.send(KEY.SHIFT_ENTER);
    input.send("bbb");
    input.send(KEY.SHIFT_ENTER);
    input.send("ccc");
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe(">"); // prompt header
    expect(screenLine(vt.term, 1)).toBe("  aaa");
    expect(screenLine(vt.term, 2)).toBe("  bbb");
    expect(screenLine(vt.term, 3)).toBe("  ccc");
    expect(cursorPos(vt.term)).toEqual({ x: 5, y: 3 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Cursor position after movement ---

  it("cursor moves left correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("abc");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    await flush(vt.term);

    // cursor should be on 'b': linePrefix(2) + 1 = col 3 (0-based), row 1
    expect(cursorPos(vt.term)).toEqual({ x: 3, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("cursor moves to previous line end on Left at line start", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send("cd");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // line 2 start
    input.send(KEY.LEFT); // line 1 end
    await flush(vt.term);

    // cursor at line 0, after "ab": linePrefix(2) + 2 = col 4, row 1
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("cursor moves between lines with Up/Down", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("abcde");
    input.send(KEY.SHIFT_ENTER);
    input.send("fg");
    await flush(vt.term);
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 2 }); // "  fg|", row 2

    input.send(KEY.UP);
    await flush(vt.term);
    // col clamped to min(2, 5) = 2, so linePrefix(2) + 2 = 4, row 1
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 1 });

    input.send(KEY.DOWN);
    await flush(vt.term);
    // col clamped to min(2, 2) = 2, so linePrefix(2) + 2 = 4, row 2
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 2 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("cursor moves up from a wrapped second line using visual row deltas", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("abcdefghijk");
    input.send(KEY.SHIFT_ENTER);
    input.send("xy");
    await flush(vt.term);

    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 3 });

    input.send(KEY.UP);
    await flush(vt.term);

    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Insert at cursor position ---

  it("inserts character at cursor mid-position and redraws correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("ac");
    input.send(KEY.LEFT); // a|c
    input.send("b"); // ab|c
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abc");
    // cursor after 'b': linePrefix(2) + 2 = 4, row 1
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Backspace rendering ---

  it("backspace at end redraws correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("abc");
    input.send(KEY.BACKSPACE);
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> ab");
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("backspace at mid-position redraws without artifacts", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("abcd");
    input.send(KEY.LEFT); // abc|d
    input.send(KEY.BACKSPACE); // ab|d
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abd");
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("backspace merging lines redraws correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send("cd");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // line 2 start
    input.send(KEY.BACKSPACE); // merge: "abcd" on line 0
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("  abcd");
    expect(screenLine(vt.term, 2)).toBe(""); // cleared
    // cursor after "ab": linePrefix(2) + 2 = 4, row 1
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Ctrl+W rendering ---

  it("Ctrl+W redraws without artifacts", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("hello world");
    input.send(KEY.CTRL_W); // delete "world"
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> hello");
    // cursor after "hello ": linePrefix(2) + 6 = 8, row 1
    expect(cursorPos(vt.term)).toEqual({ x: 8, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Full-width character rendering ---

  it("full-width characters occupy 2 columns on screen", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("\u3042\u3044"); // あい (each 2 cols)
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> \u3042\u3044");
    // linePrefix(2) + 2*2 = 6
    expect(cursorPos(vt.term)).toEqual({ x: 6, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("cursor position correct after Left on full-width character", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("\u3042\u3044\u3046"); // あいう
    input.send(KEY.LEFT); // あい|う
    await flush(vt.term);

    // linePrefix(2) + 2*2 = 6
    expect(cursorPos(vt.term)).toEqual({ x: 6, y: 1 });

    input.send(KEY.LEFT); // あ|いう
    await flush(vt.term);
    // linePrefix(2) + 2 = 4
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("backspace on full-width character clears 2 columns", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("a\u3042b"); // a + あ(2cols) + b
    input.send(KEY.LEFT); // a あ |b
    input.send(KEY.BACKSPACE); // delete あ -> "ab"
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> ab");
    // linePrefix(2) + 1 = 3
    expect(cursorPos(vt.term)).toEqual({ x: 3, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("full-width insert at mid-position redraws correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("\u3042\u3046"); // あう
    input.send(KEY.LEFT); // あ|う
    input.send("\u3044"); // あい|う
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> \u3042\u3044\u3046");
    // linePrefix(2) + 2+2 = 6
    expect(cursorPos(vt.term)).toEqual({ x: 6, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("mixed half-width and full-width cursor tracking", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("a\u3042b\u3044c"); // a(1) + あ(2) + b(1) + い(2) + c(1) = 7 cols
    await flush(vt.term);
    // linePrefix(2) + 7 = 9
    expect(cursorPos(vt.term)).toEqual({ x: 9, y: 1 });

    input.send(KEY.LEFT); // before c: 8
    input.send(KEY.LEFT); // before い: 6
    input.send(KEY.LEFT); // before b: 5
    await flush(vt.term);
    expect(cursorPos(vt.term)).toEqual({ x: 5, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Line splitting rendering ---

  it("Shift+Enter at mid-position splits line and redraws", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("abcd");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // ab|cd
    input.send(KEY.SHIFT_ENTER); // split: "ab" / "cd"
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("  ab");
    expect(screenLine(vt.term, 2)).toBe("  cd");
    // cursor at line 1, col 0: linePrefix(2) + 0 = 2, row 2
    expect(cursorPos(vt.term)).toEqual({ x: 2, y: 2 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("Shift+Enter after a soft-wrapped line does not duplicate the first line", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("abcdefghijk");
    await flush(vt.term);

    expect(rawScreenLine(vt.term, 1)).toBe("  abcdefghij");
    expect(rawScreenLine(vt.term, 2).trim()).toBe("k");
    expect(isWrappedRow(vt.term, 2)).toBe(true);
    expect(cursorPos(vt.term)).toEqual({ x: 1, y: 2 });

    input.send(KEY.SHIFT_ENTER);
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe(">");
    expect(rawScreenLine(vt.term, 1)).toBe("  abcdefghij");
    expect(rawScreenLine(vt.term, 2)).toContain("k");
    expect(rawScreenLine(vt.term, 3).trim()).toBe("");
    expect(cursorPos(vt.term)).toEqual({ x: 2, y: 3 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Word jump cursor position ---

  it("Alt+Left positions cursor at word start correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("hello world");
    input.send(KEY.ALT_LEFT); // jump to |world
    await flush(vt.term);

    // linePrefix(2) + 6("hello ") = 8
    expect(cursorPos(vt.term)).toEqual({ x: 8, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Home/End cursor position ---

  it("Home moves cursor to line start, End to line end", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("hello");
    input.send(KEY.HOME);
    await flush(vt.term);
    expect(cursorPos(vt.term)).toEqual({ x: 2, y: 1 }); // linePrefix(2)

    input.send(KEY.END);
    await flush(vt.term);
    expect(cursorPos(vt.term)).toEqual({ x: 7, y: 1 }); // linePrefix(2) + 5

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Cmd+Up/Down cursor position ---

  it("Cmd+Up/Down jumps to buffer start/end with correct cursor", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("abc");
    input.send(KEY.SHIFT_ENTER);
    input.send("def");
    input.send(KEY.CMD_UP); // buffer start
    await flush(vt.term);
    expect(cursorPos(vt.term)).toEqual({ x: 2, y: 1 }); // linePrefix(2) + 0, row 1

    input.send(KEY.CMD_DOWN); // buffer end
    await flush(vt.term);
    expect(cursorPos(vt.term)).toEqual({ x: 5, y: 2 }); // linePrefix(2) + 3, row 2

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Paste rendering ---

  it("multi-line paste renders all lines correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("\x1b[200~line1\nline2\nline3\x1b[201~");
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe(">"); // prompt header
    expect(screenLine(vt.term, 1)).toBe("  line1");
    expect(screenLine(vt.term, 2)).toBe("  line2");
    expect(screenLine(vt.term, 3)).toBe("  line3");
    expect(cursorPos(vt.term)).toEqual({ x: 7, y: 3 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("paste causing soft wrap on the second line does not duplicate the first line", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("top");
    input.send(KEY.SHIFT_ENTER);
    await flush(vt.term);

    input.send("\x1b[200~apple apple \x1b[201~");
    await flush(vt.term);

    const rows = Array.from({ length: 6 }, (_, row) => ({
      row,
      screen: screenLine(vt.term, row),
      raw: rawScreenLine(vt.term, row),
      wrapped: isWrappedRow(vt.term, row),
    }));

    expect(rows).toEqual([
      { row: 0, screen: ">", raw: ">           ", wrapped: false },
      { row: 1, screen: "  top", raw: "  top       ", wrapped: false },
      { row: 2, screen: "  apple appl", raw: "  apple appl", wrapped: false },
      { row: 3, screen: "e", raw: "e           ", wrapped: true },
      { row: 4, screen: "", raw: "            ", wrapped: false },
      { row: 5, screen: "", raw: "            ", wrapped: false },
    ]);
    expect(cursorPos(vt.term)).toEqual({ x: 2, y: 3 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("typing into a non-last line that wraps preserves the following line", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send("second");
    input.send(KEY.UP);
    await flush(vt.term);

    // Cursor is now at end of first line (logical row 0, col 2).
    // Typing characters here causes line 0 to soft-wrap; line 1 ("second")
    // must be pushed down rather than overwritten by the wrap continuation.
    input.send("cdefghijk");
    await flush(vt.term);

    const rows = Array.from({ length: 5 }, (_, row) => ({
      row,
      screen: screenLine(vt.term, row),
      raw: rawScreenLine(vt.term, row),
      wrapped: isWrappedRow(vt.term, row),
    }));

    expect(rows).toEqual([
      { row: 0, screen: ">", raw: ">           ", wrapped: false },
      { row: 1, screen: "  abcdefghij", raw: "  abcdefghij", wrapped: false },
      { row: 2, screen: "k", raw: "k           ", wrapped: true },
      { row: 3, screen: "  second", raw: "  second    ", wrapped: false },
      { row: 4, screen: "", raw: "            ", wrapped: false },
    ]);
    expect(cursorPos(vt.term)).toEqual({ x: 1, y: 2 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("typing into a soft wrap keeps the footer below the wrapped input", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      footer: "FOOT",
    });
    input.send("abcdefghijk");
    await flush(vt.term);

    const rows = Array.from({ length: 5 }, (_, row) => ({
      row,
      screen: screenLine(vt.term, row),
      raw: rawScreenLine(vt.term, row),
      wrapped: isWrappedRow(vt.term, row),
    }));

    expect(rows).toEqual([
      { row: 0, screen: ">", raw: ">           ", wrapped: false },
      { row: 1, screen: "> abcdefghij", raw: "> abcdefghij", wrapped: false },
      { row: 2, screen: "k", raw: "k           ", wrapped: true },
      { row: 3, screen: "FOOT", raw: "FOOT        ", wrapped: false },
      { row: 4, screen: "", raw: "            ", wrapped: false },
    ]);
    expect(cursorPos(vt.term)).toEqual({ x: 1, y: 2 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("typing with highlight enabled into a soft wrap preserves the footer", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      footer: "FOOT",
      highlight: (line) => line,
    });
    input.send("abcdefghijk");
    await flush(vt.term);

    const rows = Array.from({ length: 5 }, (_, row) => ({
      row,
      screen: screenLine(vt.term, row),
      raw: rawScreenLine(vt.term, row),
      wrapped: isWrappedRow(vt.term, row),
    }));

    expect(rows).toEqual([
      { row: 0, screen: ">", raw: ">           ", wrapped: false },
      { row: 1, screen: "> abcdefghij", raw: "> abcdefghij", wrapped: false },
      { row: 2, screen: "k", raw: "k           ", wrapped: true },
      { row: 3, screen: "FOOT", raw: "FOOT        ", wrapped: false },
      { row: 4, screen: "", raw: "            ", wrapped: false },
    ]);
    expect(cursorPos(vt.term)).toEqual({ x: 1, y: 2 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("typing into a soft wrap with footer preserves terminal content above the prompt", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);
    vt.stream.write("above\r\n");
    await flush(vt.term);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      footer: "FOOT",
    });
    input.send("abcdefghijk");
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe("above");
    expect(screenLine(vt.term, 1)).toBe(">");
    expect(screenLine(vt.term, 2)).toBe("> abcdefghij");
    expect(screenLine(vt.term, 3)).toBe("k");
    expect(screenLine(vt.term, 4)).toBe("FOOT");

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Prefix width edge cases ---

  it("wide prefix offsets cursor correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "input>>> ",
    });
    input.send("x");
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe("input>>>"); // prompt header (trimmed)
    expect(screenLine(vt.term, 1)).toBe("input>>> x");
    // linePrefix(9) + 1 = 10, row 1
    expect(cursorPos(vt.term)).toEqual({ x: 10, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("no prefix starts cursor at column 0", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "",
    });
    input.send("abc");
    await flush(vt.term);

    // No prompt header (prefix="" and prompt=""), input starts at row 0
    expect(screenLine(vt.term, 0)).toBe("abc");
    expect(cursorPos(vt.term)).toEqual({ x: 3, y: 0 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Delete key rendering ---

  it("Delete key removes character ahead and redraws", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("abcd");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // ab|cd
    input.send(KEY.DELETE); // ab|d
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abd");
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("Delete at line end merges lines and redraws", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send("cd");
    input.send(KEY.UP);
    input.send(KEY.CMD_RIGHT); // end of line 1
    input.send(KEY.DELETE); // merge
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("  abcd");
    expect(screenLine(vt.term, 2)).toBe("");
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Ctrl+U / Ctrl+K rendering ---

  it("Ctrl+U clears from cursor to line start", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("hello world");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // hello |world
    input.send(KEY.CTRL_U);
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> world");
    expect(cursorPos(vt.term)).toEqual({ x: 2, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("Ctrl+K clears from cursor to line end", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("hello world");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // hello |world
    input.send(KEY.CTRL_K);
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> hello");
    expect(cursorPos(vt.term)).toEqual({ x: 8, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- initialValue rendering ---

  it("initialValue renders correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
      initialValue: "hello",
    });
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe(">"); // prompt header
    expect(screenLine(vt.term, 1)).toBe("> hello");
    expect(cursorPos(vt.term)).toEqual({ x: 7, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("multi-line initialValue renders all lines", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
      initialValue: "line1\nline2",
    });
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe(">"); // prompt header
    expect(screenLine(vt.term, 1)).toBe("  line1");
    expect(screenLine(vt.term, 2)).toBe("  line2");
    expect(cursorPos(vt.term)).toEqual({ x: 7, y: 2 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- History rendering ---

  it("history navigation renders correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
      history: ["old entry"],
    });
    input.send("current");
    input.send(KEY.HOME); // move to col 0
    input.send(KEY.UP); // -> "old entry" (cursor at start)
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> old entry");
    expect(cursorPos(vt.term)).toEqual({ x: 2, y: 1 });

    input.send(KEY.END); // move to end
    input.send(KEY.DOWN); // -> "current"
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> current");
    expect(cursorPos(vt.term)).toEqual({ x: 9, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("history navigation clears correctly when current content has a wrapped earlier line", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
      history: ["abcdefghijk\nyyy", "z"],
    });

    // UP -> historyPrev -> loads "z" at cursor=start.
    input.send(KEY.UP);
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe("  z");

    // UP -> historyPrev -> loads "abcdefghijk\nyyy" at cursor=start.
    // Visual layout: row 1 "  abcdefghij", row 2 "k" (wrapped), row 3 "  yyy".
    input.send(KEY.UP);
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe("  abcdefghij");
    expect(screenLine(vt.term, 2)).toBe("k");
    expect(screenLine(vt.term, 3)).toBe("  yyy");

    // Move to the end of the second logical row so historyNext fires
    // while state.row > 0 AND an earlier line is wrapped above the cursor.
    input.send(KEY.END);
    input.send(KEY.DOWN); // moveDown to row=1, col=3 (end of "yyy")
    input.send(KEY.DOWN); // historyNext -> loads "z" at cursor=end
    await flush(vt.term);

    // With the bug, leftover "  abcdefghij" and "k" remain at rows 1 and 2,
    // and "  z" lands on row 3 instead of row 1.
    expect(screenLine(vt.term, 1)).toBe("  z");
    expect(screenLine(vt.term, 2)).toBe("");
    expect(screenLine(vt.term, 3)).toBe("");

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Undo / Redo rendering ---

  it("undo restores screen correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("abc");
    input.send(KEY.SHIFT_ENTER);
    input.send("def");
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("  abc");
    expect(screenLine(vt.term, 2)).toBe("  def");

    input.send(KEY.CTRL_Z); // undo "def"
    input.send(KEY.CTRL_Z); // undo newline
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("  abc");
    expect(screenLine(vt.term, 2)).toBe(""); // cleared
    expect(cursorPos(vt.term)).toEqual({ x: 5, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("undo restores correctly when the current screen includes a wrapped earlier line", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("abcdefghijk");
    input.send(KEY.SHIFT_ENTER);
    input.send("x");
    await flush(vt.term);

    input.send(KEY.CTRL_Z); // undo "x"
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe(">");
    expect(rawScreenLine(vt.term, 1)).toBe("  abcdefghij");
    expect(rawScreenLine(vt.term, 2).trim()).toBe("k");
    expect(rawScreenLine(vt.term, 3).trim()).toBe("");
    expect(cursorPos(vt.term)).toEqual({ x: 2, y: 3 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("redo restores screen correctly", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      // default prefix "> "
    });
    input.send("hello");
    input.send(KEY.CTRL_Z); // undo
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe(">");
    expect(cursorPos(vt.term)).toEqual({ x: 2, y: 1 });

    input.send(KEY.CTRL_Y); // redo
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe("> hello");
    expect(cursorPos(vt.term)).toEqual({ x: 7, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  // --- Ctrl+L rendering ---

  it("Ctrl+L clears screen and redraws content", async () => {
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("line1");
    input.send(KEY.SHIFT_ENTER);
    input.send("line2");
    input.send(KEY.UP); // move to line 1
    input.send(KEY.CTRL_L);
    await flush(vt.term);

    // After clear, content should be at top of screen
    expect(screenLine(vt.term, 0)).toBe(">"); // prompt header
    expect(screenLine(vt.term, 1)).toBe("  line1");
    expect(screenLine(vt.term, 2)).toBe("  line2");
    expect(cursorPos(vt.term).y).toBe(1);

    input.send(KEY.ENTER);
    await promise;
  });

  it("Ctrl+L restores cursor correctly when a later line wraps", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
    });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send("abcdefghijk");
    input.send(KEY.UP);
    await flush(vt.term);

    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 1 });

    input.send(KEY.CTRL_L);
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe(">");
    expect(screenLine(vt.term, 1)).toBe("  ab");
    expect(rawScreenLine(vt.term, 2)).toBe("  abcdefghij");
    expect(rawScreenLine(vt.term, 3).trim()).toBe("k");
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("validation redraw keeps cursor correct when error header grows taller", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(20, 24);
    vt.stream.write("above\r\n");
    await flush(vt.term);

    const promise = readMultiline("msg", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: { pending: "? ", submitted: "✔ ", error: "!\n? " },
      linePrefix: { pending: "> ", submitted: "  ", error: "x " },
      validate: (value) => (value.length < 3 ? "Too short" : undefined),
    });
    input.send("ab");
    input.send(KEY.ENTER);
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe("above");
    expect(screenLine(vt.term, 1)).toBe("!");
    expect(screenLine(vt.term, 2)).toBe("? msg");
    expect(screenLine(vt.term, 3)).toBe("x ab");
    expect(screenLine(vt.term, 4)).toBe("Too short");
    expect(cursorPos(vt.term)).toEqual({ x: 4, y: 3 });

    input.send("c");
    input.send(KEY.ENTER);
    await promise;
  });

  it("submit preserve does not duplicate a wrapped line after Shift+Enter", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: { pending: "> ", submitted: "✔ " },
      linePrefix: { pending: "  ", submitted: "  " },
      theme: { submitRender: "preserve" },
    });
    input.send("abcdefghijk");
    input.send(KEY.SHIFT_ENTER);
    input.send("x");
    await flush(vt.term);

    input.send(KEY.ENTER);
    await promise;
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe("✔");
    expect(rawScreenLine(vt.term, 1)).toBe("  abcdefghij");
    expect(rawScreenLine(vt.term, 2).trim()).toBe("k");
    expect(screenLine(vt.term, 3)).toBe("  x");
  });

  it("LEFT across a soft-wrap boundary syncs the terminal cursor", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
    });
    input.send("abcdefghijk");
    input.send(KEY.LEFT);
    await flush(vt.term);

    // state.col=10 corresponds to the deferred-wrap position right after "j"
    // on visual row 1, which is terminal row 1 col 11 (0-indexed col 11 via
    // explicit \x1b[12G). A naive \x1b[D would leave cursor on row 2 col 0.
    expect(cursorPos(vt.term)).toEqual({ x: 11, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("RIGHT across a soft-wrap boundary syncs the terminal cursor", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
    });
    input.send("abcdefghijk");
    input.send(KEY.HOME);
    // From col 0, move right 10 times to reach col 10 (deferred-wrap)
    for (let i = 0; i < 10; i++) input.send(KEY.RIGHT);
    await flush(vt.term);

    expect(cursorPos(vt.term)).toEqual({ x: 11, y: 1 });

    input.send(KEY.RIGHT); // col 10 -> 11 (cross wrap boundary)
    await flush(vt.term);

    // state.col=11 is on visual row 2 col 1 (after wrap)
    expect(cursorPos(vt.term)).toEqual({ x: 1, y: 2 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("delete that ends a soft-wrap reflows the footer up", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      footer: "FOOT",
    });
    input.send("abcdefghijk");
    input.send(KEY.LEFT); // place cursor before "k" at col 10
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abcdefghij");
    expect(screenLine(vt.term, 2)).toBe("k");
    expect(screenLine(vt.term, 3)).toBe("FOOT");

    input.send(KEY.DELETE);
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abcdefghij");
    expect(screenLine(vt.term, 2)).toBe("FOOT");
    expect(screenLine(vt.term, 3)).toBe("");
    expect(cursorPos(vt.term)).toEqual({ x: 11, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("backspace that ends a soft-wrap reflows the footer up", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      footer: "FOOT",
    });
    input.send("abcdefghijk");
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abcdefghij");
    expect(screenLine(vt.term, 2)).toBe("k");
    expect(screenLine(vt.term, 3)).toBe("FOOT");

    input.send(KEY.BACKSPACE);
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abcdefghij");
    expect(screenLine(vt.term, 2)).toBe("FOOT");
    expect(screenLine(vt.term, 3)).toBe("");
    expect(cursorPos(vt.term)).toEqual({ x: 11, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("Ctrl+K on a soft-wrapped line clears the wrap continuation", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      footer: "FOOT",
    });
    input.send("abcdefghijklm");
    input.send(KEY.HOME);
    for (let i = 0; i < 5; i++) input.send(KEY.RIGHT); // cursor at col 5
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abcdefghij");
    expect(screenLine(vt.term, 2)).toBe("klm");
    expect(screenLine(vt.term, 3)).toBe("FOOT");

    input.send(KEY.CTRL_K);
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abcde");
    expect(screenLine(vt.term, 2)).toBe("FOOT");
    expect(screenLine(vt.term, 3)).toBe("");
    expect(cursorPos(vt.term)).toEqual({ x: 7, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("Ctrl+U on a soft-wrapped line clears the wrap continuation", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      footer: "FOOT",
    });
    input.send("abcdefghijklm");
    // cursor at end (col 13). LEFT 3 times: col 10
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abcdefghij");
    expect(screenLine(vt.term, 2)).toBe("klm");
    expect(screenLine(vt.term, 3)).toBe("FOOT");

    input.send(KEY.CTRL_U);
    await flush(vt.term);

    // After deleting "abcdefghij", line becomes "klm" -- single visual row
    expect(screenLine(vt.term, 1)).toBe("> klm");
    expect(screenLine(vt.term, 2)).toBe("FOOT");
    expect(screenLine(vt.term, 3)).toBe("");
    expect(cursorPos(vt.term)).toEqual({ x: 2, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("backspace merging into a line that grows into a soft-wrap redraws correctly", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      linePrefix: "  ",
      footer: "FOOT",
    });
    // line 0: 10 chars (just fits visual row 0 with "  " prefix)
    // line 1: 3 chars
    input.send("aaaaaaaaaa");
    input.send(KEY.SHIFT_ENTER);
    input.send("bbb");
    input.send(KEY.HOME); // back to col 0 of line 1
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("  aaaaaaaaaa");
    expect(screenLine(vt.term, 2)).toBe("  bbb");
    expect(screenLine(vt.term, 3)).toBe("FOOT");

    input.send(KEY.BACKSPACE);
    await flush(vt.term);

    // After merge: lines[0] = "aaaaaaaaaabbb" (13 chars, wraps to 2 visual rows)
    expect(screenLine(vt.term, 1)).toBe("  aaaaaaaaaa");
    expect(screenLine(vt.term, 2)).toBe("bbb");
    expect(screenLine(vt.term, 3)).toBe("FOOT");

    input.send(KEY.ENTER);
    await promise;
  });

  it("inserting into a line where the trailing rest now crosses a soft-wrap", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
    });
    input.send("abcdefghij"); // 10 chars, fits a single row
    for (let i = 0; i < 5; i++) input.send(KEY.LEFT); // -> state.col = 5
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe("> abcdefghij");

    input.send("X"); // line becomes 11 chars, wraps to 2 rows
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe("> abcdeXfghi");
    expect(screenLine(vt.term, 2)).toBe("j");

    // Typing again must land right after 'X'. If the prior insert left the
    // cursor stuck at the wrap boundary, this char lands in the wrong row.
    input.send("Y");
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe("> abcdeXYfgh");
    expect(screenLine(vt.term, 2)).toBe("ij");

    input.send(KEY.ENTER);
    await promise;
  });

  it("LEFT across a deferred-wrap boundary lands the cursor at the correct column", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);
    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
    });
    // 14 chars => row 1 "> abcdefghij" + row 2 "klmn".
    // The wrap boundary sits between state.col=10 (col 12 with pending wrap)
    // and state.col=11 (col 2 of row 2).
    input.send("abcdefghijklmn");
    for (let i = 0; i < 9; i++) input.send(KEY.LEFT); // -> state.col = 5
    await flush(vt.term);

    // state.col=5 must place the cursor right after 'e' on row 1.
    // 1-indexed col 8 = 0-indexed col 7.
    expect(cursorPos(vt.term)).toEqual({ x: 7, y: 1 });

    input.send(KEY.ENTER);
    await promise;
  });

  it("Delete in the middle of a line whose tail crosses a soft-wrap keeps the cursor", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
    });
    input.send("abcdefghijklmn"); // 14 chars, wraps to 2 visual rows
    // Move cursor back to col 5 (right after 'e').
    for (let i = 0; i < 9; i++) input.send(KEY.LEFT);
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abcdefghij");
    expect(screenLine(vt.term, 2)).toBe("klmn");

    input.send(KEY.DELETE); // deletes 'f' -> line stays 2 visual rows
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe("> abcdeghijk");
    expect(screenLine(vt.term, 2)).toBe("lmn");

    // Typing now must insert right after 'e'. If the prior delete left the
    // cursor stuck at the wrap boundary, the new char lands in the wrong row.
    input.send("X");
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe("> abcdeXghij");
    expect(screenLine(vt.term, 2)).toBe("klmn");

    input.send(KEY.ENTER);
    await promise;
  });

  it("Backspace in the middle of a soft-wrapped line keeps the cursor on the correct row", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
    });
    input.send("abcdefghijklmn"); // 14 chars, wraps to 2 visual rows
    // Move cursor back to col 5 (right after 'e').
    for (let i = 0; i < 9; i++) input.send(KEY.LEFT);
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abcdefghij");
    expect(screenLine(vt.term, 2)).toBe("klmn");

    input.send(KEY.BACKSPACE); // deletes 'e' -> line stays 2 visual rows
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe("> abcdfghijk");
    expect(screenLine(vt.term, 2)).toBe("lmn");

    // Typing now must insert right after 'd'. If the prior backspace left the
    // cursor stuck at the wrap boundary, the new char lands in the wrong row.
    input.send("X");
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe("> abcdXfghij");
    expect(screenLine(vt.term, 2)).toBe("klmn");

    input.send(KEY.ENTER);
    await promise;
  });

  it("Ctrl+W in the middle of a soft-wrapped line with trailing rest", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
    });
    input.send("abc def gh ijklmnop"); // 19 chars, wraps to 2 visual rows
    // Move cursor to col 7 (right after 'f' in "def").
    for (let i = 0; i < 12; i++) input.send(KEY.LEFT);
    await flush(vt.term);

    expect(screenLine(vt.term, 1)).toBe("> abc def gh");
    expect(screenLine(vt.term, 2)).toBe(" ijklmnop");

    input.send("\x17"); // Ctrl+W deletes "def" -> "abc  gh ijklmnop"
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe("> abc  gh ij");
    expect(screenLine(vt.term, 2)).toBe("klmnop");

    // Typing now must insert at state.col=4 (between the two spaces).
    // If the prior delete left the cursor on the wrong row, 'X' lands elsewhere.
    input.send("X");
    await flush(vt.term);
    expect(screenLine(vt.term, 1)).toBe("> abc X gh i");
    expect(screenLine(vt.term, 2)).toBe("jklmnop");

    input.send(KEY.ENTER);
    await promise;
  });

  it("Ctrl+W on a soft-wrapped line clears the wrap continuation", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      footer: "FOOT",
    });
    // Two words separated by a space; deleting the second word collapses wrap.
    input.send("hello worldxyzab");
    await flush(vt.term);

    // hello worldxyzab => 16 chars + "> " (2) = 18 chars => visual rows 1 and 2
    expect(screenLine(vt.term, 1)).toBe("> hello worl");
    expect(screenLine(vt.term, 2)).toBe("dxyzab");
    expect(screenLine(vt.term, 3)).toBe("FOOT");

    input.send(KEY.CTRL_W);
    await flush(vt.term);

    // After Ctrl+W: "hello " remains (deletes "worldxyzab"). Fits single row.
    expect(screenLine(vt.term, 1)).toBe("> hello");
    expect(screenLine(vt.term, 2)).toBe("FOOT");
    expect(screenLine(vt.term, 3)).toBe("");

    input.send(KEY.ENTER);
    await promise;
  });

  it("paste does not emit full-redraw escape sequences while isPasting is true", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
      footer: "FOOT",
    });
    input.send("x");
    await flush(vt.term);

    const writes: string[] = [];
    const origWrite = vt.stream.write.bind(vt.stream);
    (vt.stream as { write: (data: string) => boolean }).write = (data: string) => {
      writes.push(data);
      return origWrite(data);
    };

    input.send("\x1b[200~");
    await flush(vt.term);
    const startIdx = writes.length;
    // Paste 13 chars to force the soft-wrap boundary to move during paste.
    input.send("abcdefghijklm");
    await flush(vt.term);
    const middleWrites = writes.slice(startIdx).join("");
    input.send("\x1b[201~");
    await flush(vt.term);

    (vt.stream as { write: (data: string) => boolean }).write = origWrite;

    // While isPasting is true, the optimization in input.ts is supposed to
    // batch redraws and let the post-paste clearScreen do the work. The
    // wrap-detection redrawFrom branch must therefore not run mid-paste,
    // which would emit \x1b[J (erase below) among other heavy sequences.
    expect(middleWrites).not.toContain("\x1b[J");

    input.send(KEY.ENTER);
    await promise;
  });

  it("default submit clear fully clears wrapped editor content", async () => {
    vt.term.dispose();
    vt = createVirtualTerminal(12, 24);
    vt.stream.write("above\r\n");
    await flush(vt.term);

    const promise = readMultiline("", {
      input,
      output: vt.stream,
      helpFooter: false,
      prefix: "> ",
    });
    input.send("abcdefghijk");
    await flush(vt.term);

    input.send(KEY.ENTER);
    await promise;
    await flush(vt.term);

    expect(screenLine(vt.term, 0)).toBe("above");
    expect(screenLine(vt.term, 1)).toBe("");
    expect(screenLine(vt.term, 2)).toBe("");
  });
});
