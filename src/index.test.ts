import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrompt, readMultiline, type TTYInput } from "./index.js";

// Dummy output stream that records writes
function createNullOutput() {
  const chunks: string[] = [];
  const stream = {
    write(data: string) {
      chunks.push(data);
      return true;
    },
  } as NodeJS.WritableStream;
  return { stream, chunks };
}

// Helper to simulate TTY input
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

// Key sequence constants
const KEY = {
  ENTER: "\r",
  KITTY_ENTER: "\x1b[13u",
  SHIFT_ENTER: "\x1b[13;2u",
  BACKSPACE: "\x7f",
  DELETE: "\x1b[3~",
  CTRL_C: "\x03",
  CTRL_D: "\x04",
  CTRL_W: "\x17",
  CTRL_U: "\x15",
  CTRL_K: "\x0b",
  CTRL_L: "\x0c",
  CTRL_Z: "\x1a",
  CTRL_Y: "\x19",
  CTRL_SHIFT_Z: "\x1b[122;6u",
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  RIGHT: "\x1b[C",
  LEFT: "\x1b[D",
  ALT_RIGHT: "\x1b[1;3C",
  ALT_LEFT: "\x1b[1;3D",
  ALT_UP: "\x1b[1;3A",
  ALT_DOWN: "\x1b[1;3B",
  CTRL_RIGHT: "\x1b[1;5C",
  CTRL_LEFT: "\x1b[1;5D",
  ESC_B: "\x1bb",
  ESC_F: "\x1bf",
  CMD_LEFT: "\x1b[1;9D",
  CMD_RIGHT: "\x1b[1;9C",
  CMD_UP: "\x1b[1;9A",
  CMD_DOWN: "\x1b[1;9B",
  CTRL_UP: "\x1b[1;5A",
  CTRL_DOWN: "\x1b[1;5B",
  CTRL_P: "\x10",
  CTRL_N: "\x0e",
  PAGE_UP: "\x1b[5~",
  PAGE_DOWN: "\x1b[6~",
  HOME: "\x1b[H",
  END: "\x1b[F",
};

