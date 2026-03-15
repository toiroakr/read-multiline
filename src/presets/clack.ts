import type { SharedConfig } from "../types.js";

/** Preset mimicking @clack/prompts visual style */
export const clack: SharedConfig = {
  prefix: { pending: "│\n◆  ", submitted: "│\n◇  " },
  linePrefix: { pending: "│  ", submitted: "│  " },
  footer: "└",
  theme: {
    prefix: { pending: "cyan", submitted: "gray" },
    linePrefix: { pending: "cyan", submitted: "gray" },
    answer: "dim",
    footer: "cyan",
    submitRender: "preserve",
  },
};
