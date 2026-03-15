import { styleText } from "node:util";

import type { SharedConfig } from "../types.js";

/**
 * Preset mimicking @clack/prompts visual style.
 *
 * Pending (active):
 *   │        ← gray guide bar
 *   ◆  msg   ← cyan active symbol
 *   │  input ← cyan bar
 *   └        ← cyan bar end
 *
 * Submitted:
 *   │        ← gray guide bar
 *   ◇  msg   ← green submit symbol
 *   │  value ← gray bar + dim answer
 */
export const clack: SharedConfig = {
  prefix: {
    pending: styleText("gray", "│") + "\n" + styleText("cyan", "◆") + "  ",
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
