import { stringWidth } from "./chars.js";
import { handleDelete } from "./editing.js";
import { buildHelpFooter, detectKittyProtocol } from "./footer.js";
import { appendHistory, loadHistory, saveHistory } from "./history.js";
import { buildKeyMap, onData } from "./input.js";
import * as presets from "./presets/index.js";
import {
  clearBelowEditor,
  clearScreen,
  setFooter,
  setStatusWithVisualState,
  tCol,
  w,
} from "./rendering.js";
import {
  applyStyle,
  buildPromptHeader,
  buildStyledLinePrefix,
  computeHeaderHeight,
  resolveStateful,
} from "./style.js";
import type {
  EditorState,
  HistoryOptions,
  PromptTheme,
  ReadMultilineError,
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
 * const [name] = await ask("Name:");
 * const [email] = await ask("Email:");
 * ```
 */
export function createPrompt(
  shared: SharedConfig,
): (prompt: string, options?: ReadMultilineOptions) => Promise<ReadMultilineResult> {
  return (prompt: string, options: ReadMultilineOptions = {}): Promise<ReadMultilineResult> => {
    return readMultiline(prompt, { ...shared, ...options });
  };
}

/**
 * Read multi-line input from the terminal.
 *
 * Key bindings (default, preferNewlineOnEnter=false):
 * - Enter: Submit input
 * - Shift+Enter / Ctrl+Enter / Cmd+Enter / Alt+Enter: Insert newline
 * - Ctrl+J: Always insert newline (regardless of preferNewlineOnEnter)
 * - Backspace: Delete character (can merge lines)
 * - Delete: Forward delete character (can merge lines)
 * - Ctrl+U: Delete to line start
 * - Ctrl+K: Delete to line end
 * - Left/Right: Cursor movement (crosses line boundaries)
 * - Up/Down: Move between lines (history at boundaries)
 * - Alt+Left/Right: Word jump
 * - Cmd+Left/Right (Home/End): Jump to line start/end
 * - Cmd+Up/Down: Jump to start/end of entire input
 * - Ctrl+C: Cancel (returns [null, { kind: "cancel" }], or [input, error] if onError is set)
 * - Ctrl+D: Delete character at cursor (same as Delete key), EOF if empty (returns [null, { kind: "eof" }], or [input, error] if onError is set)
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
export function readMultiline(
  prompt: string,
  options?: ReadMultilineOptions,
): Promise<ReadMultilineResult> {
  const { input = process.stdin as TTYInput, output = process.stdout } = options ?? {};

  if (!input.isTTY) {
    return readFromPipe(input);
  }

  return readFromTTY(input, output, prompt, options ?? {});
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
  prompt: string,
  options: ReadMultilineOptions,
): Promise<ReadMultilineResult> {
  return new Promise((resolve) => {
    const rawPrompt = prompt;
    const {
      prefix: prefixOption = "> ",
      linePrefix: linePrefixOption,
      theme,
      initialValue,
      history: historyOption,
      historyArrowNavigation = "single",
      maxLines,
      maxLength,
      validate,
      validateDebounceMs = 300,
      preferNewlineOnEnter = false,
      clearAfterSubmit = true,
      disabledKeys = [],
      footer,
      helpFooter = true,
    } = options;

    // Resolve linePrefix: defaults to prefix
    const resolvedLinePrefixOption: Stateful<string> = linePrefixOption ?? prefixOption;

    // Build pending-state prompt header and line prefix
    const promptHeader = buildPromptHeader(prefixOption, rawPrompt, theme, "pending");
    const promptHeaderHeight = computeHeaderHeight(promptHeader);
    const styledLinePrefix = buildStyledLinePrefix(resolvedLinePrefixOption, theme, "pending");
    const rawLinePrefix = resolveStateful(resolvedLinePrefixOption, "pending");
    const linePrefixWidth = stringWidth(rawLinePrefix);

    const styledFooter = applyStyle(footer ?? "", theme?.footer);

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
      promptHeaderHeight,
      styledLinePrefix,
      linePrefixWidth,
      visualState: "pending" as const,
      theme,
      prefixOption,
      linePrefixOption: resolvedLinePrefixOption,
      rawPrompt,
      statusText: "",
      statusColor: "",
      footerText: styledFooter,
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
      preferNewlineOnEnter,
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

    // Determine submitRender and cancelRender modes
    const submitRender: "clear" | "preserve" =
      theme?.submitRender ?? (clearAfterSubmit ? "clear" : "preserve");
    const cancelRender: "clear" | "preserve" = theme?.cancelRender ?? "clear";

    /** Erase all editor content (prompt header + input lines + status + footer) from the terminal */
    function clearEditorArea() {
      const upCount = state.row + state.promptHeaderHeight;
      if (upCount > 0) w(state, `\x1b[${upCount}A`);
      w(state, "\r\x1b[J");
      state.statusText = "";
      state.statusColor = "";
      state.footerText = "";
      state.row = 0;
      state.col = 0;
    }

    function submit() {
      if (validate) {
        const error = validate(state.lines.join("\n"));
        if (error) {
          state.validationActive = true;
          setStatusWithVisualState(state, error, "red", "error");
          return;
        }
      }
      const result = state.lines.join("\n");

      if (submitRender === "clear") {
        clearEditorArea();
      } else {
        renderStateChange(state, theme, "submitted");
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

    function resolveWithError(defaultError: ReadMultilineError): void {
      if (options.onError) {
        const result = options.onError(defaultError);
        const error = result ?? defaultError;
        resolve([state.lines.join("\n"), error] as ReadMultilineResult);
      } else {
        resolve([null, defaultError]);
      }
    }

    function handleEOF() {
      const content = state.lines.join("\n");
      if (content.length === 0) {
        cleanup();
        w(state, "\n");
        resolveWithError({ kind: "eof", message: "EOF received on empty input" });
      } else {
        handleDelete(state);
      }
    }

    function cancel() {
      if (cancelRender === "preserve") {
        renderStateChange(state, theme, "cancelled");
      } else {
        clearEditorArea();
      }

      cleanup();
      if (cancelRender !== "clear") {
        w(state, "\n");
      }
      resolveWithError({ kind: "cancel", message: "Input cancelled" });
    }

    // Build key map
    buildKeyMap(state, submit, cancel, handleEOF);

    // --- Initialization ---

    // Draw prompt header line
    if (promptHeaderHeight > 0) {
      w(state, promptHeader);
      w(state, "\n");
    }

    // Draw first input line with linePrefix
    w(state, styledLinePrefix);

    if (initialValue) {
      const initLines = initialValue.split("\n");
      state.lines.length = 0;
      state.lines.push(...initLines);
      w(state, applyStyle(initLines[0], theme?.input));
      for (let i = 1; i < initLines.length; i++) {
        w(state, "\n" + styledLinePrefix + applyStyle(initLines[i], theme?.input));
      }
      state.row = initLines.length - 1;
      state.col = initLines[state.row].length;
    }

    if (footer) {
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

      const buildFooterForColumns = (cols: number): string => {
        const helpText = buildHelpFooter({
          ...helpOpts,
          preferNewlineOnEnter: state.preferNewlineOnEnter,
          disabledKeys,
          columns: cols,
        });
        if (!styledFooter) return helpText;
        if (!helpText) return styledFooter;
        return styledFooter + "\n" + helpText;
      };

      const ttyOut = output as NodeJS.WriteStream;
      detectKittyProtocol(input, output).then((kittySupported) => {
        if (!active) return;
        // Fall back to preferNewlineOnEnter=false when kitty is not supported,
        // ensuring Enter=submit and Ctrl+J=newline are always available.
        // Without kitty, modified Enter keys (Shift/Ctrl/Cmd+Enter) don't work,
        // leaving only Alt+Enter for submit — which requires "Use Option as Meta key"
        // on macOS Terminal.app and may not work in all environments.
        if (!kittySupported && state.preferNewlineOnEnter) {
          state.preferNewlineOnEnter = false;
          state.keyMap = {};
          buildKeyMap(state, submit, cancel, handleEOF);
        }
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

/** Re-render the editor in submitted or cancelled state with updated prefix/linePrefix and styles */
function renderStateChange(
  state: EditorState,
  theme: PromptTheme | undefined,
  renderState: "submitted" | "cancelled",
): void {
  // Move to top of editor (input lines + prompt header)
  const upCount = state.row + state.promptHeaderHeight;
  if (upCount > 0) w(state, `\x1b[${upCount}A`);
  w(state, "\r\x1b[J");

  // Rebuild prompt header and line prefix for the target state
  const header = buildPromptHeader(state.prefixOption, state.rawPrompt, theme, renderState);
  const headerHeight = computeHeaderHeight(header);
  const linePrefix = buildStyledLinePrefix(state.linePrefixOption, theme, renderState);

  // Choose answer style based on state
  const answerStyle =
    renderState === "cancelled" ? (theme?.cancelAnswer ?? theme?.answer) : theme?.answer;

  // Draw prompt header
  if (headerHeight > 0) {
    w(state, header);
    w(state, "\n");
  }

  // Draw input lines with line prefix and answer style
  for (let i = 0; i < state.lines.length; i++) {
    if (i > 0) w(state, "\n");
    w(state, linePrefix + applyStyle(state.lines[i], answerStyle));
  }

  // Reset state for cleanup
  state.statusText = "";
  state.statusColor = "";
  state.footerText = "";
  state.row = state.lines.length - 1;
  state.col = state.lines[state.row].length;
}
