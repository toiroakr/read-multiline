import { input, select } from "@inquirer/prompts";

import { createPrompt, presets } from "../src/index.js";

const ask = createPrompt(presets.inquirer);

async function main() {
  await input({ message: "What is your name?" });

  await ask("Tell me about yourself:");

  await select({
    message: "Pick a color:",
    choices: [
      { name: "Red", value: "red" },
      { name: "Blue", value: "blue" },
      { name: "Green", value: "green" },
    ],
  });

  await ask("Any feedback?");
}

main().catch(() => {});
