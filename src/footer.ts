import { stringWidth } from "./chars.js";
import { applyStyle } from "./style.js";
import type { HelpFooterAction, ModifiedEnterKey, StyleTextFormat, TTYInput } from "./types.js";

const DEFAULT_ITEMS: HelpFooterAction[] = ["submit", "newline", "undo", "cancel", "eof"];

interface HelpFooterOptions {
  /** Whether Enter inserts a newline instead of submitting (default: false) */
  preferNewlineOnEnter?: boolean;
  /** Key combinations that are disabled */
  disabledKeys?: ModifiedEnterKey[];
  /** Actions to display and their order (default: ["submit", "newline", "undo", "cancel", "eof"]) */
  items?: HelpFooterAction[];
  /** Maximum number of key alternatives shown per action (default: 2) */
  maxKeysPerAction?: number;
  /** Maximum number of lines to display (default: unlimited) */
  maxLines?: number;
  /** Overall text style (default: "dim") */
  style?: StyleTextFormat;
  /** Style for key labels like "Enter", "Ctrl+Z" (default: none) */
  keyStyle?: StyleTextFormat;
  /** Terminal width for grid layout (default: process.stdout.columns ?? 80) */
  columns?: number;
}

interface HelpItem {
  keys: string[];
  action: string;
}

/** Preferred display order for newline/submit modified keys */
const MODIFIED_KEY_LABELS: Record<ModifiedEnterKey, string> = {
  "shift+enter": "Shift+Enter",
  "ctrl+j": "Ctrl+J",
  "ctrl+enter": "Ctrl+Enter",
  "alt+enter": "Alt+Enter",
  "cmd+enter": "Cmd+Enter",
};

const MODIFIED_KEY_ORDER: ModifiedEnterKey[] = [
  "shift+enter",
  "ctrl+j",
  "ctrl+enter",
  "alt+enter",
  "cmd+enter",
];

/** Keys that require the kitty keyboard protocol to work */
const KITTY_REQUIRED_KEYS: Set<ModifiedEnterKey> = new Set([
  "shift+enter",
  "ctrl+enter",
  "cmd+enter",
]);

// --- Kitty protocol detection ---

const DETECT_TIMEOUT_MS = 100;

let _kittySupported: boolean | undefined;
let _kittyDetectionPromise: Promise<boolean> | null = null;

/** @internal Reset detection cache for testing */
export function _resetKittyDetection(value?: boolean): void {
  _kittySupported = value;
  _kittyDetectionPromise = null;
}

/**
 * Detect kitty keyboard protocol support.
 * Must be called after raw mode is enabled on the input stream.
 * Results are cached; subsequent calls return the cached promise.
 */
export function detectKittyProtocol(
  input: TTYInput,
  output: NodeJS.WritableStream,
): Promise<boolean> {
  if (_kittyDetectionPromise) return _kittyDetectionPromise;
  if (_kittySupported !== undefined) {
    _kittyDetectionPromise = Promise.resolve(_kittySupported);
    return _kittyDetectionPromise;
  }

  _kittyDetectionPromise = new Promise<boolean>((resolve) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        _kittySupported = false;
        resolve(false);
      }
    }, DETECT_TIMEOUT_MS);

    function onData(data: Buffer) {
      const str = data.toString();
      // Kitty protocol query response: \x1b[?{flags}u
      if (/\x1b\[\?\d*u/.test(str)) {
        if (!settled) {
          settled = true;
          cleanup();
          _kittySupported = true;
          resolve(true);
        }
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      input.removeListener("data", onData);
    }

    input.on("data", onData);
    // Query kitty keyboard protocol flags
    output.write("\x1b[?u");
  });

  return _kittyDetectionPromise;
}

// ---

function getAvailableModifiedKeys(disabledKeys: Set<ModifiedEnterKey>): ModifiedEnterKey[] {
  return MODIFIED_KEY_ORDER.filter((k) => {
    if (disabledKeys.has(k)) return false;
    if (_kittySupported === false && KITTY_REQUIRED_KEYS.has(k)) return false;
    return true;
  });
}

