import type { SharedConfig } from "../types.js";

/** Preset mimicking @clack/prompts visual style */
export const clack: SharedConfig = {
  prefix: { pending: "◆  ", submitted: "◇  " },
  linePrefix: { pending: "│  ", submitted: "│  " },
  footer: "└",
  theme: {
    prefix: { pending: "cyan", submitted: "gray" },
    linePrefix: { pending: "cyan", submitted: "gray" },
    footer: "cyan",
    submitRender: "preserve",
  },
};