describe("readMultiline (TTY mode)", () => {
  let input: ReturnType<typeof createTTYInput>;
  let output: ReturnType<typeof createNullOutput>;

  beforeEach(() => {
    input = createTTYInput();
    output = createNullOutput();
  });

  // --- Basic operations ---

  it("submits input on Enter", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello", null]);
  });

  it("inserts newline on Shift+Enter and submits on Enter", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("line1");
    input.send(KEY.SHIFT_ENTER);
    input.send("line2");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["line1\nline2", null]);
  });

  it("handles multiple Shift+Enter for multi-line input", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("a");
    input.send(KEY.SHIFT_ENTER);
    input.send("b");
    input.send(KEY.SHIFT_ENTER);
    input.send("c");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["a\nb\nc", null]);
  });

  it("returns CancelError on Ctrl+C", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("partial");
    input.send(KEY.CTRL_C);
    const [value, error] = await promise;
    expect(value).toBe("partial");
    expect(error).toEqual({ kind: "cancel", message: "Input cancelled" });
  });

  it("returns CancelError on Ctrl+C with no input", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send(KEY.CTRL_C);
    const [value, error] = await promise;
    expect(value).toBe("");
    expect(error).toEqual({ kind: "cancel", message: "Input cancelled" });
  });

  it("deletes character at cursor on Ctrl+D when input exists", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("text");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.CTRL_D); // delete 'x'
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["tet", null]);
  });

  it("returns EOFError on Ctrl+D when input is empty", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send(KEY.CTRL_D);
    const [value, error] = await promise;
    expect(value).toBe("");
    expect(error).toEqual({ kind: "eof", message: "EOF received on empty input" });
  });

  it("returns empty string on Enter with no input", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["", null]);
  });

  it("submits on kitty protocol Enter (CSI 13u)", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("test");
    input.send(KEY.KITTY_ENTER);
    expect(await promise).toEqual(["test", null]);
  });

  // --- Backspace ---

  it("deletes the last character on Backspace", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.BACKSPACE);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["ab", null]);
  });

  it("merges lines on Backspace at line start", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("line1");
    input.send(KEY.SHIFT_ENTER);
    input.send(KEY.BACKSPACE);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["line1", null]);
  });

  // --- Ctrl+W (word deletion) ---

  it("deletes the previous word on Ctrl+W", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello world");
    input.send(KEY.CTRL_W);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello ", null]);
  });

  it("deletes trailing whitespace and word on Ctrl+W", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello  world  ");
    input.send(KEY.CTRL_W);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello  ", null]);
  });

  it("deletes the entire line if it is a single word on Ctrl+W", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send(KEY.CTRL_W);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["", null]);
  });

  it("merges with previous line on Ctrl+W at line start", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.SHIFT_ENTER);
    input.send(KEY.CTRL_W);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  it("deletes word from cursor mid-position on Ctrl+W", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("foo bar baz");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // foo bar |baz
    input.send(KEY.CTRL_W); // delete " bar" -> "foo |baz"
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["foo baz", null]);
  });

  it("deletes full-width word on Ctrl+W", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello \u3042\u3044\u3046");
    input.send(KEY.CTRL_W);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello ", null]);
  });

  // --- Backspace (additional) ---

  it("deletes character at cursor mid-position on Backspace", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.LEFT); // ab|c
    input.send(KEY.BACKSPACE); // a|c
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["ac", null]);
  });

  // --- Shift+Enter line splitting ---

  it("splits line at cursor position on Shift+Enter", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abcd");
    input.send(KEY.LEFT); // abc|d
    input.send(KEY.LEFT); // ab|cd
    input.send(KEY.SHIFT_ENTER);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["ab\ncd", null]);
  });

  // --- Arrow key movement ---

  it("moves left and inserts character", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("ac");
    input.send(KEY.LEFT); // a|c
    input.send("b");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  it("moves right after moving left", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // a|bc
    input.send(KEY.RIGHT); // ab|c
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abXc", null]);
  });

  it("crosses to previous line end on Left at line start", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send("cd");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // line 2 start
    input.send(KEY.LEFT); // line 1 end (ab|)
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abX\ncd", null]);
  });

  it("crosses to next line start on Right at line end", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send("cd");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // line 1 end
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // line 1 start (|ab)
    input.send(KEY.RIGHT);
    input.send(KEY.RIGHT); // line 1 end (ab|)
    input.send(KEY.RIGHT); // line 2 start (|cd)
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["ab\nXcd", null]);
  });

  it("moves up to previous line", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.SHIFT_ENTER);
    input.send("de");
    input.send(KEY.UP); // line 1, col=min(2, 3)=2 -> ab|c
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abXc\nde", null]);
  });

  it("moves down to next line", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.SHIFT_ENTER);
    input.send("de");
    input.send(KEY.UP);
    input.send(KEY.DOWN); // line 2, col=min(2, 2)=2 -> de|
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc\ndeX", null]);
  });

  it("clamps column to line end when moving up to a shorter line", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send("cdefg");
    input.send(KEY.UP); // line 1, col=min(5, 2)=2 -> ab|
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abX\ncdefg", null]);
  });

  // --- Alt+Arrow (word jump) ---

  it("jumps to word end on Alt+Right", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello world");
    for (let i = 0; i < 11; i++) input.send(KEY.LEFT);
    input.send(KEY.ALT_RIGHT); // hello|
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["helloX world", null]);
  });

  it("jumps to word start on Alt+Left", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello world");
    input.send(KEY.ALT_LEFT); // |world
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello Xworld", null]);
  });

  it("crosses to next line on Alt+Right at line end", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send("cd");
    input.send(KEY.UP);
    input.send(KEY.CMD_RIGHT); // line end
    input.send(KEY.ALT_RIGHT); // next line word end
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["ab\ncdX", null]);
  });

  it("crosses to previous line on Alt+Left at line start", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send("cd");
    input.send(KEY.CMD_LEFT); // line 2 start
    input.send(KEY.ALT_LEFT); // previous line
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["Xab\ncd", null]);
  });

  // --- Ctrl+Arrow (line start/end, buffer start/end) ---

  it("moves to line end on Ctrl+Right", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello world");
    for (let i = 0; i < 11; i++) input.send(KEY.LEFT);
    input.send(KEY.CTRL_RIGHT); // -> end of line
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello worldX", null]);
  });

  it("moves to line start on Ctrl+Left", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello world");
    input.send(KEY.CTRL_LEFT); // -> start of line
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["Xhello world", null]);
  });

  // --- ESC+b/f (macOS Option+Arrow fallback) ---

  it("jumps to word start on ESC+b", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello world");
    input.send(KEY.ESC_B); // |world
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello Xworld", null]);
  });

  it("jumps to word end on ESC+f", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello world");
    for (let i = 0; i < 11; i++) input.send(KEY.LEFT);
    input.send(KEY.ESC_F); // hello|
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["helloX world", null]);
  });

  // --- Cmd+Arrow (line start/end, buffer start/end) ---

  it("moves to line start on Cmd+Left", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send(KEY.CMD_LEFT); // |hello
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["Xhello", null]);
  });

  it("moves to line end on Cmd+Right", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // hel|lo
    input.send(KEY.CMD_RIGHT); // hello|
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["helloX", null]);
  });

  it("moves to buffer start on Cmd+Up", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("line1");
    input.send(KEY.SHIFT_ENTER);
    input.send("line2");
    input.send(KEY.CMD_UP); // |line1
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["Xline1\nline2", null]);
  });

  it("moves to buffer end on Cmd+Down", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("line1");
    input.send(KEY.SHIFT_ENTER);
    input.send("line2");
    input.send(KEY.CMD_UP);
    input.send(KEY.CMD_DOWN); // line2|
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["line1\nline2X", null]);
  });

  it("Home/End keys work as line start/end", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send(KEY.HOME); // |hello
    input.send("A");
    input.send(KEY.END); // Ahello|
    input.send("Z");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["AhelloZ", null]);
  });

  // --- Protocol / Settings ---

  it("enables and disables raw mode", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    expect(input.setRawMode).toHaveBeenCalledWith(true);
    input.send(KEY.ENTER);
    await promise;
    expect(input.setRawMode).toHaveBeenCalledWith(false);
  });

  it("enables and disables kitty keyboard protocol", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    expect(output.chunks).toContain("\x1b[>1u");
    input.send(KEY.ENTER);
    await promise;
    expect(output.chunks).toContain("\x1b[<u");
  });

  it("displays the prompt header", async () => {
    const promise = readMultiline("Name:", {
      input,
      output: output.stream,
      prefix: "> ",
    });
    const joined = output.chunks.join("");
    expect(joined).toContain("> Name:");
    input.send(KEY.ENTER);
    await promise;
  });

  it("displays linePrefix on continuation lines", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: "> ",
      linePrefix: "... ",
    });
    input.send("a");
    input.send(KEY.SHIFT_ENTER);
    expect(output.chunks.join("")).toContain("\n... ");
    input.send(KEY.ENTER);
    await promise;
  });

  it("ignores unknown escape sequences", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("ab");
    input.send("\x1b[99~");
    input.send("c");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  // --- Full-width characters ---

  it("handles full-width character input", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\u3042\u3044\u3046");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["\u3042\u3044\u3046", null]);
  });

  it("inserts at cursor position between full-width characters", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\u3042\u3046");
    input.send(KEY.LEFT); // \u3042|\u3046
    input.send("\u3044");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["\u3042\u3044\u3046", null]);
  });

  it("deletes full-width character on Backspace", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\u3042\u3044\u3046");
    input.send(KEY.BACKSPACE);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["\u3042\u3044", null]);
  });

  it("deletes full-width character at cursor mid-position on Backspace", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\u3042\u3044\u3046");
    input.send(KEY.LEFT); // \u3042\u3044|\u3046
    input.send(KEY.BACKSPACE);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["\u3042\u3046", null]);
  });

  it("moves correctly with Left/Right on full-width characters", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\u3042\u3044\u3046");
    input.send(KEY.LEFT); // \u3042\u3044|\u3046
    input.send(KEY.LEFT); // \u3042|\u3044\u3046
    input.send(KEY.RIGHT); // \u3042\u3044|\u3046
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["\u3042\u3044X\u3046", null]);
  });

  it("handles mixed half-width and full-width characters", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("a\u3042b");
    input.send(KEY.LEFT); // a\u3042|b
    input.send(KEY.LEFT); // a|\u3042b
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["aX\u3042b", null]);
  });

  // --- Paste ---

  it("handles multi-line paste", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\x1b[200~line1\nline2\nline3\x1b[201~");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["line1\nline2\nline3", null]);
  });

  it("normalizes \\r\\n line endings in paste", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\x1b[200~line1\r\nline2\r\nline3\x1b[201~");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["line1\nline2\nline3", null]);
  });

  it("pastes into existing input at cursor position", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("before");
    input.send("\x1b[200~pasted1\npasted2\x1b[201~");
    input.send("after");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["beforepasted1\npasted2after", null]);
  });

  it("treats \\r in paste as newline, not submit", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\x1b[200~a\rb\x1b[201~");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["a\nb", null]);
  });

  it("handles paste data split across multiple events", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\x1b[200~hello\n");
    input.send("world\x1b[201~");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello\nworld", null]);
  });

  it("continues key operations after paste", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\x1b[200~abc\x1b[201~");
    input.send(KEY.BACKSPACE);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["ab", null]);
  });

  // --- Full-width characters (additional) ---

  it("Cmd+Left/Right works with full-width characters", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\u3042\u3044\u3046");
    input.send(KEY.CMD_LEFT); // |\u3042\u3044\u3046
    input.send("X");
    input.send(KEY.CMD_RIGHT); // X\u3042\u3044\u3046|
    input.send("Y");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["X\u3042\u3044\u3046Y", null]);
  });

  // --- ANSI output correctness ---

  it("writes correct ANSI cursor position for full-width characters", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: "> ",
    });
    input.send("\u3042"); // 2-column wide char
    input.send(KEY.LEFT); // should move back 2 columns
    const joined = output.chunks.join("");
    // Left on a full-width char emits ESC[2D (move left 2 columns)
    expect(joined).toContain("\x1b[2D");
    input.send(KEY.ENTER);
    await promise;
  });

  it("writes correct ANSI cursor column with linePrefix offset on moveTo", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: ">>> ",
      // linePrefix defaults to prefix = ">>> " (width 4)
    });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send("cd");
    input.send(KEY.UP); // moveTo(0, min(2,2)) -> column = 4 + width("ab") + 1 = 7
    const joined = output.chunks.join("");
    expect(joined).toContain("\x1b[7G");
    input.send(KEY.ENTER);
    await promise;
  });

  // --- ESC buffering ---

  it("combines split ESC sequence via buffering", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello world");
    // Simulate ESC arriving separately from the rest of the sequence (ESC+b = wordLeft)
    input.send("\x1b");
    // After a short delay, send the rest
    await new Promise((r) => setTimeout(r, 10));
    input.send("b"); // should combine to \x1bb = wordLeft -> |world
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello Xworld", null]);
  });

  it("flushes standalone ESC after timeout", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send("\x1b");
    // Wait longer than ESC_TIMEOUT (50ms)
    await new Promise((r) => setTimeout(r, 80));
    // ESC alone should be flushed and discarded (no keyMap match)
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abcX", null]);
  });

  // --- Kitty protocol key variants ---

  it("handles kitty Ctrl+C (CSI 99;5u)", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("text");
    input.send("\x1b[99;5u");
    const [value, error] = await promise;
    expect(value).toBe("text");
    expect(error).toEqual({ kind: "cancel", message: "Input cancelled" });
  });

  it("handles kitty Ctrl+D (CSI 100;5u) deletes character with input", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("text");
    input.send(KEY.LEFT);
    input.send("\x1b[100;5u"); // delete 't' at end
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["tex", null]);
  });

  it("handles kitty Ctrl+D (CSI 100;5u) on empty input", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\x1b[100;5u");
    const [value, error] = await promise;
    expect(value).toBe("");
    expect(error).toEqual({ kind: "eof", message: "EOF received on empty input" });
  });

  it("handles kitty Ctrl+W (CSI 119;5u)", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello world");
    input.send("\x1b[119;5u");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello ", null]);
  });

  it("handles kitty Ctrl+A (CSI 97;5u) as line start", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send("\x1b[97;5u"); // line start
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["Xhello", null]);
  });

  it("handles kitty Ctrl+E (CSI 101;5u) as line end", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send("\x1b[101;5u"); // line end
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["helloX", null]);
  });

  // --- Edge cases: boundary no-ops ---

  it("does nothing on Backspace at start of first line", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send(KEY.BACKSPACE);
    input.send("abc");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  it("moves to line start on Up at first line", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.UP); // col=3 -> col=0
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["Xabc", null]);
  });

  it("does nothing on Up at first line col 0", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.HOME);
    input.send(KEY.UP); // already at col=0, no history, no-op
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["Xabc", null]);
  });

  it("does nothing on Down at last line", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.DOWN);
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abcX", null]);
  });

  it("does nothing on Left at start of first line", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.CMD_LEFT);
    input.send(KEY.LEFT); // already at absolute start
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["Xabc", null]);
  });

  it("does nothing on Right at end of last line", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.RIGHT); // already at end
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abcX", null]);
  });

  it("does nothing on Cmd+Left when already at line start", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.CMD_LEFT);
    input.send(KEY.CMD_LEFT); // already at start
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["Xabc", null]);
  });

  it("does nothing on Cmd+Right when already at line end", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.CMD_RIGHT); // already at end
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abcX", null]);
  });

  it("Ctrl+W on empty line does nothing", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send(KEY.CTRL_W);
    input.send("abc");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  // --- Surrogate pair characters (emoji) ---

  it("handles surrogate pair character input", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("a\u{1F600}b"); // 😀
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["a\u{1F600}b", null]);
  });

  it("deletes surrogate pair character on Backspace", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("a\u{1F600}b");
    input.send(KEY.BACKSPACE); // delete b
    input.send(KEY.BACKSPACE); // delete 😀
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["a", null]);
  });

  it("moves cursor correctly around surrogate pair characters", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("a\u{1F600}b");
    input.send(KEY.LEFT); // a😀|b
    input.send(KEY.LEFT); // a|😀b
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["aX\u{1F600}b", null]);
  });

  it("preserves visual column when moving up between full-width and half-width lines", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    // Line 1: "abcd" (4 half-width chars, visual width 4)
    input.send("abcd");
    input.send(KEY.SHIFT_ENTER);
    // Line 2: "あい" (2 full-width chars, visual width 4)
    input.send("あい");
    // Cursor at end of line 2 (col=2, visual=4)
    // Move up: should land at visual col 4 on line 1 → col=4
    input.send(KEY.UP);
    input.send("X"); // insert at col 4 of line 1
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abcdX\nあい", null]);
  });

  it("preserves visual column when moving down from half-width to full-width line", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    // Line 1: "abcd" (visual width 4)
    input.send("abcd");
    input.send(KEY.SHIFT_ENTER);
    // Line 2: "あいう" (visual width 6)
    input.send("あいう");
    // Go to end of line 1 (col=4, visual=4)
    input.send(KEY.UP);
    // Move down: visual col 4 → "あい" (col=2) on line 2
    input.send(KEY.DOWN);
    input.send("X"); // insert at col 2 of line 2
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abcd\nあいXう", null]);
  });

  // --- Cleanup ---

  it("enables and disables bracketed paste mode", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    expect(output.chunks).toContain("\x1b[?2004h");
    input.send(KEY.ENTER);
    await promise;
    expect(output.chunks).toContain("\x1b[?2004l");
  });

  it("clears escTimer on cleanup", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send("\x1b"); // start ESC buffering with timer
    // Wait for the ESC timer to flush (50ms), then cancel normally
    await new Promise((r) => setTimeout(r, 80));
    input.send(KEY.CTRL_C);
    const [value, error] = await promise;
    expect(value).toBe("abc");
    expect(error).toEqual({ kind: "cancel", message: "Input cancelled" });
    // If escTimer wasn't properly handled, the timer would fire after cleanup
    // and potentially cause errors. This test verifies cleanup completes cleanly.
  });

  // --- linePrefix default ---

  it("uses prefix as default linePrefix when linePrefix is not specified", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: ">> ",
    });
    input.send("a");
    input.send(KEY.SHIFT_ENTER);
    const joined = output.chunks.join("");
    expect(joined).toContain("\n>> ");
    input.send(KEY.ENTER);
    await promise;
  });

  // --- Delete key (forward delete) ---

  it("deletes the character ahead on Delete", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.LEFT); // ab|c
    input.send(KEY.DELETE); // ab|
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["ab", null]);
  });

  it("merges next line on Delete at line end", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send("cd");
    input.send(KEY.UP);
    input.send(KEY.CMD_RIGHT); // end of line 1: ab|
    input.send(KEY.DELETE); // merge: abcd|
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abcd", null]);
  });

  it("does nothing on Delete at end of last line", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.DELETE);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  it("deletes full-width character on Delete", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("\u3042\u3044\u3046");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // あ|いう
    input.send(KEY.DELETE); // あ|う
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["\u3042\u3046", null]);
  });

  // --- Ctrl+U (delete to line start) ---

  it("deletes from cursor to line start on Ctrl+U", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello world");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // hello |world
    input.send(KEY.CTRL_U); // |world
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["world", null]);
  });

  it("does nothing on Ctrl+U at line start", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.CMD_LEFT);
    input.send(KEY.CTRL_U);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  // --- Ctrl+K (delete to line end) ---

  it("deletes from cursor to line end on Ctrl+K", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello world");
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT);
    input.send(KEY.LEFT); // hello |world
    input.send(KEY.CTRL_K); // hello |
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello ", null]);
  });

  it("does nothing on Ctrl+K at line end", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.CTRL_K);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  // --- initialValue ---

  it("pre-populates input with initialValue", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      initialValue: "hello",
    });
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello", null]);
  });

  it("pre-populates multi-line initialValue", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      initialValue: "line1\nline2\nline3",
    });
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["line1\nline2\nline3", null]);
  });

  it("allows editing after initialValue", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      initialValue: "hello",
    });
    input.send(" world");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello world", null]);
  });

  // --- History ---

  it("navigates to previous history on Up at first line", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["first", "second"],
    });
    input.send(KEY.UP); // -> "second"
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["second", null]);
  });

  it("navigates through history entries", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["first", "second"],
    });
    input.send(KEY.UP); // -> "second" (cursor at start)
    input.send(KEY.UP); // -> "first" (cursor already at start)
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["first", null]);
  });

  it("returns to draft on Down past end of history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["first", "second"],
    });
    input.send("draft");
    input.send(KEY.HOME); // move to col 0
    input.send(KEY.UP); // -> "second" (cursor at start)
    input.send(KEY.DOWN); // col=0 -> col=end (move to end, not history)
    input.send(KEY.DOWN); // -> "draft" (cursor at end)
    input.send(KEY.DOWN); // no-op (already at current draft)
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["draft", null]);
  });

  it("Up at first line with col > 0 moves to col 0 instead of history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["old"],
    });
    input.send("text");
    input.send(KEY.UP); // col=4 -> col=0 (not history)
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["Xtext", null]);
  });

  it("Down at last line with col < end moves to end instead of history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["old"],
    });
    input.send("text");
    input.send(KEY.HOME); // col=0
    input.send(KEY.UP); // history -> "old" (cursor at start)
    input.send(KEY.DOWN); // col=0 -> col=end (move to end, not history)
    input.send(KEY.DOWN); // -> "text" (cursor at end)
    input.send(KEY.HOME); // col=0
    input.send(KEY.DOWN); // col=0 -> col=end (not next history)
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["textX", null]);
  });

  it("does not go past beginning of history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["only"],
    });
    input.send(KEY.UP); // -> "only"
    input.send(KEY.UP); // no-op (already at oldest)
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["only", null]);
  });

  it("Up on non-first line moves cursor, not history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["old"],
    });
    input.send("line1");
    input.send(KEY.SHIFT_ENTER);
    input.send("line2");
    input.send(KEY.UP); // move to line 1 (col clamped to min(5,5)=5 = end)
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["line1X\nline2", null]);
  });

  it("Down on non-last line moves cursor, not history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["old"],
    });
    input.send("line1");
    input.send(KEY.SHIFT_ENTER);
    input.send("line2");
    input.send(KEY.UP); // move to line 1
    input.send(KEY.DOWN); // move to line 2 (col clamped to min(5,5)=5 = end)
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["line1\nline2X", null]);
  });

  it("Alt+Up/Down navigates history directly", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["old"],
    });
    input.send("only line");
    input.send(KEY.ALT_UP); // -> "old" (history prev, cursor at start)
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["Xold", null]);
  });

  it("navigates multi-line history entries", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["line1\nline2"],
    });
    input.send(KEY.UP); // -> "line1\nline2"
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["line1\nline2", null]);
  });

  // --- historyArrowNavigation: "double" ---

  it("double mode: requires two Up presses at boundary to navigate history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["old"],
      historyArrowNavigation: "double",
    });
    input.send(KEY.UP); // first press: no-op
    input.send("X"); // typing resets the counter
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["X", null]);
  });

  it("double mode: two consecutive Up presses at boundary navigates history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["old"],
      historyArrowNavigation: "double",
    });
    input.send(KEY.UP); // first press
    input.send(KEY.UP); // second press -> history
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["old", null]);
  });

  // --- historyArrowNavigation: "disabled" ---

  it("disabled mode: Up/Down never triggers history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["old"],
      historyArrowNavigation: "disabled",
    });
    input.send(KEY.UP); // no-op (disabled)
    input.send(KEY.UP); // still no-op
    input.send("new");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["new", null]);
  });

  it("disabled mode: dedicated keys still navigate history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["old"],
      historyArrowNavigation: "disabled",
    });
    input.send(KEY.ALT_UP); // dedicated key still works
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["old", null]);
  });

  // --- Dedicated history keys ---

  it("Ctrl+P/N navigates history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["first", "second"],
    });
    input.send(KEY.CTRL_P); // -> "second" (cursor at start)
    input.send(KEY.CTRL_P); // -> "first" (cursor at start)
    input.send(KEY.CTRL_N); // -> "second"
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["second", null]);
  });

  it("PageUp/PageDown navigates history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      history: ["first", "second"],
    });
    input.send(KEY.PAGE_UP); // -> "second" (cursor at start)
    input.send(KEY.PAGE_UP); // -> "first" (cursor at start)
    input.send(KEY.PAGE_DOWN); // -> "second"
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["second", null]);
  });

  // --- File-based history persistence ---

  describe("file-based history persistence", () => {
    const testDir = join(tmpdir(), `read-multiline-persist-${process.pid}`);

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    async function waitForEntries(
      filePath: string,
      predicate: (entries: string[]) => boolean,
      timeoutMs = 1000,
    ): Promise<string[]> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          const raw = readFileSync(filePath, "utf8");
          const entries = JSON.parse(raw) as string[];
          if (predicate(entries)) return entries;
        } catch {
          // file not ready yet
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`timeout waiting for history file at ${filePath}`);
    }

    it("persists submitted entries to the history file", async () => {
      const filePath = join(testDir, "history.json");
      mkdirSync(testDir, { recursive: true });
      const promise = readMultiline("", {
        input,
        output: output.stream,
        history: { filePath },
      });
      input.send("hello");
      input.send(KEY.ENTER);
      expect(await promise).toEqual(["hello", null]);
      expect(await waitForEntries(filePath, (e) => e.length > 0)).toEqual(["hello"]);
    });

    it("skips empty submissions by default", async () => {
      const filePath = join(testDir, "history.json");
      mkdirSync(testDir, { recursive: true });
      const promise = readMultiline("", {
        input,
        output: output.stream,
        history: { filePath },
      });
      input.send(KEY.ENTER);
      expect(await promise).toEqual(["", null]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(existsSync(filePath)).toBe(false);
    });

    it("persists whitespace-only submissions by default", async () => {
      const filePath = join(testDir, "history.json");
      mkdirSync(testDir, { recursive: true });
      const promise = readMultiline("", {
        input,
        output: output.stream,
        history: { filePath },
      });
      input.send("   ");
      input.send(KEY.ENTER);
      expect(await promise).toEqual(["   ", null]);
      expect(await waitForEntries(filePath, (e) => e.length > 0)).toEqual(["   "]);
    });

    it("persists empty submissions when shouldPersist allows it", async () => {
      const filePath = join(testDir, "history.json");
      mkdirSync(testDir, { recursive: true });
      const promise = readMultiline("", {
        input,
        output: output.stream,
        history: {
          filePath,
          shouldPersist: () => true,
        },
      });
      input.send(KEY.ENTER);
      expect(await promise).toEqual(["", null]);
      expect(await waitForEntries(filePath, (e) => e.length > 0)).toEqual([""]);
    });

    it("skips persistence when shouldPersist returns false", async () => {
      const filePath = join(testDir, "history.json");
      mkdirSync(testDir, { recursive: true });
      const promise = readMultiline("", {
        input,
        output: output.stream,
        history: {
          filePath,
          shouldPersist: (value) => !value.startsWith("\\"),
        },
      });
      input.send("\\help");
      input.send(KEY.ENTER);
      expect(await promise).toEqual(["\\help", null]);
      // Allow any attempted write to complete; no file should be created.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(existsSync(filePath)).toBe(false);
    });

    it("only persists values for which shouldPersist returns true", async () => {
      const filePath = join(testDir, "history.json");
      mkdirSync(testDir, { recursive: true });

      const shouldPersist = (value: string) => value.trim() !== "";

      const runSubmit = async (content: string) => {
        const localInput = createTTYInput();
        const localOutput = createNullOutput();
        const promise = readMultiline("", {
          input: localInput,
          output: localOutput.stream,
          history: { filePath, shouldPersist },
        });
        localInput.send(content);
        localInput.send(KEY.ENTER);
        return promise;
      };

      expect(await runSubmit("hello")).toEqual(["hello", null]);
      await waitForEntries(filePath, (e) => e.includes("hello"));

      expect(await runSubmit("   ")).toEqual(["   ", null]);
      // give any unexpected save time to land before the next submit
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(await runSubmit("world")).toEqual(["world", null]);
      const entries = await waitForEntries(filePath, (e) => e.includes("world"));
      expect(entries).toEqual(["hello", "world"]);
    });
  });

  // --- Ctrl+Up/Down for buffer navigation ---

  it("Ctrl+Up moves to buffer start", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
    });
    input.send("line1");
    input.send(KEY.SHIFT_ENTER);
    input.send("line2");
    input.send(KEY.CTRL_UP); // -> buffer start (row 0, col 0)
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["Xline1\nline2", null]);
  });

  it("Ctrl+Down moves to buffer end", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
    });
    input.send("line1");
    input.send(KEY.SHIFT_ENTER);
    input.send("line2");
    input.send(KEY.CTRL_UP); // -> buffer start
    input.send(KEY.CTRL_DOWN); // -> buffer end
    input.send("X");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["line1\nline2X", null]);
  });

  // --- Validation ---

  it("rejects submit when validation fails", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      validate: (v) => (v.length < 3 ? "Too short" : undefined),
    });
    input.send("ab");
    input.send(KEY.ENTER); // validation fails, does not submit
    input.send("c"); // now "abc"
    input.send(KEY.ENTER); // validation passes
    expect(await promise).toEqual(["abc", null]);
  });

  it("submits when validation returns undefined", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      validate: () => undefined,
    });
    input.send("anything");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["anything", null]);
  });

  it("submits when validation returns null", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      validate: () => null,
    });
    input.send("anything");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["anything", null]);
  });

  // --- Max lines ---

  it("prevents newline insertion when at maxLines", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      maxLines: 2,
    });
    input.send("line1");
    input.send(KEY.SHIFT_ENTER);
    input.send("line2");
    input.send(KEY.SHIFT_ENTER); // blocked
    input.send("line3");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["line1\nline2line3", null]);
  });

  // --- Max length ---

  it("prevents character insertion when at maxLength", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      maxLength: 5,
    });
    input.send("abcde");
    input.send("f"); // blocked
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abcde", null]);
  });

  it("counts newlines in maxLength", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      maxLength: 5,
    });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER); // "ab\n" = 3 chars
    input.send("cd"); // "ab\ncd" = 5 chars
    input.send("e"); // blocked
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["ab\ncd", null]);
  });

  it("allows deletion when at maxLength", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      maxLength: 3,
    });
    input.send("abc"); // at limit
    input.send(KEY.BACKSPACE); // "ab"
    input.send("d"); // "abd" (back at limit)
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abd", null]);
  });

  // --- Ctrl+L ---

  it("Ctrl+L preserves input content", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send(KEY.CTRL_L);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello", null]);
  });

  // --- Undo / Redo ---

  it("undoes character insertion with Ctrl+Z", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.CTRL_Z); // undo grouped "abc" insert
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["", null]);
  });

  it("undoes and redoes with Ctrl+Z / Ctrl+Y", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send(KEY.CTRL_Z); // undo
    input.send(KEY.CTRL_Y); // redo
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello", null]);
  });

  it("undoes newline insertion", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("ab");
    input.send(KEY.SHIFT_ENTER);
    input.send(KEY.CTRL_Z); // undo newline
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["ab", null]);
  });

  it("undoes backspace", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.BACKSPACE); // delete c
    input.send(KEY.CTRL_Z); // undo backspace
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  it("undoes delete key", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.LEFT); // ab|c
    input.send(KEY.DELETE); // ab|
    input.send(KEY.CTRL_Z); // undo delete
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  it("undoes Ctrl+W word deletion", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello world");
    input.send(KEY.CTRL_W); // delete "world"
    input.send(KEY.CTRL_Z); // undo
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello world", null]);
  });

  it("undoes Ctrl+U delete to line start", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send(KEY.CTRL_U); // delete all
    input.send(KEY.CTRL_Z); // undo
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello", null]);
  });

  it("undoes Ctrl+K delete to line end", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send(KEY.CMD_LEFT); // |hello
    input.send(KEY.CTRL_K); // delete all
    input.send(KEY.CTRL_Z); // undo
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello", null]);
  });

  it("multiple undos step through history", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("aaa");
    input.send(KEY.SHIFT_ENTER); // newline (separate undo step)
    input.send("bbb");
    input.send(KEY.CTRL_Z); // undo "bbb"
    input.send(KEY.CTRL_Z); // undo newline
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["aaa", null]);
  });

  it("redo is cleared on new edit after undo", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.CTRL_Z); // undo -> ""
    input.send("xyz"); // new edit, clears redo
    input.send(KEY.CTRL_Y); // redo does nothing
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["xyz", null]);
  });

  it("Ctrl+Shift+Z works as redo (kitty)", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send(KEY.CTRL_Z); // undo
    input.send(KEY.CTRL_SHIFT_Z); // redo
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello", null]);
  });

  it("undo does nothing when stack is empty", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send(KEY.CTRL_Z); // nothing to undo
    input.send("abc");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  it("redo does nothing when stack is empty", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.CTRL_Y); // nothing to redo
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  it("undoes paste as a single unit", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("before");
    input.send("\x1b[200~line1\nline2\nline3\x1b[201~");
    input.send(KEY.CTRL_Z); // undo entire paste
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["before", null]);
  });

  it("groups consecutive character inserts into one undo step", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("a");
    input.send("b");
    input.send("c"); // all grouped as one insert
    input.send(KEY.CTRL_Z); // undo all three at once
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["", null]);
  });

  it("newline breaks insert grouping for undo", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("abc");
    input.send(KEY.SHIFT_ENTER); // breaks group
    input.send("def");
    input.send(KEY.CTRL_Z); // undo "def"
    input.send(KEY.CTRL_Z); // undo newline
    input.send(KEY.CTRL_Z); // undo "abc"
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["", null]);
  });

  // --- preferNewlineOnEnter option ---

  it("preferNewlineOnEnter=true: Enter inserts newline, modified Enter submits", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      preferNewlineOnEnter: true,
    });
    input.send("line1");
    input.send(KEY.ENTER); // inserts newline
    input.send("line2");
    input.send(KEY.SHIFT_ENTER); // submits (any modified enter works)
    expect(await promise).toEqual(["line1\nline2", null]);
  });

  it("preferNewlineOnEnter=true: Ctrl+J still inserts newline (always newline)", async () => {
    const CTRL_J = "\n";
    const promise = readMultiline("", {
      input,
      output: output.stream,
      preferNewlineOnEnter: true,
    });
    input.send("hello");
    input.send(CTRL_J); // inserts newline (Ctrl+J always newline)
    input.send("world");
    input.send(KEY.SHIFT_ENTER); // submits
    expect(await promise).toEqual(["hello\nworld", null]);
  });

  it("preferNewlineOnEnter=true: Cmd+Enter submits", async () => {
    const CMD_ENTER = "\x1b[13;9u";
    const promise = readMultiline("", {
      input,
      output: output.stream,
      preferNewlineOnEnter: true,
    });
    input.send("line1");
    input.send(KEY.ENTER); // inserts newline
    input.send("line2");
    input.send(CMD_ENTER); // submits
    expect(await promise).toEqual(["line1\nline2", null]);
  });

  it("preferNewlineOnEnter=true: Ctrl+Enter (kitty) submits", async () => {
    const CTRL_ENTER = "\x1b[13;5u";
    const promise = readMultiline("", {
      input,
      output: output.stream,
      preferNewlineOnEnter: true,
    });
    input.send("text");
    input.send(CTRL_ENTER); // submits
    expect(await promise).toEqual(["text", null]);
  });

  it("preferNewlineOnEnter=true: Alt+Enter (legacy ESC+CR) submits", async () => {
    const ALT_ENTER_LEGACY = "\x1b\r";
    const promise = readMultiline("", {
      input,
      output: output.stream,
      preferNewlineOnEnter: true,
    });
    input.send("text");
    input.send(ALT_ENTER_LEGACY); // submits
    expect(await promise).toEqual(["text", null]);
  });

  it("preferNewlineOnEnter=false (default): all modified enters insert newline", async () => {
    const CTRL_J = "\n";
    const promise = readMultiline("", {
      input,
      output: output.stream,
    });
    input.send("a");
    input.send(KEY.SHIFT_ENTER); // newline
    input.send("b");
    input.send(CTRL_J); // newline (Ctrl+J always newline)
    input.send("c");
    input.send(KEY.ENTER); // submits
    expect(await promise).toEqual(["a\nb\nc", null]);
  });

  it("kitty Ctrl+J inserts newline", async () => {
    const KITTY_CTRL_J = "\x1b[106;5u";
    const promise = readMultiline("", {
      input,
      output: output.stream,
    });
    input.send("hello");
    input.send(KITTY_CTRL_J); // kitty Ctrl+J inserts newline
    input.send("world");
    input.send(KEY.ENTER); // submits
    expect(await promise).toEqual(["hello\nworld", null]);
  });

  it("kitty Ctrl+J respects disabledKeys", async () => {
    const KITTY_CTRL_J = "\x1b[106;5u";
    const promise = readMultiline("", {
      input,
      output: output.stream,
      disabledKeys: ["ctrl+j"],
    });
    input.send("hello");
    input.send(KITTY_CTRL_J); // disabled, ignored
    input.send(KEY.SHIFT_ENTER); // newline still works
    input.send("world");
    input.send(KEY.ENTER); // submits
    expect(await promise).toEqual(["hello\nworld", null]);
  });

  it("preferNewlineOnEnter=true: plain Enter does not submit", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      preferNewlineOnEnter: true,
    });
    input.send("a");
    input.send(KEY.ENTER); // newline
    input.send("b");
    input.send(KEY.ENTER); // newline
    input.send("c");
    input.send(KEY.SHIFT_ENTER); // submits
    expect(await promise).toEqual(["a\nb\nc", null]);
  });

  it("preferNewlineOnEnter=true: validation runs on modified enter submit", async () => {
    const CMD_ENTER = "\x1b[13;9u";
    const promise = readMultiline("", {
      input,
      output: output.stream,
      preferNewlineOnEnter: true,
      validate: (v) => (v.length < 3 ? "Too short" : undefined),
    });
    input.send("ab");
    input.send(CMD_ENTER); // validation fails, does not submit
    input.send("c"); // now "abc"
    input.send(CMD_ENTER); // validation passes
    expect(await promise).toEqual(["abc", null]);
  });

  it("preferNewlineOnEnter=true with maxLines: Enter respects maxLines", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      preferNewlineOnEnter: true,
      maxLines: 2,
    });
    input.send("line1");
    input.send(KEY.ENTER); // newline (line 2)
    input.send("line2");
    input.send(KEY.ENTER); // blocked by maxLines
    input.send("extra");
    input.send(KEY.SHIFT_ENTER); // submit
    expect(await promise).toEqual(["line1\nline2extra", null]);
  });

  // --- disabledKeys option ---

  it("disabledKeys disables specific key combos", async () => {
    const CTRL_J = "\n";
    const promise = readMultiline("", {
      input,
      output: output.stream,
      disabledKeys: ["ctrl+j"],
    });
    input.send("hello");
    input.send(CTRL_J); // disabled, ignored
    input.send(KEY.SHIFT_ENTER); // newline still works
    input.send("world");
    input.send(KEY.ENTER); // submits
    expect(await promise).toEqual(["hello\nworld", null]);
  });

  it("disabledKeys works with preferNewlineOnEnter=true", async () => {
    const CMD_ENTER = "\x1b[13;9u";
    const promise = readMultiline("", {
      input,
      output: output.stream,
      preferNewlineOnEnter: true,
      disabledKeys: ["shift+enter", "alt+enter"],
    });
    input.send("text");
    input.send(KEY.SHIFT_ENTER); // disabled, ignored
    // Cmd+Enter still works as submit
    input.send(CMD_ENTER);
    expect(await promise).toEqual(["text", null]);
  });

  // --- clear after submit ---

  it("clears input from terminal after submit", async () => {
    const promise = readMultiline("", { prefix: "", input, output: output.stream });
    input.send("hello");
    input.send(KEY.ENTER);
    await promise;
    const raw = output.chunks.join("");
    // Should contain \r\x1b[J (clear from cursor to end of screen) instead of trailing \n
    expect(raw).toContain("\r\x1b[J");
    // No \n should appear after the clear sequence
    const clearIdx = raw.lastIndexOf("\r\x1b[J");
    const afterClear = raw.slice(clearIdx + "\r\x1b[J".length);
    expect(afterClear).not.toContain("\n");
  });

  it("clears multi-line input after submit", async () => {
    const promise = readMultiline("", { prefix: "", input, output: output.stream });
    input.send("line1");
    input.send(KEY.SHIFT_ENTER);
    input.send("line2");
    input.send(KEY.ENTER);
    const [result, error] = await promise;
    expect(error).toBeNull();
    expect(result).toBe("line1\nline2");
    const raw = output.chunks.join("");
    // Should contain the submit-time clear sequence for multi-line input
    const clearIdx = raw.lastIndexOf("\r\x1b[J");
    expect(clearIdx).toBeGreaterThan(-1);
    const afterClear = raw.slice(clearIdx + "\r\x1b[J".length);
    expect(afterClear).not.toContain("\n");
  });

  // --- highlight option ---

  it("applies highlight function to output", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      highlight: (line) => `\x1b[31m${line}\x1b[0m`,
    });
    input.send("hello");
    input.send(KEY.ENTER);
    const [result] = await promise;
    expect(result).toBe("hello");
    const raw = output.chunks.join("");
    expect(raw).toContain("\x1b[31mhello\x1b[0m");
  });

  it("highlight does not affect submitted value", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      highlight: (line) => line.replace(/hello/, "\x1b[32mhello\x1b[0m"),
    });
    input.send("hello world");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello world", null]);
  });

  it("highlight receives line index", async () => {
    const indices: number[] = [];
    const promise = readMultiline("", {
      input,
      output: output.stream,
      highlight: (line, index) => {
        indices.push(index);
        return line;
      },
    });
    input.send("a");
    input.send(KEY.SHIFT_ENTER);
    input.send("b");
    input.send(KEY.ENTER);
    await promise;
    expect(indices).toContain(0);
    expect(indices).toContain(1);
  });

  it("highlight works with initialValue", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      highlight: (line) => `\x1b[33m${line}\x1b[0m`,
      initialValue: "init",
    });
    const raw = output.chunks.join("");
    expect(raw).toContain("\x1b[33minit\x1b[0m");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["init", null]);
  });

  it("highlight works with undo/redo", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      highlight: (line) => `\x1b[31m${line}\x1b[0m`,
    });
    input.send("abc");
    input.send(KEY.CTRL_Z);
    input.send(KEY.CTRL_Y);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["abc", null]);
  });

  it("highlight is preserved after backspace", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      highlight: (line) => `\x1b[31m${line}\x1b[0m`,
    });
    input.send("abc");
    output.chunks.length = 0;
    input.send(KEY.BACKSPACE);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["ab", null]);
    const raw = output.chunks.join("");
    expect(raw).toContain("\x1b[31m");
  });

  it("highlight is preserved after delete", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      highlight: (line) => `\x1b[31m${line}\x1b[0m`,
    });
    input.send("abc");
    input.send(KEY.LEFT);
    output.chunks.length = 0;
    input.send(KEY.DELETE);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["ab", null]);
    const raw = output.chunks.join("");
    expect(raw).toContain("\x1b[31m");
  });

  it("highlight is applied after paste", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      highlight: (line) => `\x1b[31m${line}\x1b[0m`,
    });
    output.chunks.length = 0;
    input.send("\x1b[200~pasted\x1b[201~");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["pasted", null]);
    const raw = output.chunks.join("");
    expect(raw).toContain("\x1b[31mpasted\x1b[0m");
  });

  it("highlight is applied when navigating history", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      highlight: (line) => `\x1b[31m${line}\x1b[0m`,
      history: ["older", "newer"],
    });
    output.chunks.length = 0;
    input.send(KEY.UP); // -> "newer"
    const afterFirst = output.chunks.join("");
    expect(afterFirst).toContain("\x1b[31mnewer\x1b[0m");
    output.chunks.length = 0;
    input.send(KEY.UP); // -> "older"
    const afterSecond = output.chunks.join("");
    expect(afterSecond).toContain("\x1b[31molder\x1b[0m");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["older", null]);
  });

  it("highlight is applied to multi-line history entries", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      highlight: (line, index) => `\x1b[3${index + 1}m${line}\x1b[0m`,
      history: ["line1\nline2"],
    });
    output.chunks.length = 0;
    input.send(KEY.UP);
    const raw = output.chunks.join("");
    expect(raw).toContain("\x1b[31mline1\x1b[0m");
    expect(raw).toContain("\x1b[32mline2\x1b[0m");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["line1\nline2", null]);
  });

  // --- transform option ---

  it("transform can auto-close brackets", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      transform(state, event) {
        if (event.type === "insert" && event.char === "(") {
          const { lines, row, col } = state;
          const line = lines[row];
          const newLine = line.slice(0, col) + ")" + line.slice(col);
          return { lines: lines.with(row, newLine), row, col };
        }
      },
    });
    input.send("fn(");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["fn()", null]);
  });

  it("transform can add indentation on newline", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      transform(state, event) {
        if (event.type === "newline") {
          const { lines, row, col } = state;
          const prevLine = lines[row - 1];
          const indent = prevLine.match(/^(\s*)/)?.[1] ?? "";
          if (indent && col === 0) {
            return { lines: lines.with(row, indent + lines[row]), row, col: indent.length };
          }
        }
      },
    });
    input.send("  hello");
    input.send(KEY.SHIFT_ENTER);
    input.send("world");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["  hello\n  world", null]);
  });

  it("transform returning undefined is a no-op", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      transform() {
        return undefined;
      },
    });
    input.send("hello");
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["hello", null]);
  });

  it("transform is skipped during paste", async () => {
    const calls: string[] = [];
    const promise = readMultiline("", {
      input,
      output: output.stream,
      transform(_state, event) {
        calls.push(event.type);
        return undefined;
      },
    });
    input.send("\x1b[200~pasted\x1b[201~");
    input.send(KEY.ENTER);
    await promise;
    // transform should not have been called during paste
    expect(calls).not.toContain("insert");
  });

  it("transform receives correct event types", async () => {
    const events: string[] = [];
    const promise = readMultiline("", {
      input,
      output: output.stream,
      transform(_state, event) {
        events.push(event.type);
        return undefined;
      },
    });
    input.send("a"); // insert
    input.send(KEY.SHIFT_ENTER); // newline
    input.send("b"); // insert
    input.send(KEY.BACKSPACE); // backspace
    input.send(KEY.LEFT);
    input.send(KEY.DELETE); // delete
    input.send(KEY.ENTER);
    await promise;
    expect(events).toEqual(["insert", "newline", "insert", "backspace", "delete"]);
  });

  it("transform can perform multi-line operations (bracket expansion)", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      transform(state, event) {
        if (event.type === "insert" && event.char === "{") {
          const { lines, row, col } = state;
          const line = lines[row];
          const newLine = line.slice(0, col) + "}" + line.slice(col);
          return { lines: lines.with(row, newLine), row, col };
        }
        if (event.type === "newline") {
          const { lines, row } = state;
          const prevLine = lines[row - 1];
          if (prevLine.trimEnd().endsWith("{") && lines[row].trimStart().startsWith("}")) {
            const indent = prevLine.match(/^(\s*)/)?.[1] ?? "";
            const newLines = [...lines];
            newLines[row] = indent + "  ";
            newLines.splice(row + 1, 0, indent + lines[row].trimStart());
            return { lines: newLines, row, col: indent.length + 2 };
          }
        }
      },
    });
    input.send("if {");
    input.send(KEY.SHIFT_ENTER);
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["if {\n  \n}", null]);
  });

  it("undo restores state before transform", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      transform(state, event) {
        if (event.type === "insert" && event.char === "(") {
          const { lines, row, col } = state;
          const line = lines[row];
          const newLine = line.slice(0, col) + ")" + line.slice(col);
          return { lines: lines.with(row, newLine), row, col };
        }
      },
    });
    input.send("fn(");
    input.send(KEY.CTRL_Z); // undo should revert "fn(" + transform ")"
    input.send(KEY.ENTER);
    expect(await promise).toEqual(["", null]);
  });

  it("highlight and transform work together", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      highlight: (line) => `\x1b[36m${line}\x1b[0m`,
      transform(state, event) {
        if (event.type === "insert" && event.char === "(") {
          const { lines, row, col } = state;
          const line = lines[row];
          return { lines: lines.with(row, line.slice(0, col) + ")" + line.slice(col)), row, col };
        }
      },
    });
    input.send("f(");
    input.send(KEY.ENTER);
    const [result] = await promise;
    expect(result).toBe("f()");
    const raw = output.chunks.join("");
    // Highlighted output should contain the ANSI-wrapped version
    expect(raw).toContain("\x1b[36m");
  });
});

