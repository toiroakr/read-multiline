import { charAtIndex, charBeforeIndex, charWidth, isWordChar } from "./chars.js";
import {
  beginBatch,
  drawBelowEditor,
  flushBatch,
  moveTo,
  pW,
  styledInput,
  tCol,
  w,
} from "./rendering.js";
import type { EditorState } from "./types.js";

// --- Basic cursor movement ---

/** Move cursor one character to the left, crossing line boundaries */
export function moveLeft(state: EditorState): void {
  if (state.col > 0) {
    const ch = charBeforeIndex(state.lines[state.row], state.col);
    const cw = charWidth(ch.codePointAt(0)!);
    state.col -= ch.length;
    w(state, cw > 1 ? `\x1b[${cw}D` : "\x1b[D");
  } else if (state.row > 0) {
    moveTo(state, state.row - 1, state.lines[state.row - 1].length);
  }
}

/** Move cursor one character to the right, crossing line boundaries */
export function moveRight(state: EditorState): void {
  if (state.col < state.lines[state.row].length) {
    const ch = charAtIndex(state.lines[state.row], state.col);
    const cw = charWidth(ch.codePointAt(0)!);
    state.col += ch.length;
    w(state, cw > 1 ? `\x1b[${cw}C` : "\x1b[C");
  } else if (state.row < state.lines.length - 1) {
    moveTo(state, state.row + 1, 0);
  }
}

/** Move cursor one line up */
export function moveUp(state: EditorState): void {
  if (state.row > 0) {
    moveTo(state, state.row - 1, Math.min(state.col, state.lines[state.row - 1].length));
  }
}

/** Move cursor one line down */
export function moveDown(state: EditorState): void {
  if (state.row < state.lines.length - 1) {
    moveTo(state, state.row + 1, Math.min(state.col, state.lines[state.row + 1].length));
  }
}

// --- Up/Down with history support ---

/** Move up or navigate history when at the first line */
export function moveUpOrHistory(state: EditorState): void {
  if (state.row > 0) {
    moveUp(state);
    state.historyArrowAttempt = 0;
  } else if (state.col > 0) {
    moveTo(state, 0, 0);
    state.historyArrowAttempt = 0;
  } else if (state.history.length > 0) {
    const nav = state.historyArrowNavigation;
    if (nav === "single") {
      historyPrev(state);
    } else if (nav === "double") {
      state.historyArrowAttempt++;
      if (state.historyArrowAttempt >= 2) {
        state.historyArrowAttempt = 0;
        historyPrev(state);
      }
    }
    // "disabled": do nothing
  }
}

/** Move down or navigate history when at the last line */
export function moveDownOrHistory(state: EditorState): void {
  if (state.row < state.lines.length - 1) {
    moveDown(state);
    state.historyArrowAttempt = 0;
  } else if (state.col < state.lines[state.row].length) {
    moveTo(state, state.row, state.lines[state.row].length);
    state.historyArrowAttempt = 0;
  } else if (state.historyIndex < state.history.length) {
    const nav = state.historyArrowNavigation;
    if (nav === "single") {
      historyNext(state);
    } else if (nav === "double") {
      state.historyArrowAttempt++;
      if (state.historyArrowAttempt >= 2) {
        state.historyArrowAttempt = 0;
        historyNext(state);
      }
    }
    // "disabled": do nothing
  }
}

// --- Word jump ---

/** Jump cursor to the end of the next word */
export function wordRight(state: EditorState): void {
  let r = state.row,
    c = state.col;
  while (r < state.lines.length) {
    const line = state.lines[r];
    while (c < line.length && !isWordChar(line[c])) c++;
    if (c < line.length) break;
    if (r < state.lines.length - 1) {
      r++;
      c = 0;
    } else break;
  }
  const line = state.lines[r];
  while (c < line.length && isWordChar(line[c])) c++;

  if (r !== state.row || c !== state.col) moveTo(state, r, c);
}

/** Jump cursor to the start of the previous word */
export function wordLeft(state: EditorState): void {
  let r = state.row,
    c = state.col;
  if (c > 0) {
    c--;
  } else if (r > 0) {
    r--;
    c = state.lines[r].length;
    if (c > 0) c--;
    else {
      moveTo(state, r, 0);
      return;
    }
  } else return;

  while (true) {
    const line = state.lines[r];
    while (c > 0 && !isWordChar(line[c])) c--;
    if (isWordChar(line[c])) break;
    if (r > 0) {
      r--;
      c = state.lines[r].length - 1;
      if (c < 0) {
        c = 0;
        break;
      }
    } else {
      c = 0;
      break;
    }
  }
  const line = state.lines[r];
  while (c > 0 && isWordChar(line[c - 1])) c--;

  moveTo(state, r, c);
}

// --- Line start/end, buffer start/end ---

/** Move cursor to the start of the current line */
export function lineStart(state: EditorState): void {
  if (state.col !== 0) moveTo(state, state.row, 0);
}

/** Move cursor to the end of the current line */
export function lineEnd(state: EditorState): void {
  if (state.col !== state.lines[state.row].length)
    moveTo(state, state.row, state.lines[state.row].length);
}

/** Move cursor to the start of the entire input */
export function bufferStart(state: EditorState): void {
  if (state.row !== 0 || state.col !== 0) moveTo(state, 0, 0);
}

/** Move cursor to the end of the entire input */
export function bufferEnd(state: EditorState): void {
  const lastRow = state.lines.length - 1;
  const lastCol = state.lines[lastRow].length;
  if (state.row !== lastRow || state.col !== lastCol) moveTo(state, lastRow, lastCol);
}

// --- History ---

/** Replace editor content and place cursor at the specified position */
export function loadContent(
  state: EditorState,
  content: string,
  cursor: "start" | "end" = "end",
): void {
  beginBatch(state);
  const newLines = content.split("\n");
  if (state.row > 0) w(state, `\x1b[${state.row}A`);
  w(state, "\r");
  w(state, `\x1b[${pW(state) + 1}G`);
  w(state, "\x1b[J");
  state.lines.length = 0;
  state.lines.push(...newLines);
  w(state, styledInput(state, state.lines[0]));
  for (let i = 1; i < state.lines.length; i++) {
    w(state, "\n" + state.styledLinePrefix + styledInput(state, state.lines[i]));
  }
  if (cursor === "start") {
    state.row = 0;
    state.col = 0;
    if (newLines.length > 1) w(state, `\x1b[${newLines.length - 1}A`);
    w(state, `\x1b[${tCol(state, 0, 0)}G`);
  } else {
    state.row = state.lines.length - 1;
    state.col = state.lines[state.row].length;
    w(state, `\x1b[${tCol(state, state.row, state.col)}G`);
  }
  drawBelowEditor(state);
  flushBatch(state);
}

/** Navigate to the previous history entry, saving current content as draft */
export function historyPrev(state: EditorState): void {
  if (state.historyIndex <= 0) return;
  if (state.historyIndex === state.history.length) {
    state.draft = state.lines.join("\n");
  }
  state.historyIndex--;
  loadContent(state, state.history[state.historyIndex], "start");
}

/** Navigate to the next history entry, or restore draft at the end */
export function historyNext(state: EditorState): void {
  if (state.historyIndex >= state.history.length) return;
  state.historyIndex++;
  if (state.historyIndex === state.history.length) {
    loadContent(state, state.draft);
  } else {
    loadContent(state, state.history[state.historyIndex]);
  }
}
