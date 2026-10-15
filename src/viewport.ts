import { stripVTControlCharacters } from "node:util";
import { charWidth } from "./chars.js";
import { applyStyle } from "./style.js";
import type { EditorState } from "./types.js";

const SGR_RESETS = new Map<number, number[]>([
  [22, [1, 2]],
  [23, [3, 20]],
  [24, [4]],
  [25, [5]],
  [27, [7]],
  [28, [8]],
  [29, [9]],
  [39, [38]],
  [49, [48]],
  [50, [26]],
  [54, [51]],
  [55, [53]],
  [59, [58]],
  [65, [60]],
  [75, [73]],
]);

function updateSgr(style: Map<number, string>, sequence: string): void {
  const params = sequence.slice(2, -1).split(";");
  for (let index = 0; index < params.length; index++) {
    const value = params[index];
    const code = Number(value.split(":")[0]);
    if (code === 0) {
      style.clear();
      continue;
    }
    if (code === 38 || code === 48 || code === 58) {
      if (value.includes(":")) style.set(code, value);
      else {
        const count = params[index + 1] === "2" ? 4 : 2;
        style.set(code, params.slice(index, index + count + 1).join(";"));
        index += count;
      }
      continue;
    }
    const reset = SGR_RESETS.get(code);
    if (reset) {
      for (const key of reset) style.delete(key);
      continue;
    }
    const group =
      (code >= 30 && code <= 37) || (code >= 90 && code <= 97)
        ? 38
        : (code >= 40 && code <= 47) || (code >= 100 && code <= 107)
          ? 48
          : code >= 10 && code <= 19
            ? 10
            : code === 21
              ? 4
              : code === 6
                ? 5
                : code === 52
                  ? 51
                  : code >= 60 && code <= 64
                    ? 60
                    : code === 74
                      ? 73
                      : code;
    style.set(group, value);
  }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function cellWidth(text: string): number {
  const code = text.codePointAt(0)!;
  if (text.length === 1 && code < 0x7f) return charWidth(code);
  if (/^(?:\p{Mark}|\u200c|\u200d|[\ufe00-\ufe0f])+$/u.test(text)) return 0;
  if (
    !text.includes("\ufe0e") &&
    /\p{Emoji_Presentation}|\p{Regional_Indicator}|\ufe0f/u.test(text)
  )
    return 2;
  return charWidth(code);
}

export function viewportColumn(text: string, index: number): number {
  let width = 0;
  for (const { segment } of graphemes.segment(stripVTControlCharacters(text.slice(0, index)))) {
    width += cellWidth(segment);
  }
  return width;
}

export function viewportIndex(text: string, column: number): number {
  let width = 0;
  let index = 0;
  for (const { segment } of graphemes.segment(text)) {
    const next = width + cellWidth(segment);
    if (next > column) break;
    width = next;
    index += segment.length;
  }
  return index;
}

function wrap(text: string, columns: number): { lines: string[]; column: number } {
  const lines: string[] = [];
  let line = "";
  let column = 0;
  const style = new Map<number, string>();
  let hyperlink = "";
  const controls =
    text.match(
      /\x1b\](?:[^\x1b\x07]|\x1b(?!\\))*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|[^\x1b]+|\x1b/gu,
    ) ?? [];
  const parts = controls.flatMap((part) =>
    part.startsWith("\x1b") ? [part] : [...graphemes.segment(part)].map(({ segment }) => segment),
  );
  const close = () => (hyperlink ? "\x1b]8;;\x1b\\" : "") + "\x1b[0m";
  for (const part of parts) {
    if (part.startsWith("\x1b")) {
      line += part;
      if (part.startsWith("\x1b[") && part.endsWith("m")) updateSgr(style, part);
      const link = part.match(/^\x1b\]8;[^;]*;(.*?)(?:\x07|\x1b\\)$/su);
      if (link) hyperlink = link[1] ? part : "";
      continue;
    }
    const width = cellWidth(part);
    if (part === "\n" || (width > 0 && column + width > columns)) {
      lines.push(line + close());
      line = (style.size ? `\x1b[${[...style.values()].join(";")}m` : "") + hyperlink;
      column = 0;
    }
    if (part !== "\n") {
      line += part;
      column += width;
    }
  }
  lines.push(line + close());
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