// --- cancelRender option ---

describe("cancelRender", () => {
  let input: TTYInput & EventEmitter & { send: (data: string) => void };
  let output: ReturnType<typeof createNullOutput>;
  beforeEach(() => {
    input = createTTYInput();
    output = createNullOutput();
  });

  it("cancelRender default (clear): clears input on Ctrl+C", async () => {
    const promise = readMultiline("", { input, output: output.stream });
    input.send("hello");
    input.send(KEY.CTRL_C);
    await promise;
    const raw = output.chunks.join("");
    // Should contain clear sequence
    expect(raw).toContain("\r\x1b[J");
  });

  it("cancelRender preserve: re-renders with cancelled state on Ctrl+C", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: { pending: "? ", submitted: "✔ ", cancelled: "✖ " },
      theme: { cancelRender: "preserve" },
    });
    input.send("hello");
    input.send(KEY.CTRL_C);
    await promise;
    const raw = output.chunks.join("");
    // Should contain the cancelled prefix
    expect(raw).toContain("✖ ");
    // Should end with newline (preserve mode)
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("cancelRender preserve: applies cancelAnswer style and keeps input visible", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: { pending: "> ", submitted: "> " },
      theme: { cancelRender: "preserve", cancelAnswer: "dim" },
    });
    input.send("hello");
    input.send(KEY.CTRL_C);
    await promise;
    const raw = output.chunks.join("");
    // Input text should be present in the re-rendered output
    expect(raw).toContain("hello");
    // Should end with newline (preserve mode)
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("cancelRender preserve: falls back to pending prefix when cancelled not specified", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: { pending: "? ", submitted: "✔ " },
      theme: { cancelRender: "preserve" },
    });
    input.send("hello");
    input.send(KEY.CTRL_C);
    await promise;
    const raw = output.chunks.join("");
    // Should fall back to pending prefix "? "
    expect(raw).toContain("? ");
  });

  it("cancelRender preserve: returns cancel error with cancelled prefix rendered", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: { pending: "? ", submitted: "✔ ", cancelled: "✖ " },
      theme: { cancelRender: "preserve" },
    });
    input.send("hello");
    input.send(KEY.CTRL_C);
    const [value, error] = await promise;
    expect(value).toBe("hello");
    expect(error).toEqual({ kind: "cancel", message: "Input cancelled" });
    const raw = output.chunks.join("");
    // Should still render with cancelled prefix
    expect(raw).toContain("✖ ");
  });
});

