import { styleText } from "node:util";

import type { PromptTheme, Stateful, StyleTextFormat } from "./types.js";

/** Resolve a Stateful value to its concrete value for the given state */
export function resolveStateful<T>(value: Stateful<T>, state: "pending" | "submitted"): T {
  if (value !== null && typeof value === "object" && "pending" in value && "submitted" in value) {
    return value[state];
  }
  return value as T;
}

/** Apply a styleText format to text. Returns the text unchanged if no format is provided. */
export function applyStyle(text: string, format?: StyleTextFormat): string {
  if (!format || text === "") return text;
  return styleText(format, text);
}

/** Build the styled prompt header line (prefix + prompt) for a given state */
export function buildPromptHeader(
  prefixOption: Stateful<string>,
  prompt: string,
  theme: PromptTheme | undefined,
  state: "pending" | "submitted",
): string {
  const prefix = resolveStateful(prefixOption, state);
  const styledPrefix = applyStyle(
    prefix,
    theme?.prefix ? resolveStateful(theme.prefix, state) : undefined,
  );
  const styledPrompt = applyStyle(prompt, theme?.prompt);
  return styledPrefix + styledPrompt;
}

/** Build the styled line prefix for a given state */
export function buildStyledLinePrefix(
  linePrefixOption: Stateful<string>,
  theme: PromptTheme | undefined,
  state: "pending" | "submitted",
): string {
  const linePrefix = resolveStateful(linePrefixOption, state);
  const style = theme?.linePrefix ? resolveStateful(theme.linePrefix, state) : undefined;
  return applyStyle(linePrefix, style);
}
