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
 *
 * Cancelled:
 *   │        ← gray guide bar
 *   ■  msg   ← red cancel symbol
 *   │  value ← gray bar + strikethrough dim answer
 */
export const clack: SharedConfig = {
  prefix: {
    pending: styleText("gray", "│") + "\n" + styleText("cyan", "◆") + "  ",
    submitted: styleText("gray", "│") + "\n" + styleText("green", "◇") + "  ",
    cancelled: styleText("gray", "│") + "\n" + styleText("red", "■") + "  ",
  },
  linePrefix: {
    pending: styleText("cyan", "│") + "  ",
    submitted: styleText("gray", "│") + "  ",
    cancelled: styleText("gray", "│") + "  ",
  },
  footer: styleText("cyan", "└"),
  theme: {
    answer: "dim",
    cancelAnswer: ["strikethrough", "dim"],
    submitRender: "preserve",
    cancelRender: "preserve",
  },
};
