import type { SharedConfig } from "../types.js";

/** Preset mimicking @clack/prompts visual style */
export const clack: SharedConfig = {
  prefix: { pending: "◆  ", submitted: "◇  " },
  linePrefix: { pending: "│  ", submitted: "│  " },
  theme: {
    submitRender: "preserve",
  },
};
