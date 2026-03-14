import * as p from "@clack/prompts";

import { createPrompt, presets } from "../src/index.js";

const ask = createPrompt(presets.clack);

async function main() {
  p.intro("Welcome!");

  const name = await p.text({ message: "What is your name?" });
  if (p.isCancel(name)) return p.cancel("Cancelled.");
  console.log(`Name: ${name}`);

  const bio = await ask({ prompt: "Tell me about yourself:" });
  console.log(`Bio: ${bio}`);

  const color = await p.select({
    message: "Pick a color:",
    options: [
      { label: "Red", value: "red" },
      { label: "Blue", value: "blue" },
      { label: "Green", value: "green" },
    ],
  });
  if (p.isCancel(color)) return p.cancel("Cancelled.");
  console.log(`Color: ${color}`);

  const feedback = await ask({ prompt: "Any feedback?" });
  console.log(`Feedback: ${feedback}`);

  p.outro("Done!");
}

main().catch(console.error);
