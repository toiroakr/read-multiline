import * as p from "@clack/prompts";

import { CancelError, createPrompt, presets } from "../src/index.js";

const ask = createPrompt(presets.clack);

/** Wrapper that catches CancelError and calls p.cancel(), matching native clack cancel flow */
async function clackAsk(options: Parameters<typeof ask>[0]): Promise<string> {
  try {
    return await ask(options);
  } catch (e) {
    if (e instanceof CancelError) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    throw e;
  }
}

async function main() {
  p.intro("Welcome!");

  const name = await p.text({ message: "What is your name?" });
  if (p.isCancel(name)) return p.cancel("Cancelled.");

  const bio = await p.text({ message: "Tell me about yourself:" });
  if (p.isCancel(bio)) return p.cancel("Cancelled.");

  await clackAsk({ prompt: "Any multiline input:" });

  const color = await p.select({
    message: "Pick a color:",
    options: [
      { label: "Red", value: "red" },
      { label: "Blue", value: "blue" },
      { label: "Green", value: "green" },
    ],
  });
  if (p.isCancel(color)) return p.cancel("Cancelled.");

  await clackAsk({ prompt: "Any feedback?" });

  p.outro("Done!");
}

main().catch(() => {});
