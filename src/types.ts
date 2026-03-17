import type { styleText } from "node:util";

export type StyleTextFormat = Parameters<typeof styleText>[0];

/** A value that can vary between pending (editing), submitted, cancelled, and error states */
export type Stateful<T> = T | { pending: T; submitted: T; cancelled?: T; error?: T };

/** Theme configuration for styling prompt elements */
export interface PromptTheme {
  /** Style for the prefix text */
  prefix?: Stateful<StyleTextFormat>;
  /** Style for the line prefix text */
  linePrefix?: Stateful<StyleTextFormat>;
  /** Style for the prompt message text */
  prompt?: StyleTextFormat;
  /** Style for user input text while editing */
  input?: StyleTextFormat;
  /** Style for the answer text after submission */
  answer?: StyleTextFormat;
  /** Style for the answer text after cancellation (e.g. ["strikethrough", "dim"] for clack) */
  cancelAnswer?: StyleTextFormat;

  /**
   * How to render the prompt after submission.
   * - "clear": erase the prompt and input from the terminal (default)
   * - "preserve": re-render with submitted-state prefix/linePrefix and styles
   */
  submitRender?: "clear" | "preserve";

  /**
   * How to render the prompt after cancellation (Ctrl+C).
   * - "clear": erase the prompt and input from the terminal (default)
   * - "preserve": re-render with cancelled-state prefix/linePrefix and styles
   */
  cancelRender?: "clear" | "preserve";

  /** Style for validation error messages */
  error?: StyleTextFormat;
  /** Style for validation success messages */
  success?: StyleTextFormat;
  /** Style for footer text */
  footer?: StyleTextFormat;
}

/** Error returned when the user cancels input with Ctrl+C. */
export interface CancelError {
  kind: "cancel";
  message: "Input cancelled";
}

/** Error returned when Ctrl+D is pressed on empty input. */
export interface EOFError {
  kind: "eof";
  message: "EOF received on empty input";
}

/** Union of errors that readMultiline can return. */
export type ReadMultilineError = CancelError | EOFError;

/**
 * Result tuple:
 * - `[string, null]` on success
 * - `[null, ReadMultilineError]` on cancel/EOF without `onError`
 * - `[string, unknown]` on cancel/EOF with `onError` (callback return overrides error)
 */
export type ReadMultilineResult = [string, null] | [null, ReadMultilineError] | [string, unknown];

export interface ReadMultilineOptions {
  /** Prefix displayed before the prompt message (default: "> "). Can be state-dependent. */
  prefix?: Stateful<string>;

  /** Prefix displayed on each input line (default: prefix value). Can be state-dependent. */
  linePrefix?: Stateful<string>;

  /** Theme for styling prompt elements */
  theme?: PromptTheme;

  /** Input stream (default: process.stdin) */
  input?: TTYInput;

  /** Output stream (default: process.stdout) */
  output?: NodeJS.WritableStream;

  /** Initial value to pre-populate the input */
  initialValue?: string;

  /**
   * History entries (oldest first) or history options with file persistence.
   * - `string[]`: in-memory history entries
   * - `HistoryOptions`: file-based persistent history
   */
  history?: string[] | HistoryOptions;

  /**
   * How Up/Down arrow keys interact with history at boundaries (default: "single").
   * - "single": at boundary, one press triggers history navigation
   * - "double": at boundary, two consecutive presses trigger history navigation
   * - "disabled": Up/Down never triggers history (use dedicated keys instead)
   */
  historyArrowNavigation?: "single" | "double" | "disabled";

  /** Maximum number of lines allowed */
  maxLines?: number;

  /** Maximum total character count allowed */
  maxLength?: number;

  /** Validation function. Return an error message string to reject, or undefined/null to accept. */
  validate?: (value: string) => string | undefined | null;

  /** Debounce interval (ms) for live validation after first submit failure (default: 300) */
  validateDebounceMs?: number;

  /**
   * Whether Enter inserts a newline instead of submitting (default: false).
   * - false: Enter=submit, modified Enter (Shift/Ctrl/Cmd/Alt+Enter)=newline
   * - true: Enter=newline, modified Enter=submit
   *
   * Ctrl+J (0x0A) always inserts a newline regardless of this setting.
   * Shift+Enter, Ctrl+Enter, Cmd+Enter require the kitty keyboard protocol.
   * When kitty protocol is not supported, this option falls back to false
   * to ensure Enter=submit and Ctrl+J=newline are always available.
   */
  preferNewlineOnEnter?: boolean;

  /**
   * Key combinations to disable.
   * Disabled keys are ignored (neither submit nor newline).
   */
  disabledKeys?: ModifiedEnterKey[];

  /** Fixed footer text displayed below the editor. Appears below the status line. */
  footer?: string;

