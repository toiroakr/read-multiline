type Tokenize = (source: string) => {
  tokens: Uint32Array;
  token_types: readonly string[];
};

const RESET = "\x1b[0m";
const colors: Record<string, string> = {
  keyword: "\x1b[34m",
  function: "\x1b[1;36m",
  identifier: "\x1b[33m",
  property: "\x1b[94m",
  parameter: "\x1b[35m",
  variable: "\x1b[35m",
  decorator: "\x1b[1;35m",
  type: "\x1b[36m",
  string: "\x1b[32m",
  string_escape: "\x1b[36m",
  number: "\x1b[36m",
  boolean: "\x1b[34m",
  null: "\x1b[34m",
  constant: "\x1b[33m",
  bit: "\x1b[36m",
  comment: "\x1b[90m",
  punctuation: "\x1b[90m",
  operator: "\x1b[90m",
};

export function createTwinkleplopHighlight(tokenize: Tokenize): (line: string) => string {
  return (line) => {
    const { tokens, token_types } = tokenize(line);
    let result = "";
    let position = 0;
    for (let i = 0; i < tokens.length; i += 3) {
      const start = tokens[i + 1];
      const end = tokens[i + 2];
      const color = colors[token_types[tokens[i]]];
      result += line.slice(position, start);
      const text = line.slice(start, end);
      result += color ? color + text + RESET : text;
      position = end;
    }
    return result + line.slice(position);
  };
}
