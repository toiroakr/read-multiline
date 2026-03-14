import { input, select } from "@inquirer/prompts";

import { createPrompt, presets } from "../src/index.js";

const ask = createPrompt(presets.inquirer);

async function main() {
  const name = await input({ message: "What is your name?" });
  console.log(`Name: ${name}`);

  const bio = await ask({ prompt: "Tell me about yourself:" });
  console.log(`Bio: ${bio}`);

  const color = await select({
    message: "Pick a color:",
    choices: [
      { name: "Red", value: "red" },
      { name: "Blue", value: "blue" },
      { name: "Green", value: "green" },
    ],
  });
  console.log(`Color: ${color}`);

  const feedback = await ask({ prompt: "Any feedback?" });
  console.log(`Feedback: ${feedback}`);
}

main().catch(console.error);