// --- submitRender option ---

describe("submitRender", () => {
  let input: TTYInput & EventEmitter & { send: (data: string) => void };
  let output: ReturnType<typeof createNullOutput>;
  beforeEach(() => {
    input = createTTYInput();
    output = createNullOutput();
  });

  it("submitRender preserve: re-renders with submitted state prefix, linePrefix, and answer style", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: { pending: "? ", submitted: "✔ " },
      linePrefix: { pending: "| ", submitted: "  " },
      theme: { submitRender: "preserve", answer: "cyan" },
    });
    input.send("hello");
    input.send(KEY.ENTER);
    await promise;
    const raw = output.chunks.join("");
    // Should contain the submitted prefix
    expect(raw).toContain("✔ ");
    // Should contain the submitted linePrefix followed by input text
    expect(raw).toContain("  hello");
    // Should end with newline (preserve mode)
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("submitRender ellipsis: shows only first line with … for multi-line input", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: { pending: "? ", submitted: "✔ " },
      theme: { submitRender: "ellipsis" },
    });
    input.send("line1");
    input.send("\n"); // Ctrl+J newline
    input.send("line2");
    input.send("\n");
    input.send("line3");
    input.send(KEY.ENTER);
    await promise;
    const raw = output.chunks.join("");
    expect(raw).toContain("✔ ");
    expect(raw).toContain("line1");
    // Should contain ellipsis
    expect(raw).toContain("…");
    // Should NOT contain line2 or line3 after the final re-render
    // (they may appear during editing, but the last render should truncate)
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("submitRender ellipsis: shows single line without … for single-line input", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: { pending: "? ", submitted: "✔ " },
      theme: { submitRender: "ellipsis" },
    });
    input.send("hello");
    input.send(KEY.ENTER);
    await promise;
    const raw = output.chunks.join("");
    expect(raw).toContain("✔ ");
    expect(raw).toContain("hello");
    // The final re-render should NOT have ellipsis for single-line input
    // Check the portion after the last clear sequence
    const lastClearIdx = raw.lastIndexOf("\r\x1b[J");
    const afterClear = raw.slice(lastClearIdx);
    expect(afterClear).not.toContain("…");
  });

  it("submitRender number: shows up to N lines with … when truncated", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: { pending: "? ", submitted: "✔ " },
      theme: { submitRender: 2 },
    });
    input.send("line1");
    input.send("\n");
    input.send("line2");
    input.send("\n");
    input.send("line3");
    input.send("\n");
    input.send("line4");
    input.send(KEY.ENTER);
    await promise;
    const raw = output.chunks.join("");
    expect(raw).toContain("✔ ");
    // Should contain ellipsis since 4 lines > 2
    expect(raw).toContain("…");
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("submitRender number: shows all lines without … when under limit", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: { pending: "? ", submitted: "✔ " },
      theme: { submitRender: 3 },
    });
    input.send("line1");
    input.send("\n");
    input.send("line2");
    input.send(KEY.ENTER);
    await promise;
    const raw = output.chunks.join("");
    expect(raw).toContain("✔ ");
    const lastClearIdx = raw.lastIndexOf("\r\x1b[J");
    const afterClear = raw.slice(lastClearIdx);
    expect(afterClear).not.toContain("…");
  });
});

