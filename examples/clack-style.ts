import * as p from "@clack/prompts";

import { createPrompt, presets } from "../src/index.js";

const ask = createPrompt({
  ...presets.clack,
  onError: (err) => {
    if (err.kind === "cancel") {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  },
});

async function main() {
  p.intro("Welcome!");

  const name = await p.text({ message: "What is your name?" });
  if (p.isCancel(name)) return p.cancel("Cancelled.");

  const bio = await p.text({ message: "Tell me about yourself:" });
  if (p.isCancel(bio)) return p.cancel("Cancelled.");

  const [multiline] = await ask("Any multiline input:");

  const color = await p.select({
    message: "Pick a color:",
    options: [
      { label: "Red", value: "red" },
      { label: "Blue", value: "blue" },
      { label: "Green", value: "green" },
    ],
  });
  if (p.isCancel(color)) return p.cancel("Cancelled.");

  const [feedback] = await ask("Any feedback?");

  p.outro([`Done!`, JSON.stringify({ name, bio, multiline, color, feedback }, null, 2)].join("\n"));
}

main().catch(() => {});
