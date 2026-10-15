import { readMultiline } from "../src/index.js";
import { createTwinkleplopHighlight } from "./twinkleplop-highlight.ts";

const lang = process.argv[2] ?? "sql";
if (lang !== "sql" && lang !== "graphql") {
  throw new Error("Usage: npx tsx examples/twinkleplop-editor.ts [sql|graphql]");
}

const { tokenize } =
  lang === "sql" ? await import("@twinkleplop/sql") : await import("@twinkleplop/graphql");
const highlight = createTwinkleplopHighlight(tokenize());

console.log(`${lang} editor (Twinkleplop, line-local syntax highlighting)\n`);

const [value, error] = await readMultiline("", {
  prefix: `${lang}> `,
  linePrefix: "   | ",
  highlight,
  preferNewlineOnEnter: true,
  helpFooter: true,
  theme: { submitRender: "content" },
});

if (error) {
  console.log(`\n(${error.kind})`);
} else {
  console.log(`\nReceived ${value.length} characters.`);
}
