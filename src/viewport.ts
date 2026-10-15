import { charWidth } from "./chars.js";
import { applyStyle } from "./style.js";
import type { EditorState } from "./types.js";

function wrap(text: string, columns: number): { lines: string[]; column: number } {
  const lines: string[] = [];
  let line = "";
  let column = 0;
  let style = "";
  for (const part of text.match(/\x1b\[[0-?]*[ -/]*[@-~]|[^]/gu) ?? []) {
    if (part.startsWith("\x1b")) {
      line += part;
      if (part.endsWith("m")) {
        style = part === "\x1b[0m" || part === "\x1b[m" ? "" : style + part;
      }
      continue;
    }
    const width = charWidth(part.codePointAt(0)!);
    if (part === "\n" || (width > 0 && column + width > columns)) {
      lines.push(line + "\x1b[0m");
      line = style;
      column = 0;
    }
    if (part !== "\n") {
      line += part;
      column += width;
    }
  }
  lines.push(line + "\x1b[0m");
  return { lines, column: Math.min(column, columns - 1) };
}

export function buildViewport(
  state: EditorState,
  renderLine: (row: number) => string,
  allowEnter: boolean,
): { top: number; output: string } | null {
  const output = state.output as NodeJS.WritableStream & { rows?: number; columns?: number };
  const { rows, columns } = output;
  if (
    !state.highlightLines ||
    (!state.viewport && !allowEnter) ||
    !rows ||
    rows < 1 ||
    !columns ||
    columns < 1 ||
    state.isPasting
  )
    return null;

  const header =
    state.inlinePrompt || state.promptHeaderHeight === 0
      ? []
      : wrap(state.promptHeader, columns).lines;
  const prefix = (row: number) =>
    state.inlinePrompt && row === 0 ? state.promptHeader : state.styledLinePrefix;
  const lengths = state.lines.map((line, row) => wrap(prefix(row) + line, columns).lines.length);
  const footer: string[] = [];
  if (state.statusText) {
    const format = state.statusColor === "red" ? state.theme?.error : state.theme?.success;
    const text = format
      ? applyStyle(state.statusText, format)
      : state.statusColor
        ? applyStyle(state.statusText, state.statusColor)
        : state.statusText;
    footer.push(...wrap(text, columns).lines);
  }
  if (state.footerText) footer.push(...wrap(state.footerText, columns).lines);
  const footerLines = footer.slice(0, rows - 1);
  const capacity = rows - footerLines.length;
  const height = header.length + lengths.reduce((sum, length) => sum + length, 0);
  if (!state.viewport && height <= capacity) return null;

  const beforeCursor = wrap(
    prefix(state.row) + state.lines[state.row].slice(0, state.col),
    columns,
  );
  const cursor =
    header.length +
    lengths.slice(0, state.row).reduce((sum, n) => sum + n, 0) +
    beforeCursor.lines.length -
    1;
  let top = state.viewport?.top ?? Math.max(0, height - capacity);
  if (cursor < top) top = cursor;
  if (cursor >= top + capacity) top = cursor - capacity + 1;
  top = Math.max(0, Math.min(top, height - capacity));

  const visible: string[] = [];
  let offset = 0;
  for (const line of header) {
    if (offset >= top && offset < top + capacity) visible.push(line);
    offset++;
  }
  for (let row = 0; row < state.lines.length; row++) {
    if (offset + lengths[row] > top && offset < top + capacity) {
      const painted = wrap(prefix(row) + renderLine(row), columns).lines;
      visible.push(...painted.slice(Math.max(0, top - offset), top + capacity - offset));
    }
    offset += lengths[row];
  }

  let painted = "\x1b[H\x1b[J";
  visible.forEach((line, row) => {
    painted += `\x1b[${row + 1};1H${line}`;
  });
  footerLines.forEach((line, row) => {
    painted += `\x1b[${capacity + row + 1};1H${line}`;
  });
  const cursorRow = cursor - top;
  painted += `\x1b[${cursorRow + 1};${beforeCursor.column + 1}H`;
  return { top, output: painted };
}
