import {
  charAtIndex,
  charBeforeIndex,
  charWidth,
  contentLength,
  isWordChar,
  stringWidth,
} from "./chars.js";
import {
  clearStatus,
  pW,
  redrawAfterDelete,
  redrawFrom,
  restoreSnapshot,
  setStatusWithVisualState,
  styledInput,
  w,
} from "./rendering.js";
import type { EditorState, Snapshot } from "./types.js";

const MAX_UNDO = 200;

// --- Undo / Redo ---

/** Capture current editor state as a snapshot for undo/redo */
export function takeSnapshot(state: EditorState): Snapshot {
  return { lines: [...state.lines], row: state.row, col: state.col };
}

/** Push current state to undo stack, grouping consecutive character insertions */
export function saveUndo(state: EditorState, editType: "insert" | "other" = "other"): void {
  if (editType === "insert" && state.lastEditType === "insert" && state.undoStack.length > 0) {
    state.lastEditType = editType;
    return;
  }
  state.lastEditType = editType;
  state.undoStack.push(takeSnapshot(state));
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack.length = 0;
}

/** Restore previous state from undo stack */
export function undo(state: EditorState): void {
  if (state.undoStack.length === 0) return;
  state.redoStack.push(takeSnapshot(state));
  const snap = state.undoStack.pop()!;
  restoreSnapshot(state, snap);
  state.lastEditType = "";
  onContentChanged(state);
}

/** Restore next state from redo stack */
export function redo(state: EditorState): void {
  if (state.redoStack.length === 0) return;
  state.undoStack.push(takeSnapshot(state));
  const snap = state.redoStack.pop()!;
  restoreSnapshot(state, snap);
  state.lastEditType = "";
  onContentChanged(state);
}

// --- Validation / Content change ---

function scheduleValidation(state: EditorState): void {
  if (!state.validationActive || !state.validate) return;
  if (state.validateTimer) clearTimeout(state.validateTimer);
  state.validateTimer = setTimeout(() => {
    state.validateTimer = null;
    const error = state.validate!(state.lines.join("\n"));
    if (error) {
      setStatusWithVisualState(state, error, "red", "error");
    } else {
      setStatusWithVisualState(state, "OK", "green", "pending");
    }
  }, state.validateDebounceMs);
}

/** Handle content changes: check limits and trigger validation */
export function onContentChanged(state: EditorState): void {
  if (state.maxLength != null) {
    const len = contentLength(state.lines);
    if (len >= state.maxLength) {
      setStatusWithVisualState(state, `Maximum ${state.maxLength} characters`, "red", "error");
      return;
    }
  }

  if (state.validationActive) {
    scheduleValidation(state);
  } else if (state.visualState === "error") {
    // Revert to pending when limit error clears and no active validation
    setStatusWithVisualState(state, "", "", "pending");
  } else {
    clearStatus(state);
  }
}

// --- Limit checks ---

function canInsertChar(state: EditorState, charCount: number = 1): boolean {
  if (state.maxLength != null) {
    const len = contentLength(state.lines);
    if (len + charCount > state.maxLength) {
      setStatusWithVisualState(state, `Maximum ${state.maxLength} characters`, "red", "error");
      return false;
    }
  }
  return true;
}

function canInsertNewline(state: EditorState): boolean {
  if (state.maxLines != null && state.lines.length >= state.maxLines) {
    setStatusWithVisualState(state, `Maximum ${state.maxLines} lines`, "red", "error");
    return false;
  }
  if (state.maxLength != null) {
    const len = contentLength(state.lines);
    if (len + 1 > state.maxLength) {
      setStatusWithVisualState(state, `Maximum ${state.maxLength} characters`, "red", "error");
      return false;
    }
  }
  return true;
}

// --- Editing operations ---

/** Insert a character at the current cursor position */
export function insertChar(state: EditorState, ch: string): void {
  if (!canInsertChar(state, [...ch].length)) return;
  if (!state.isPasting) saveUndo(state, "insert");
  state.lines[state.row] =
    state.lines[state.row].slice(0, state.col) + ch + state.lines[state.row].slice(state.col);
  state.col += ch.length;
  const rest = state.lines[state.row].slice(state.col);
  w(state, styledInput(state, ch + rest));
  const restW = stringWidth(rest);
  if (restW > 0) w(state, `\x1b[${restW}D`);
  onContentChanged(state);
}

