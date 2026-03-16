/** Returns the terminal display width of a character (full-width=2, half-width=1) */
export function charWidth(code: number): number {
  if (code < 32) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33bf) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x2fffd) ||
    (code >= 0x30000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Returns the terminal display width of a string, ignoring ANSI escape sequences */
export function stringWidth(str: string): number {
  // Strip ANSI escape sequences: CSI (final byte @-~), OSC (BEL or ST terminated), simple ESC
  const stripped = str.replace(
    /\x1b\[[0-9;]*[@-~]|\x1b\](?:[^\x07\x1b]*(?:\x07|\x1b\\))|\x1b[^[\]]/g,
    "",
  );
  let width = 0;
  for (const ch of stripped) {
    width += charWidth(ch.codePointAt(0)!);
  }
  return width;
}

/** Returns the character at the given code unit index (surrogate pair aware) */
export function charAtIndex(str: string, index: number): string {
  const code = str.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < str.length) {
    return str.slice(index, index + 2);
  }
  return str[index];
}

/** Returns the character just before the given code unit index (surrogate pair aware) */
export function charBeforeIndex(str: string, index: number): string {
  const code = str.charCodeAt(index - 1);
  if (code >= 0xdc00 && code <= 0xdfff && index >= 2) {
    return str.slice(index - 2, index);
  }
  return str[index - 1];
}

export function isWordChar(ch: string): boolean {
  if (/\w/.test(ch)) return true;
  // Treat full-width characters (CJK, etc.) as word characters
  return charWidth(ch.codePointAt(0)!) === 2;
}

/** Count total characters across all lines (join with newlines) */
export function contentLength(lines: string[]): number {
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) len++; // newline separator
    len += [...lines[i]].length;
  }
  return len;
}
