import * as p from "@clack/prompts";

import { createPrompt, presets } from "../src/index.js";

const ask = createPrompt(presets.clack);

async function main() {
  p.intro("Welcome!");

  const name = await p.text({ message: "What is your name?" });
  if (p.isCancel(name)) return p.cancel("Cancelled.");

  await ask({ prompt: "Tell me about yourself:" });

  const color = await p.select({
    message: "Pick a color:",
    options: [
      { label: "Red", value: "red" },
      { label: "Blue", value: "blue" },
      { label: "Green", value: "green" },
    ],
  });
  if (p.isCancel(color)) return p.cancel("Cancelled.");

  await ask({ prompt: "Any feedback?" });

  p.outro("Done!");
}

main().catch(console.error);
