import { Terminal } from "@xterm/headless";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMultiline, type TTYInput } from "./index.js";

// Virtual terminal that feeds ANSI output into @xterm/headless
function createVirtualTerminal(cols = 80, rows = 24) {
  const term = new Terminal({ cols, rows, allowProposedApi: true, convertEol: true });
  const stream = {
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
});