// --- cancelRender ellipsis/number ---

describe("cancelRender ellipsis/number", () => {
  let input: TTYInput & EventEmitter & { send: (data: string) => void };
  let output: ReturnType<typeof createNullOutput>;
  beforeEach(() => {
    input = createTTYInput();
    output = createNullOutput();
  });

  it("cancelRender ellipsis: shows only first line with … on cancel", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: { pending: "? ", submitted: "✔ ", cancelled: "✖ " },
      theme: { cancelRender: "ellipsis" },
    });
    input.send("line1");
    input.send("\n");
    input.send("line2");
    input.send(KEY.CTRL_C);
    await promise;
    const raw = output.chunks.join("");
    expect(raw).toContain("✖ ");
    expect(raw).toContain("…");
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("cancelRender number: shows up to N lines with … on cancel", async () => {
    const promise = readMultiline("", {
      input,
      output: output.stream,
      prefix: { pending: "? ", submitted: "✔ ", cancelled: "✖ " },
      theme: { cancelRender: 2 },
    });
    input.send("line1");
    input.send("\n");
    input.send("line2");
    input.send("\n");
    input.send("line3");
    input.send(KEY.CTRL_C);
    await promise;
    const raw = output.chunks.join("");
    expect(raw).toContain("✖ ");
    expect(raw).toContain("…");
    expect(raw.endsWith("\n")).toBe(true);
  });
});