function resolveAction(
  action: HelpFooterAction,
  preferNewlineOnEnter: boolean,
  submitLabels: string[],
  newlineLabels: string[],
): HelpItem | null {
  switch (action) {
    case "submit":
      if (!preferNewlineOnEnter) return { keys: ["Enter"], action: "submit" };
      return submitLabels.length > 0 ? { keys: submitLabels, action: "submit" } : null;
    case "newline":
      if (preferNewlineOnEnter) return { keys: ["Enter", ...newlineLabels], action: "newline" };
      return newlineLabels.length > 0 ? { keys: newlineLabels, action: "newline" } : null;
    case "undo":
      return { keys: ["Ctrl+Z"], action: "undo" };
    case "redo":
      return { keys: ["Ctrl+Y"], action: "redo" };
    case "cancel":
      return { keys: ["Ctrl+C"], action: "cancel" };
    case "eof":
      return { keys: ["Ctrl+D"], action: "EOF" };
    case "history":
      return { keys: ["↑/↓"], action: "history" };
    case "word-jump":
      return { keys: ["Alt+←/→"], action: "word jump" };
    case "line-start":
      return { keys: ["Ctrl+A", "Home"], action: "line start" };
    case "line-end":
      return { keys: ["Ctrl+E", "End"], action: "line end" };
    case "delete-word":
      return { keys: ["Ctrl+W"], action: "delete word" };
    case "delete-to-start":
      return { keys: ["Ctrl+U"], action: "delete to start" };
    case "delete-to-end":
      return { keys: ["Ctrl+K"], action: "delete to end" };
    case "clear-screen":
      return { keys: ["Ctrl+L"], action: "clear screen" };
  }
}

function buildItems(options: HelpFooterOptions): HelpItem[] {
  const {
    preferNewlineOnEnter = false,
    disabledKeys = [],
    maxKeysPerAction = 2,
    items: actions = DEFAULT_ITEMS,
  } = options;
  const disabled = new Set(disabledKeys);

  const available = getAvailableModifiedKeys(disabled);

  // Ctrl+J is always on the newline side
  const submitCapableKeys = available.filter((k) => k !== "ctrl+j");
  const newlineKeys = preferNewlineOnEnter ? available.filter((k) => k === "ctrl+j") : available;

  const submitLabels = submitCapableKeys
    .slice(0, Math.max(1, maxKeysPerAction))
    .map((k) => MODIFIED_KEY_LABELS[k]);
  const newlineLabels = newlineKeys
    .slice(0, Math.max(1, maxKeysPerAction))
    .map((k) => MODIFIED_KEY_LABELS[k]);

  const items: HelpItem[] = [];
  for (const action of actions) {
    const item = resolveAction(action, preferNewlineOnEnter, submitLabels, newlineLabels);
    if (item) items.push(item);
  }

  return items;
}

function formatItem(item: HelpItem, keyStyle?: StyleTextFormat): string {
  const keys = item.keys.map((k) => applyStyle(k, keyStyle)).join("/");
  return `${keys}: ${item.action}`;
}

function plainItemText(item: HelpItem): string {
  return `${item.keys.join("/")}: ${item.action}`;
}

function formatGrid(
  items: HelpItem[],
  keyStyle: StyleTextFormat | undefined,
  termWidth: number,
  maxLines?: number,
): string {
  const itemWidths = items.map((item) => stringWidth(plainItemText(item)));
  const maxItemWidth = Math.max(...itemWidths);

  const colWidth = maxItemWidth + 2;
  // Ensure each row fits within termWidth: last item has no padding, others have colWidth
  // Row width = (numCols - 1) * colWidth + maxItemWidth <= termWidth
  const numCols = Math.max(1, Math.floor((termWidth - maxItemWidth) / colWidth) + 1);

  const rows: string[] = [];
  for (let i = 0; i < items.length; i += numCols) {
    if (maxLines !== undefined && rows.length >= maxLines) break;
    const rowItems = items.slice(i, i + numCols);
    const parts = rowItems.map((item, idx) => {
      const formatted = formatItem(item, keyStyle);
      if (idx < rowItems.length - 1) {
        const plain = plainItemText(item);
        const pad = colWidth - stringWidth(plain);
        return formatted + " ".repeat(Math.max(0, pad));
      }
      return formatted;
    });
    rows.push(parts.join(""));
  }

  return rows.join("\n");
}

/**
 * Build a help footer string with key binding descriptions.
 * Automatically adjusts grid layout based on terminal width.
 * Uses cached kitty protocol detection results to filter unavailable keys.
 */
export function buildHelpFooter(options: HelpFooterOptions = {}): string {
  const { style = "dim", keyStyle, columns, maxLines } = options;
  const termWidth = columns ?? (process.stdout.columns || 80);
  const items = buildItems(options);
  if (items.length === 0) return "";
  const text = formatGrid(items, keyStyle, termWidth, maxLines);
  return applyStyle(text, style);
}
