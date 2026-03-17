import { stringWidth } from "./chars.js";
import {
  applyStyle,
  buildPromptHeader,
  buildStyledLinePrefix,
  computeHeaderHeight,
  resolveStateful,
} from "./style.js";
import type { EditorState, Snapshot } from "./types.js";

/** Write text to the output stream (or buffer if batching) */
export function w(state: EditorState, text: string): void {
  if (state.buffering) {
    state.writeBuffer += text;
  } else {
    state.output.write(text);
  }
}

/** Begin buffering output writes for flicker-free batch rendering */
export function beginBatch(state: EditorState): void {
  state.buffering = true;
  state.writeBuffer = "";
}

/** Flush buffered output with cursor hidden during the write */
export function flushBatch(state: EditorState): void {
  state.buffering = false;
  if (state.writeBuffer) {
    state.output.write("\x1b[?25l" + state.writeBuffer + "\x1b[?25h");
    state.writeBuffer = "";
  }
}

/** Get the line prefix display width (same for all input rows) */
export function pW(state: EditorState): number {
  return state.linePrefixWidth;
}

/** Get 1-based terminal column from line start to code unit index, accounting for display width */
export function tCol(state: EditorState, r: number, c: number): number {
  return pW(state) + stringWidth(state.lines[r].slice(0, c)) + 1;
}

/** Style input text according to the theme */
export function styledInput(state: EditorState, text: string): string {
  return applyStyle(text, state.theme?.input);
}

/** Move terminal cursor from current position to (newRow, newCol) */
export function moveTo(state: EditorState, newRow: number, newCol: number): void {
  const dr = newRow - state.row;
  if (dr < 0) w(state, `\x1b[${-dr}A`);
  else if (dr > 0) w(state, `\x1b[${dr}B`);
  w(state, `\x1b[${tCol(state, newRow, newCol)}G`);
  state.row = newRow;
  state.col = newCol;
}

/** Draw status line and footer below the editor content, then return cursor to position */
export function drawBelowEditor(state: EditorState): void {
  if (!state.statusText && !state.footerText) return;

  const endRow = state.lines.length - 1;
  const dr = endRow - state.row;
  if (dr > 0) w(state, `\x1b[${dr}B`);
  else if (dr < 0) w(state, `\x1b[${-dr}A`);

  let linesBelow = 0;

  if (state.statusText) {
    w(state, "\r\n");
    linesBelow++;
    const errorStyle = state.statusColor === "red" ? state.theme?.error : undefined;
    const successStyle = state.statusColor === "green" ? state.theme?.success : undefined;
    const themeStyle = errorStyle ?? successStyle;
    if (themeStyle) {
      w(state, applyStyle(state.statusText, themeStyle));
    } else {
      if (state.statusColor === "red") w(state, "\x1b[31m");
      else if (state.statusColor === "green") w(state, "\x1b[32m");
      w(state, state.statusText);
      if (state.statusColor) w(state, "\x1b[0m");
    }
    w(state, "\x1b[K");
  }

  if (state.footerText) {
    const footerLines = state.footerText.split("\n");
    for (const line of footerLines) {
      w(state, "\r\n");
      linesBelow++;
      w(state, line + "\x1b[K");
    }
  }

  const upCount = endRow - state.row + linesBelow;
  if (upCount > 0) w(state, `\x1b[${upCount}A`);
  w(state, `\x1b[${tCol(state, state.row, state.col)}G`);
}

/** Clear everything below the editor (status + footer) and return cursor to position */
function clearBelowAndReturn(state: EditorState): void {
  const endRow = state.lines.length - 1;
  const dr = endRow - state.row;
  if (dr > 0) w(state, `\x1b[${dr}B`);
  else if (dr < 0) w(state, `\x1b[${-dr}A`);
  w(state, "\r\n\x1b[J");
  const upCount = endRow + 1 - state.row;
  if (upCount > 0) w(state, `\x1b[${upCount}A`);
  w(state, `\x1b[${tCol(state, state.row, state.col)}G`);
}

/** Clear the status line and reset status state */
export function clearStatus(state: EditorState): void {
  if (!state.statusText) return;
  clearBelowAndReturn(state);
  state.statusText = "";
  state.statusColor = "";
  drawBelowEditor(state);
}

/** Display or update the status line with the given text and color */
export function setStatus(state: EditorState, text: string, color: "red" | "green" | ""): void {
  if (state.statusText || state.footerText) clearBelowAndReturn(state);
  state.statusText = text;
  state.statusColor = color;
  drawBelowEditor(state);
}

/** Set footer text and redraw the area below the editor */
export function setFooter(state: EditorState, text: string): void {
  if (state.statusText || state.footerText) clearBelowAndReturn(state);
  state.footerText = text;
  drawBelowEditor(state);
}

/** Clear all content below the editor (status and footer) for cleanup */
export function clearBelowEditor(state: EditorState): void {
  if (!state.statusText && !state.footerText) return;
  clearBelowAndReturn(state);
  state.statusText = "";
  state.statusColor = "";
  state.footerText = "";
}