/** Insert a newline at the current cursor position, splitting the current line */
export function insertNewline(state: EditorState): void {
  if (!canInsertNewline(state)) return;
  if (!state.isPasting) saveUndo(state);
  const after = state.lines[state.row].slice(state.col);
  state.lines[state.row] = state.lines[state.row].slice(0, state.col);
  state.lines.splice(state.row + 1, 0, after);
  redrawFrom(state, state.row, state.row + 1, 0);
  onContentChanged(state);
}

/** Delete the character before cursor, merging lines at line boundaries */
export function handleBackspace(state: EditorState): void {
  if (state.col > 0) {
    saveUndo(state);
    const deleted = charBeforeIndex(state.lines[state.row], state.col);
    state.col -= deleted.length;
    state.lines[state.row] =
      state.lines[state.row].slice(0, state.col) +
      state.lines[state.row].slice(state.col + deleted.length);
    redrawAfterDelete(state, charWidth(deleted.codePointAt(0)!));
    onContentChanged(state);
  } else if (state.row > 0) {
    saveUndo(state);
    const prevLen = state.lines[state.row - 1].length;
    state.lines[state.row - 1] += state.lines[state.row];
    state.lines.splice(state.row, 1);
    redrawFrom(state, state.row - 1, state.row - 1, prevLen);
    onContentChanged(state);
  }
}

/** Delete the character at cursor, merging lines at line boundaries */
export function handleDelete(state: EditorState): void {
  if (state.col < state.lines[state.row].length) {
    saveUndo(state);
    const deleted = charAtIndex(state.lines[state.row], state.col);
    state.lines[state.row] =
      state.lines[state.row].slice(0, state.col) +
      state.lines[state.row].slice(state.col + deleted.length);
    const rest = state.lines[state.row].slice(state.col);
    const restW = stringWidth(rest);
    const deletedW = charWidth(deleted.codePointAt(0)!);
    w(state, `${styledInput(state, rest)}${" ".repeat(deletedW)}`);
    if (restW + deletedW > 0) w(state, `\x1b[${restW + deletedW}D`);
    onContentChanged(state);
  } else if (state.row < state.lines.length - 1) {
    saveUndo(state);
    state.lines[state.row] += state.lines[state.row + 1];
    state.lines.splice(state.row + 1, 1);
    redrawFrom(state, state.row, state.row, state.col);
    onContentChanged(state);
  }
}

/** Delete all characters from cursor to the start of the current line */
export function deleteToLineStart(state: EditorState): void {
  if (state.col === 0) return;
  saveUndo(state);
  const deletedWidth = stringWidth(state.lines[state.row].slice(0, state.col));
  state.lines[state.row] = state.lines[state.row].slice(state.col);
  state.col = 0;
  w(state, `\x1b[${pW(state) + 1}G`);
  w(state, styledInput(state, state.lines[state.row]));
  w(state, " ".repeat(deletedWidth));
  w(state, `\x1b[${pW(state) + 1}G`);
  onContentChanged(state);
}

/** Delete all characters from cursor to the end of the current line */
export function deleteToLineEnd(state: EditorState): void {
  if (state.col >= state.lines[state.row].length) return;
  saveUndo(state);
  state.lines[state.row] = state.lines[state.row].slice(0, state.col);
  w(state, "\x1b[K");
  onContentChanged(state);
}

/** Delete the previous word (Ctrl+W behavior) */
export function deleteWordBack(state: EditorState): void {
  if (state.col === 0) {
    handleBackspace(state);
    return;
  }
  saveUndo(state);
  const line = state.lines[state.row];
  let c = state.col;
  while (c > 0 && !isWordChar(charBeforeIndex(line, c))) {
    c -= charBeforeIndex(line, c).length;
  }
  while (c > 0 && isWordChar(charBeforeIndex(line, c))) {
    c -= charBeforeIndex(line, c).length;
  }
  const deletedWidth = stringWidth(line.slice(c, state.col));
  state.lines[state.row] = line.slice(0, c) + line.slice(state.col);
  state.col = c;
  redrawAfterDelete(state, deletedWidth);
  onContentChanged(state);
}
