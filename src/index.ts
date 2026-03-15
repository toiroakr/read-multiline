import { stringWidth } from "./chars.js";
import { handleDelete } from "./editing.js";
import { buildHelpFooter, detectKittyProtocol } from "./footer.js";
import { appendHistory, loadHistory, saveHistory } from "./history.js";
import { buildKeyMap, onData } from "./input.js";
import * as presets from "./presets/index.js";
import { clearBelowEditor, clearScreen, setFooter, setStatus, tCol, w } from "./rendering.js";
import { applyStyle, buildPromptHeader, buildStyledLinePrefix, resolveStateful } from "./style.js";
import type {
  EditorState,
  HistoryOptions,
  PromptTheme,
  ReadMultilineOptions,
  ReadMultilineResult,
  SharedConfig,
  Stateful,
  TTYInput,
} from "./types.js";
export type {
  CancelError,
  EOFError,
  HelpFooterAction,
  HelpFooterDisplayOptions,
  HistoryOptions,
  ModifiedEnterKey,
  PromptTheme,
  ReadMultilineError,
  ReadMultilineOptions,
  ReadMultilineResult,
  SharedConfig,
  Stateful,
  StyleTextFormat,
  TTYInput,
} from "./types.js";
export { presets };

/**
 * Create a reusable prompt function with shared configuration.
 * Per-call options are shallow-merged over the shared config.
 *
 * @example
 * ```typescript
 * const ask = createPrompt({ prefix: "? ", theme: { prompt: "bold" } });
 * const name = await ask({ prompt: "Name:" });
 * const email = await ask({ prompt: "Email:" });
 * ```
 */
export function createPrompt(
  shared: SharedConfig,
): (options?: ReadMultilineOptions) => Promise<ReadMultilineResult> {
  return (options: ReadMultilineOptions = {}): Promise<ReadMultilineResult> => {
    return readMultiline({ ...shared, ...options });
  };
}

/**
 * Read multi-line input from the terminal.
 *
 * Key bindings (default, submitOnEnter=true):
 * - Enter: Submit input
 * - Shift+Enter / Ctrl+Enter / Cmd+Enter / Alt+Enter / Ctrl+J: Insert newline
 * - Backspace: Delete character (can merge lines)
 * - Delete: Forward delete character (can merge lines)
 * - Ctrl+U: Delete to line start
 * - Ctrl+K: Delete to line end
 * - Left/Right: Cursor movement (crosses line boundaries)
 * - Up/Down: Move between lines (history at boundaries)
 * - Alt+Left/Right: Word jump
 * - Cmd+Left/Right (Home/End): Jump to line start/end
 * - Cmd+Up/Down: Jump to start/end of entire input
 * - Ctrl+C: Cancel (returns [null, { kind: "cancel" }])
 * - Ctrl+D: Delete character at cursor (same as Delete key), EOF if empty (returns [null, { kind: "eof" }])
 * - Ctrl+L: Clear screen and redraw
 * - Ctrl+Z: Undo
 * - Ctrl+Shift+Z / Ctrl+Y: Redo
 * - Ctrl+W: Delete previous word
 *
 * Shift+Enter and Cmd+Arrow detection uses the kitty keyboard protocol.
 * Supported terminals: kitty, iTerm2, WezTerm, Ghostty, foot, etc.
 *
 * For non-TTY input (pipes), reads all lines until EOF.
 */
export function readMultiline(options: ReadMultilineOptions = {}): Promise<ReadMultilineResult> {
  const { input = process.stdin as TTYInput, output = process.stdout } = options;

  if (!input.isTTY) {
    return readFromPipe(input);
  }

  return readFromTTY(input, output, options);
}

function readFromPipe(input: NodeJS.ReadableStream): Promise<ReadMultilineResult> {
  return new Promise((resolve) => {
    let data = "";
    input.on("data", (chunk: Buffer | string) => {
      data += typeof chunk === "string" ? chunk : chunk.toString();
    });
    input.on("end", () => {
      resolve([data.endsWith("\n") ? data.slice(0, -1) : data, null]);
    });
  });
}