  /**
   * Whether to clear the input from the terminal after submission (default: true).
   * - true: input is erased from the terminal after submit
   * - false: input remains visible in the terminal after submit
   * @deprecated Use `theme.submitRender` instead ("clear" or "preserve")
   */
  clearAfterSubmit?: boolean;

  /**
   * Callback invoked on Ctrl+C (cancel) or Ctrl+D on empty input (EOF).
   * Receives the error as an argument. When provided, the promise resolves
   * with [value, error] (current input + error) instead of [null, error].
   * If the callback returns a non-undefined value, it replaces the error in the result tuple.
   */
  onError?: (error: ReadMultilineError) => unknown;

  /**
   * Auto-generated help footer showing key bindings.
   * Displayed below the custom footer (if any), after kitty protocol detection completes.
   * - true: show with default options
   * - object: customize display (maxKeysPerAction, maxLines, style, keyStyle)
   *
   * Terminal width (columns) is auto-calculated from the output stream.
   * preferNewlineOnEnter and disabledKeys are inherited from the parent options.
   */
  helpFooter?: boolean | HelpFooterDisplayOptions;
}

/** Built-in action names available for the help footer items configuration. */
export type HelpFooterAction =
  | "submit"
  | "newline"
  | "undo"
  | "redo"
  | "cancel"
  | "eof"
  | "history"
  | "word-jump"
  | "line-start"
  | "line-end"
  | "delete-word"
  | "delete-to-start"
  | "delete-to-end"
  | "clear-screen";

/** Display options for the auto-generated help footer showing key bindings. */
export interface HelpFooterDisplayOptions {
  /** Actions to display and their order (default: ["submit", "newline", "undo", "cancel", "eof"]) */
  items?: HelpFooterAction[];
  /** Maximum number of key alternatives shown per action (default: 2) */
  maxKeysPerAction?: number;
  /** Maximum number of lines to display (default: unlimited) */
  maxLines?: number;
  /** Overall text style applied via `node:util` styleText (default: "dim") */
  style?: StyleTextFormat;
  /** Style for key labels like "Enter", "Ctrl+Z" (default: none) */
  keyStyle?: StyleTextFormat;
}

/** Key combinations that can be used as modified Enter keys. These can be disabled via the disabledKeys option. */
export type ModifiedEnterKey = "shift+enter" | "ctrl+enter" | "cmd+enter" | "alt+enter" | "ctrl+j";

/** Options for file-based persistent history */
export interface HistoryOptions {
  /** File path for persistent storage (JSON format) */
  filePath: string;
  /** Maximum number of entries to keep (default: 100) */
  maxEntries?: number;
}

/** A readable stream with optional TTY capabilities for character-by-character raw mode input. */
export interface TTYInput extends NodeJS.ReadableStream {
  isTTY?: boolean;
  setRawMode?(mode: boolean): void;
}

export interface Snapshot {
  lines: string[];
  row: number;
  col: number;
}

/** Shared configuration that can be reused across multiple readMultiline calls via createPrompt */
export type SharedConfig = ReadMultilineOptions;

export interface EditorState {
  // Buffer
  lines: string[];
  row: number;
  col: number;

  // Output
  output: NodeJS.WritableStream;

  // Prompt header (rebuilt on visual state change)
  promptHeader: string;
  promptHeaderHeight: number;

  // Line prefix for all input lines (rebuilt on visual state change)
  styledLinePrefix: string;
  linePrefixWidth: number;

  // Current visual state for prefix/linePrefix rendering
  visualState: "pending" | "error";

  // Theme & raw values for submitted-state re-rendering
  theme: PromptTheme | undefined;
  prefixOption: Stateful<string>;
  linePrefixOption: Stateful<string>;
  rawPrompt: string;

  // Status line
  statusText: string;
  statusColor: "red" | "green" | "";

  // Footer
  footerText: string;
  rebuildFooter: ((columns: number) => string) | null;

  // History
  history: string[];
  historyIndex: number;
  draft: string;
  historyArrowNavigation: "single" | "double" | "disabled";
  historyArrowAttempt: number;

  // Undo/redo
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  lastEditType: "insert" | "other" | "";

  // Validation
  validationActive: boolean;
  validateTimer: ReturnType<typeof setTimeout> | null;

  // Input processing
  isPasting: boolean;
  escBuffer: string;
  escTimer: ReturnType<typeof setTimeout> | null;

  // Options (readonly after init)
  maxLines: number | undefined;
  maxLength: number | undefined;
  validate: ((value: string) => string | undefined | null) | undefined;
  validateDebounceMs: number;
  preferNewlineOnEnter: boolean;
  disabledKeys: Set<ModifiedEnterKey>;

  // Key map (built once during init)
  keyMap: Record<string, () => void>;

  // Output buffering for flicker-free batch rendering
  buffering: boolean;
  writeBuffer: string;
}
