import { styleText } from "node:util";

import type { SharedConfig } from "../types.js";

/** Preset mimicking @clack/prompts visual style */
export const clack: SharedConfig = {
  prefix: {
    pending: styleText("cyan", "│") + "\n" + styleText("cyan", "◆") + "  ",
    submitted: styleText("gray", "│") + "\n" + styleText("green", "◇") + "  ",
  },
  linePrefix: {
    pending: styleText("cyan", "│") + "  ",
    submitted: styleText("gray", "│") + "  ",
  },
  footer: styleText("cyan", "└"),
  theme: {
    answer: "dim",
    submitRender: "preserve",
  },
};
