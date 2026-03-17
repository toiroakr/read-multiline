import { styleText } from "node:util";

import type { PromptTheme, Stateful, StyleTextFormat } from "./types.js";

/** Valid visual states for resolving Stateful values */
export type VisualState = "pending" | "submitted" | "cancelled" | "error";

/** Resolve a Stateful value to its concrete value for the given state */
export function resolveStateful<T>(value: Stateful<T>, state: VisualState): T {
  if (value !== null && typeof value === "object" && "pending" in value && "submitted" in value) {
    if (state === "cancelled") {
      return (value as { pending: T; submitted: T; cancelled?: T }).cancelled ?? value.pending;
    }
    if (state === "error") {
      return (value as { pending: T; submitted: T; error?: T }).error ?? value.pending;
    }
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
  state: VisualState,
): string {
  const prefix = resolveStateful(prefixOption, state);
  const styledPrefix = applyStyle(
    prefix,
    theme?.prefix ? resolveStateful(theme.prefix, state) : undefined,
  );
  const styledPrompt = applyStyle(prompt, theme?.prompt);
  return styledPrefix + styledPrompt;
}

/**
 * Compute the number of terminal lines the prompt header occupies.
 * Returns 0 when both prefix and prompt are empty (no header line is rendered).
 */
export function computeHeaderHeight(builtHeader: string): number {
  if (builtHeader === "") return 0;
  return builtHeader.split("\n").length;
}

/** Build the styled line prefix for a given state */
export function buildStyledLinePrefix(
  linePrefixOption: Stateful<string>,
  theme: PromptTheme | undefined,
  state: VisualState,
): string {
  const linePrefix = resolveStateful(linePrefixOption, state);
  const style = theme?.linePrefix ? resolveStateful(theme.linePrefix, state) : undefined;
  return applyStyle(linePrefix, style);
}