// --- error visual state ---

describe("error visual state", () => {
  let input: TTYInput & EventEmitter & { send: (data: string) => void };
  let output: ReturnType<typeof createNullOutput>;
  beforeEach(() => {
    input = createTTYInput();
    output = createNullOutput();
  });

  it("switches prefix/linePrefix to error state on validation failure", async () => {
    const promise = readMultiline("msg", {
      input,
      output: output.stream,
      prefix: { pending: "? ", submitted: "✔ ", error: "! " },
      linePrefix: { pending: "| ", submitted: "  ", error: "x " },
      validate: (v) => (v.length < 3 ? "Too short" : undefined),
    });
    input.send("ab");
    input.send(KEY.ENTER); // validation fails → error state

    // Wait for the visual state change to render
    await new Promise((r) => setTimeout(r, 50));

    const rawAfterError = output.chunks.join("");
    // Error-state prefix and linePrefix should appear after validation failure
    expect(rawAfterError).toContain("! ");
    expect(rawAfterError).toContain("x ");

    input.send("c"); // now "abc"
    input.send(KEY.ENTER); // validation passes
    expect(await promise).toEqual(["abc", null]);
  });
});

describe("readMultiline (pipe mode)", () => {
  it("reads all lines until EOF from pipe input", async () => {
    const input = Readable.from(["line1\nline2\nline3\n"]) as TTYInput;
    input.isTTY = false;
    const { stream } = createNullOutput();
    expect(await readMultiline("", { input, output: stream })).toEqual([
      "line1\nline2\nline3",
      null,
    ]);
  });

  it("returns input without trailing newline from pipe", async () => {
    const input = Readable.from(["hello\nworld"]) as TTYInput;
    input.isTTY = false;
    const { stream } = createNullOutput();
    expect(await readMultiline("", { input, output: stream })).toEqual(["hello\nworld", null]);
  });

  it("returns empty string on immediate EOF from pipe", async () => {
    const input = Readable.from([]) as TTYInput;
    input.isTTY = false;
    const { stream } = createNullOutput();
    expect(await readMultiline("", { input, output: stream })).toEqual(["", null]);
  });

  it("handles pipe data split across multiple chunks", async () => {
    const input = Readable.from(["hel", "lo\nwor", "ld"]) as TTYInput;
    input.isTTY = false;
    const { stream } = createNullOutput();
    expect(await readMultiline("", { input, output: stream })).toEqual(["hello\nworld", null]);
  });
});