/** Update the visual state (prefix/linePrefix) and recompute derived fields */
export function setVisualState(state: EditorState, visualState: "pending" | "error"): void {
  if (state.visualState === visualState) return;
  state.visualState = visualState;
  state.promptHeader = buildPromptHeader(
    state.prefixOption,
    state.rawPrompt,
    state.theme,
    visualState,
  );
  state.promptHeaderHeight = computeHeaderHeight(state.promptHeader);
  state.styledLinePrefix = buildStyledLinePrefix(state.linePrefixOption, state.theme, visualState);
  const rawLinePrefix = resolveStateful(state.linePrefixOption, visualState);
  state.linePrefixWidth = stringWidth(rawLinePrefix);
}

/** Set status and update visual state, minimizing redraws */
export function setStatusWithVisualState(
  state: EditorState,
  text: string,
  color: "red" | "green" | "",
  visualState: "pending" | "error",
): void {
  const visualChanged = state.visualState !== visualState;
  if (visualChanged) {
    // Capture old header height before updating, for correct cursor rewind
    const oldHeaderHeight = state.promptHeaderHeight;
    setVisualState(state, visualState);
    // Full redraw since prefix/linePrefix changed
    if (state.statusText || state.footerText) clearBelowAndReturn(state);
    state.statusText = text;
    state.statusColor = color;
    fullRedraw(state, oldHeaderHeight);
  } else {
    setStatus(state, text, color);
  }
}

/** Redraw all lines from fromRow onwards, placing cursor at (targetRow, targetCol) */
export function redrawFrom(
  state: EditorState,
  fromRow: number,
  targetRow: number,
  targetCol: number,
): void {
  beginBatch(state);
  const dr = state.row - fromRow;
  if (dr > 0) w(state, `\x1b[${dr}A`);
  else if (dr < 0) w(state, `\x1b[${-dr}B`);
  w(state, `\x1b[${tCol(state, fromRow, 0)}G`);

  w(state, "\x1b[J");

  w(state, styledInput(state, state.lines[fromRow]));
  for (let i = fromRow + 1; i < state.lines.length; i++) {
    w(state, "\n" + state.styledLinePrefix + styledInput(state, state.lines[i]));
  }

  const endRow = state.lines.length - 1;
  if (endRow > targetRow) w(state, `\x1b[${endRow - targetRow}A`);
  w(state, `\x1b[${tCol(state, targetRow, targetCol)}G`);

  state.row = targetRow;
  state.col = targetCol;

  drawBelowEditor(state);
  flushBatch(state);
}

/**
 * Full redraw: rewind cursor, redraw prompt header and all input lines, restore cursor.
 * @param rewindHeaderHeight - header height to use for cursor rewind (may differ from current
 *   state.promptHeaderHeight when the visual state has just changed)
 */
function fullRedraw(state: EditorState, rewindHeaderHeight?: number): void {
  beginBatch(state);
  const upCount = state.row + (rewindHeaderHeight ?? state.promptHeaderHeight);
  if (upCount > 0) w(state, `\x1b[${upCount}A`);
  w(state, "\r");

  // Draw prompt header if present
  if (state.promptHeaderHeight > 0) {
    const headerLines = state.promptHeader.split("\n");
    for (let i = 0; i < headerLines.length; i++) {
      if (i > 0) w(state, "\n");
      w(state, headerLines[i] + "\x1b[K");
    }
    w(state, "\n");
  }

  // Draw all input lines with linePrefix
  w(state, state.styledLinePrefix + styledInput(state, state.lines[0]) + "\x1b[K");
  for (let i = 1; i < state.lines.length; i++) {
    w(state, "\n" + state.styledLinePrefix + styledInput(state, state.lines[i]) + "\x1b[K");
  }
  w(state, "\x1b[J");
  const endRow = state.lines.length - 1;
  if (endRow > state.row) w(state, `\x1b[${endRow - state.row}A`);
  w(state, `\x1b[${tCol(state, state.row, state.col)}G`);
  drawBelowEditor(state);
  flushBatch(state);
}

/** Clear screen and redraw all content with in-place rendering to reduce flicker */
export function clearScreen(state: EditorState): void {
  fullRedraw(state);
}

/** Restore editor state from a snapshot and redraw */
export function restoreSnapshot(state: EditorState, snap: Snapshot): void {
  beginBatch(state);
  state.lines.length = 0;
  state.lines.push(...snap.lines);
  if (state.row > 0) w(state, `\x1b[${state.row}A`);
  w(state, "\r");
  w(state, `\x1b[${pW(state) + 1}G`);
  w(state, "\x1b[J");
  w(state, styledInput(state, state.lines[0]));
  for (let i = 1; i < state.lines.length; i++) {
    w(state, "\n" + state.styledLinePrefix + styledInput(state, state.lines[i]));
  }
  const endRow = state.lines.length - 1;
  if (endRow > snap.row) w(state, `\x1b[${endRow - snap.row}A`);
  w(state, `\x1b[${tCol(state, snap.row, snap.col)}G`);
  state.row = snap.row;
  state.col = snap.col;
  drawBelowEditor(state);
  flushBatch(state);
}

/** Redraw current line after deleting characters of the given display width at cursor */
export function redrawAfterDelete(state: EditorState, deletedWidth: number): void {
  const rest = state.lines[state.row].slice(state.col);
  const restW = stringWidth(rest);
  w(
    state,
    `\x1b[${deletedWidth}D${styledInput(state, rest)}${" ".repeat(deletedWidth)}\x1b[${restW + deletedWidth}D`,
  );
}