function readFromTTY(
  input: TTYInput,
  output: NodeJS.WritableStream,
  options: ReadMultilineOptions,
): Promise<ReadMultilineResult> {
  return new Promise((resolve) => {
    const {
      prefix: prefixOption = "> ",
      prompt: rawPrompt = "",
      linePrefix: linePrefixOption,
      theme,
      initialValue,
      history: historyOption,
      historyArrowNavigation = "single",
      maxLines,
      maxLength,
      validate,
      validateDebounceMs = 300,
      submitOnEnter = true,
      disabledKeys = [],
      footer,
      clearAfterSubmit = true,
      helpFooter = true,
    } = options;

    // Resolve linePrefix: defaults to prefix
    const resolvedLinePrefixOption: Stateful<string> = linePrefixOption ?? prefixOption;

    // Build pending-state prompt header and line prefix
    const promptHeader = buildPromptHeader(prefixOption, rawPrompt, theme, "pending");
    const hasPromptHeader = resolveStateful(prefixOption, "pending") !== "" || rawPrompt !== "";
    const styledLinePrefix = buildStyledLinePrefix(resolvedLinePrefixOption, theme, "pending");
    const rawLinePrefix = resolveStateful(resolvedLinePrefixOption, "pending");
    const linePrefixWidth = stringWidth(rawLinePrefix);

    const historyConfig: HistoryOptions | undefined =
      historyOption && !Array.isArray(historyOption) ? historyOption : undefined;
    const historyEntries = Array.isArray(historyOption)
      ? historyOption
      : historyConfig?.filePath
        ? loadHistory(historyConfig.filePath, historyConfig.maxEntries ?? 100)
        : [];

    const state: EditorState = {
      lines: [""],
      row: 0,
      col: 0,
      output,
      promptHeader,
      promptHeaderHeight: hasPromptHeader ? 1 : 0,
      styledLinePrefix,
      linePrefixWidth,
      theme,
      prefixOption,
      linePrefixOption: resolvedLinePrefixOption,
      rawPrompt,
      statusText: "",
      statusColor: "",
      footerText: applyStyle(footer ?? "", theme?.footer),
      rebuildFooter: null,
      history: [...historyEntries],
      historyIndex: historyEntries.length,
      draft: initialValue ?? "",
      historyArrowNavigation,
      historyArrowAttempt: 0,
      undoStack: [],
      redoStack: [],
      lastEditType: "",
      validationActive: false,
      validateTimer: null,
      isPasting: false,
      escBuffer: "",
      escTimer: null,
      maxLines,
      maxLength,
      validate,
      validateDebounceMs,
      submitOnEnter,
      disabledKeys: new Set(disabledKeys),
      keyMap: {},
      buffering: false,
      writeBuffer: "",
    };

    // --- Resize handling ---

    let resizeHandler: (() => void) | null = null;
    const ttyOutput = output as NodeJS.WriteStream;
    if (typeof ttyOutput.on === "function" && "columns" in ttyOutput) {
      resizeHandler = () => {
        if (state.rebuildFooter) {
          state.footerText = state.rebuildFooter(ttyOutput.columns);
        }
        clearScreen(state);
      };
      ttyOutput.on("resize", resizeHandler);
    }

    let active = true;

    function cleanup() {
      active = false;
      if (state.escTimer) {
        clearTimeout(state.escTimer);
        state.escTimer = null;
      }
      if (state.validateTimer) {
        clearTimeout(state.validateTimer);
        state.validateTimer = null;
      }
      if (resizeHandler && typeof ttyOutput.removeListener === "function") {
        ttyOutput.removeListener("resize", resizeHandler);
      }
      clearBelowEditor(state);
      w(state, "\x1b[?2004l"); // Disable bracketed paste mode
      w(state, "\x1b[<u"); // Disable kitty protocol
      input.setRawMode?.(false);
      input.removeListener("data", dataHandler);
      input.pause();
    }

    // Determine submitRender mode
    const submitRender: "clear" | "preserve" =
      theme?.submitRender ?? (clearAfterSubmit ? "clear" : "preserve");

    function submit() {
      if (validate) {
        const error = validate(state.lines.join("\n"));
        if (error) {
          state.validationActive = true;
          setStatus(state, error, "red");
          return;
        }
      }
      const result = state.lines.join("\n");

      if (submitRender === "clear") {
        // Clear editor + prompt header + status + footer
        const upCount = state.row + state.promptHeaderHeight;
        if (upCount > 0) w(state, `\x1b[${upCount}A`);
        w(state, "\r\x1b[J");
        state.statusText = "";
        state.statusColor = "";
        state.footerText = "";
        state.row = 0;
        state.col = 0;
      } else {
        // preserve: re-render with submitted state
        renderSubmitted(state, theme);
      }

      cleanup();
      if (submitRender !== "clear") {
        w(state, "\n");
      }
      if (historyConfig?.filePath) {
        const maxEntries = historyConfig.maxEntries ?? 100;
        const updated = appendHistory(state.history, result, maxEntries);
        saveHistory(historyConfig.filePath, updated);
      }
      resolve([result, null]);
    }

    function handleEOF() {
      const content = state.lines.join("\n");
      if (content.length === 0) {
        cleanup();
        w(state, "\n");
        resolve([null, { kind: "eof", message: "EOF received on empty input" }]);
      } else {
        handleDelete(state);
      }
    }

    function cancel() {
      cleanup();
      w(state, "\n");
      resolve([null, { kind: "cancel", message: "Input cancelled" }]);
    }

    // Build key map
    buildKeyMap(state, submit, cancel, handleEOF);

    // --- Initialization ---

    // Draw prompt header line
    if (hasPromptHeader) {
      w(state, promptHeader);
      w(state, "\n");
    }

    // Draw first input line with linePrefix
    w(state, styledLinePrefix);

    if (initialValue) {
      const initLines = initialValue.split("\n");
      state.lines.length = 0;
      state.lines.push(...initLines);
      w(state, initLines[0]);
      for (let i = 1; i < initLines.length; i++) {
        w(state, "\n" + styledLinePrefix + initLines[i]);
      }
      state.row = initLines.length - 1;
      state.col = initLines[state.row].length;
    }

    if (footer) {
      const styledFooter = applyStyle(footer, theme?.footer);
      const endRow = state.lines.length - 1;
      const dr = endRow - state.row;
      if (dr > 0) w(state, `\x1b[${dr}B`);
      const footerLines = styledFooter.split("\n");
      for (const line of footerLines) {
        w(state, "\r\n" + line + "\x1b[K");
      }
      const upCount = endRow + footerLines.length - state.row;
      if (upCount > 0) w(state, `\x1b[${upCount}A`);
      w(state, `\x1b[${tCol(state, state.row, state.col)}G`);
    }

    input.setRawMode?.(true);
    input.resume();
    w(state, "\x1b[>1u"); // Enable kitty keyboard protocol
    w(state, "\x1b[?2004h"); // Enable bracketed paste mode

    // helpFooter: auto-generated key bindings help, shown after kitty detection
    // Must run after raw mode is enabled so the terminal can respond to the query
    if (helpFooter) {
      const helpOpts = typeof helpFooter === "object" ? helpFooter : {};
      const customFooter = applyStyle(footer ?? "", theme?.footer);

      const buildFooterForColumns = (cols: number): string => {
        const helpText = buildHelpFooter({
          ...helpOpts,
          submitOnEnter,
          disabledKeys,
          columns: cols,
        });
        if (!customFooter) return helpText;
        if (!helpText) return customFooter;
        return customFooter + "\n" + helpText;
      };

      const ttyOut = output as NodeJS.WriteStream;
      detectKittyProtocol(input, output).then(() => {
        if (!active) return;
        const columns = ("columns" in ttyOut && ttyOut.columns) || 80;
        state.rebuildFooter = buildFooterForColumns;
        setFooter(state, buildFooterForColumns(columns));
      });
    }

    function dataHandler(data: Buffer) {
      onData(state, data);
    }

    input.on("data", dataHandler);
  });
}

/** Re-render the editor in submitted state with updated prefix/linePrefix and styles */
function renderSubmitted(state: EditorState, theme: PromptTheme | undefined): void {
  // Move to top of editor (input lines + prompt header)
  const upCount = state.row + state.promptHeaderHeight;
  if (upCount > 0) w(state, `\x1b[${upCount}A`);
  w(state, "\r\x1b[J");

  // Rebuild prompt header and line prefix in submitted state
  const submittedHeader = buildPromptHeader(
    state.prefixOption,
    state.rawPrompt,
    theme,
    "submitted",
  );
  const submittedLinePrefix = buildStyledLinePrefix(state.linePrefixOption, theme, "submitted");

  // Draw submitted prompt header
  if (state.promptHeaderHeight > 0) {
    w(state, submittedHeader);
    w(state, "\n");
  }

  // Draw input lines with submitted line prefix and answer style
  for (let i = 0; i < state.lines.length; i++) {
    if (i > 0) w(state, "\n");
    w(state, submittedLinePrefix + applyStyle(state.lines[i], theme?.answer));
  }

  // Reset state for cleanup
  state.statusText = "";
  state.statusColor = "";
  state.footerText = "";
  state.row = state.lines.length - 1;
  state.col = state.lines[state.row].length;
}