describe("createPrompt", () => {
  let input: ReturnType<typeof createTTYInput>;
  let output: ReturnType<typeof createNullOutput>;

  beforeEach(() => {
    input = createTTYInput();
    output = createNullOutput();
  });

  it("per-call options override shared config", async () => {
    const ask = createPrompt({ prefix: "shared> ", input, output: output.stream });
    const promise = ask("", { prefix: "override> " });
    input.send("hello");
    input.send(KEY.ENTER);
    await promise;
    const raw = output.chunks.join("");
    expect(raw).toContain("override> ");
  });

  it("shared config is not mutated by per-call options", async () => {
    const shared = { prefix: "shared> ", input, output: output.stream };
    const ask = createPrompt(shared);
    const promise = ask("", { prefix: "override> " });
    input.send(KEY.ENTER);
    await promise;
    expect(shared.prefix).toBe("shared> ");
  });

  it("uses shared config when no per-call options given", async () => {
    const ask = createPrompt({ prefix: "$ ", input, output: output.stream });
    const promise = ask("");
    input.send("test");
    input.send(KEY.ENTER);
    await promise;
    const raw = output.chunks.join("");
    expect(raw).toContain("$ ");
  });
});

describe("inlinePrompt option", () => {
  let input: ReturnType<typeof createTTYInput>;
  let output: ReturnType<typeof createNullOutput>;

  beforeEach(() => {
    input = createTTYInput();
    output = createNullOutput();
  });

  it("renders prompt and input on the same line", async () => {
    const promise = readMultiline("Name: ", {
      input,
      output: output.stream,
      prefix: "> ",
      inlinePrompt: true,
      clearAfterSubmit: false,
    });
    input.send("Tom");
    input.send(KEY.ENTER);
    const result = await promise;
    expect(result).toEqual(["Tom", null]);

    // After stripping VT control sequences, "Name: Tom" must appear as a
    // single uninterrupted (newline-free) segment. Using a single regex
    // gives an atomic "exists AND no newline between" assertion, guarding
    // against silent false positives when either substring is missing.
    const visible = stripVTControlCharacters(output.chunks.join(""));
    expect(visible).toMatch(/Name: Tom/);
  });

  it("works with submitRender: preserve", async () => {
    const promise = readMultiline("Name:", {
      input,
      output: output.stream,
      prefix: "> ",
      inlinePrompt: true,
      theme: { submitRender: "preserve" as const },
    });
    input.send("Alice");
    input.send(KEY.ENTER);
    const result = await promise;
    expect(result).toEqual(["Alice", null]);
  });

  it("renders second line with linePrefix", async () => {
    const promise = readMultiline("Bio:", {
      input,
      output: output.stream,
      prefix: "> ",
      linePrefix: "  ",
      inlinePrompt: true,
      clearAfterSubmit: false,
    });
    input.send("Line1");
    input.send(KEY.SHIFT_ENTER); // Insert newline
    input.send("Line2");
    input.send(KEY.ENTER);
    const result = await promise;
    expect(result).toEqual(["Line1\nLine2", null]);

    // Strip VT control sequences to inspect visible text and assert that the
    // configured linePrefix ("  ") precedes the second line. This guards against
    // regressions where inlinePrompt accidentally suppresses prefixes for
    // subsequent lines.
    const visible = stripVTControlCharacters(output.chunks.join(""));
    expect(visible).toContain("Line1");
    expect(visible).toContain("Line2");
    expect(visible).toMatch(/Line1[\s\S]*?\n {2}Line2/);
  });

  it("throws when inlinePrompt is used with a multi-line prompt", async () => {
    await expect(
      readMultiline("Question\nline2:", {
        input,
        output: output.stream,
        prefix: "> ",
        inlinePrompt: true,
      }),
    ).rejects.toThrow(/single-line/);
  });

  it("throws when a non-pending Stateful prefix variant contains a newline", async () => {
    // Only the submitted variant has a newline. If we validated just the
    // pending state, this call would pass and later break renderStateChange.
    await expect(
      readMultiline("Name: ", {
        input,
        output: output.stream,
        prefix: { pending: "> ", submitted: "✔\n" },
        inlinePrompt: true,
      }),
    ).rejects.toThrow(/single-line/);
  });

  it("merges lines correctly when backspacing at the start of the second line", async () => {
    const promise = readMultiline("Name:", {
      input,
      output: output.stream,
      prefix: "> ",
      linePrefix: "  ",
      inlinePrompt: true,
      clearAfterSubmit: false,
    });
    input.send("Hello");
    input.send(KEY.SHIFT_ENTER);
    input.send("World");
    // Cursor is at end of "World" on row 1; move to start of row 1 and backspace to merge.
    input.send(KEY.HOME);
    input.send(KEY.BACKSPACE);
    input.send(KEY.ENTER);
    const result = await promise;
    expect(result).toEqual(["HelloWorld", null]);
  });

  it("preserves the inline display across undo/redo without duplicating the prompt header", async () => {
    const promise = readMultiline("Name:", {
      input,
      output: output.stream,
      prefix: "> ",
      inlinePrompt: true,
      clearAfterSubmit: false,
    });
    input.send("AB");
    input.send(KEY.SHIFT_ENTER);
    input.send("CD");
    input.send(KEY.CTRL_Z); // undo
    input.send(KEY.CTRL_Y); // redo
    input.send(KEY.ENTER);
    const result = await promise;
    expect(result[1]).toBeNull();

    // With clearAfterSubmit:false (preserve mode), the prompt header is emitted at
    // initialization and once more by renderStateChange on submit. Any additional
    // occurrences would indicate a regression in restoreSnapshot / redrawFrom where
    // the inline header gets re-emitted mid-edit.
    const visible = stripVTControlCharacters(output.chunks.join(""));
    const occurrences = visible.match(/Name:/g)?.length ?? 0;
    expect(occurrences).toBeLessThanOrEqual(2);
  });

  it("redraws correctly after Ctrl+L clearScreen", async () => {
    const promise = readMultiline("Name:", {
      input,
      output: output.stream,
      prefix: "> ",
      inlinePrompt: true,
      clearAfterSubmit: false,
    });
    input.send("Tom");
    input.send(KEY.CTRL_L); // triggers fullRedraw inline path
    input.send(KEY.ENTER);
    const result = await promise;
    expect(result).toEqual(["Tom", null]);
  });

  it("renders linePrefix on submitted output with preserve mode", async () => {
    const promise = readMultiline("Bio:", {
      input,
      output: output.stream,
      prefix: "> ",
      linePrefix: "  ",
      inlinePrompt: true,
      theme: { submitRender: "preserve" as const },
    });
    input.send("Line1");
    input.send(KEY.SHIFT_ENTER);
    input.send("Line2");
    input.send(KEY.ENTER);
    const result = await promise;
    expect(result).toEqual(["Line1\nLine2", null]);

    // After renderStateChange, the second line should still be prefixed by the
    // configured linePrefix in the final post-submit output.
    const visible = stripVTControlCharacters(output.chunks.join(""));
    // Look for the final submitted block: "Bio:Line1\n  Line2"
    expect(visible).toMatch(/Bio:[^\n]*Line1\n {2}Line2/);
  });

  it("transitions to error state without losing linePrefix on subsequent lines", async () => {
    const promise = readMultiline("Name:", {
      input,
      output: output.stream,
      prefix: "> ",
      linePrefix: "  ",
      inlinePrompt: true,
      clearAfterSubmit: false,
      validate: (v) => (v.includes("bad") ? "nope" : null),
    });
    input.send("ok");
    input.send(KEY.SHIFT_ENTER);
    input.send("bad");
    input.send(KEY.ENTER); // triggers validation error → setVisualState("error")
    // Recover: delete "bad" → "ba" is fine, clear error on next submit
    input.send(KEY.BACKSPACE);
    input.send(KEY.BACKSPACE);
    input.send(KEY.BACKSPACE);
    input.send("fine");
    input.send(KEY.ENTER);
    const result = await promise;
    expect(result).toEqual(["ok\nfine", null]);

    // Error-state redraw must not strip the linePrefix from the second line.
    const visible = stripVTControlCharacters(output.chunks.join(""));
    expect(visible).toMatch(/ok[\s\S]*?\n {2}/);
  });

  it("transitions the prefix from pending to submitted in inline mode (PR Behavior)", async () => {
    // Inline mode concatenates `prefix + prompt + input` verbatim, so the
    // prompt string itself carries the trailing space that separates the
    // prompt from the input in the rendered output.
    const promise = readMultiline("Enter your name: ", {
      input,
      output: output.stream,
      prefix: { pending: "> ", submitted: "✔ " },
      inlinePrompt: true,
      theme: { submitRender: "preserve" as const },
    });
    input.send("Tom");
    input.send(KEY.ENTER);
    const result = await promise;
    expect(result).toEqual(["Tom", null]);

    // After submit with preserve mode, the final rendered line should read
    // "✔ Enter your name: Tom" — matching the "After submit" behavior in the
    // PR description. Strip VT control sequences to compare visible text only.
    const visible = stripVTControlCharacters(output.chunks.join(""));
    expect(visible).toContain("✔ Enter your name: Tom");
    // And the submitted block must use the ✔ prefix (the pending "> " prefix
    // may still appear earlier in the stream from the pre-submit render).
    expect(visible).toMatch(/✔ Enter your name: [^\n]*Tom/);
  });
});
