import * as p from "@clack/prompts";

import { CancelError, createPrompt, presets } from "../src/index.js";

const ask = createPrompt(presets.clack);

/** Wrapper that calls p.cancel() on CancelError, matching native clack cancel flow */
async function clackAsk(options: Parameters<typeof ask>[0]): Promise<string | symbol> {
  try {
    return await ask(options);
  } catch (e) {
    if (e instanceof CancelError) {
      return Symbol.for("cancel");
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

  const input1 = await clackAsk({ prompt: "Any multiline input:" });
  if (p.isCancel(input1)) return p.cancel("Cancelled.");

  const color = await p.select({
    message: "Pick a color:",
    options: [
      { label: "Red", value: "red" },
      { label: "Blue", value: "blue" },
      { label: "Green", value: "green" },
    ],
  });
  if (p.isCancel(color)) return p.cancel("Cancelled.");

  const input2 = await clackAsk({ prompt: "Any feedback?" });
  if (p.isCancel(input2)) return p.cancel("Cancelled.");

  p.outro("Done!");
}

main().catch(() => {});
