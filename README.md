# read-multiline

Simple multi-line input reader for Node.js terminals. Solves the limitation of Node.js's built-in `readline` module which only supports single-line input.

## Features

- **Enter** to submit, **Shift+Enter** / **Ctrl+J** to insert newlines (swappable)
- Arrow key cursor navigation across lines
- **Alt+Arrow** for word jumping / history, **Ctrl+Arrow** / **Cmd+Arrow** for line/buffer jumping
- **Delete**, **Ctrl+U**, **Ctrl+K** for forward delete and line editing
- **Ctrl+W** to delete previous word
- **Ctrl+Z** / **Ctrl+Y** for undo/redo
- **Ctrl+L** to clear screen and redraw
- Full-width (CJK) character support with correct cursor positioning
- Bracketed paste mode for multi-line paste
- Input history navigation (Up/Down at boundaries, Alt+Up/Down, Ctrl+P/N, PageUp/PageDown)
- File-based persistent history with automatic load/save
- Initial value pre-population
- Validation with debounced live feedback
- Max lines / max character length enforcement
- Terminal resize (SIGWINCH) handling
- **Ctrl+C** / **Ctrl+D** handling
- Non-TTY (pipe) input support
- Theme/style system with state-dependent styling
- Built-in presets for `@inquirer/prompts` and `@clack/prompts`
- `createPrompt()` factory for reusable shared configuration
- Zero dependencies

Best experience with terminals supporting the [kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) (kitty, iTerm2, WezTerm, Ghostty, foot, etc.). **Ctrl+J** always inserts a newline regardless of settings, serving as a universal fallback in all terminals.

## Install

```bash
pnpm add @toiroakr/read-multiline
```

## Usage

```typescript
import { readMultiline } from "@toiroakr/read-multiline";

const [value, error] = await readMultiline("Enter your message:", {
  history: { filePath: "./history.json" },
  maxLines: 10,
  maxLength: 1000,
  validate: (v) => (v.trim() === "" ? "Input cannot be empty" : undefined),
});

if (error) {
  if (error.kind === "cancel") console.log("Cancelled");
  else if (error.kind === "eof") console.log("EOF");
} else {
  console.log("You entered:", value);
}
```

### With presets

```typescript
import { createPrompt, presets } from "@toiroakr/read-multiline";

// inquirer-style prompt
const askInquirer = createPrompt(presets.inquirer);
const [name] = await askInquirer("What is your name?");
const [bio] = await askInquirer("Tell me about yourself:");

// clack-style prompt
const askClack = createPrompt(presets.clack);
const [input] = await askClack("Enter some text:");
```

## API

### `readMultiline(prompt, options?): Promise<ReadMultilineResult>`

Returns a `ReadMultilineResult` tuple:

- `[string, null]` on success (submitted input)
- `[null, { kind: "cancel" }]` on Ctrl+C (unless `onError` is set)
- `[null, { kind: "eof" }]` on Ctrl+D with empty input (unless `onError` is set)
- `[string, error]` when `onError` is set — receives current input and the error

| Parameter | Type     | Default | Description                                   |
| --------- | -------- | ------- | --------------------------------------------- |
| `prompt`  | `string` | `""`    | Prompt message on the header line above input |

| Option                   | Type                                             | Default          | Description                                                                                                          |
| ------------------------ | ------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `prefix`                 | `Stateful<string>`                               | `"> "`           | Prefix before the prompt message. Can be state-dependent                                                             |
| `linePrefix`             | `Stateful<string>`                               | same as `prefix` | Prefix for each input line. Can be state-dependent                                                                   |
| `theme`                  | `PromptTheme`                                    | `undefined`      | Theme for styling prompt elements                                                                                    |
| `input`                  | `TTYInput`                                       | `process.stdin`  | Input stream                                                                                                         |
| `output`                 | `WritableStream`                                 | `process.stdout` | Output stream                                                                                                        |
| `initialValue`           | `string`                                         | `undefined`      | Pre-populate the input                                                                                               |
| `history`                | `string[] \| HistoryOptions`                     | `[]`             | History entries or file-based persistent history                                                                     |
| `historyArrowNavigation` | `"single" \| "double" \| "disabled"`             | `"single"`       | How Up/Down interacts with history at boundaries                                                                     |
| `maxLines`               | `number`                                         | `undefined`      | Maximum number of lines                                                                                              |
| `maxLength`              | `number`                                         | `undefined`      | Maximum total character count                                                                                        |
| `validate`               | `(value: string) => string \| undefined \| null` | `undefined`      | Validation function (return error message to reject)                                                                 |
| `validateDebounceMs`     | `number`                                         | `300`            | Debounce interval for live validation                                                                                |
| `preferNewlineOnEnter`   | `boolean`                                        | `false`          | `true`: Enter=newline, `false`: Enter=submit                                                                         |
| `disabledKeys`           | `ModifiedEnterKey[]`                             | `[]`             | Key combos to disable                                                                                                |
| `clearAfterSubmit`       | `boolean`                                        | `true`           | **Deprecated.** Clear input from terminal after submit. Use `theme.submitRender` instead                             |
| `onError`                | `(error: ReadMultilineError) => unknown`         | `undefined`      | Error callback (Ctrl+C / Ctrl+D). Resolves `[value, error]` instead of `[null, error]`. Return value overrides error |
| `footer`                 | `string`                                         | `undefined`      | Fixed footer text below the editor                                                                                   |
| `helpFooter`             | `boolean \| HelpFooterDisplayOptions`            | `true`           | Auto-generated key bindings help footer                                                                              |

### Layout

The prompt renders as two visual areas: a **header line** and **input lines**.

```
[prefix][prompt]        ← header line (no input text here)
[linePrefix][line 1]    ← all input lines use linePrefix
[linePrefix][line 2]
```

When `prompt` is empty and `prefix` is empty, no header line is shown.

### `Stateful<T>`

Options like `prefix`, `linePrefix`, and theme styles accept a `Stateful<T>` value — either a plain value or an object with per-state values:

```typescript
// Plain value (same in all states)
prefix: "> "

// State-dependent values
prefix: {
  pending: "? ",      // while editing
  submitted: "✔ ",    // after submission
  cancelled: "✘ ",    // after Ctrl+C (optional, defaults to pending)
  error: "! ",        // on validation error (optional, defaults to pending)
}
```

### `PromptTheme`

| Property       | Type                        | Description                                         |
| -------------- | --------------------------- | --------------------------------------------------- |
| `prefix`       | `Stateful<StyleTextFormat>` | Style for the prefix text                           |
| `linePrefix`   | `Stateful<StyleTextFormat>` | Style for the line prefix text                      |
| `prompt`       | `StyleTextFormat`           | Style for the prompt message                        |
| `input`        | `StyleTextFormat`           | Style for user input text while editing             |
| `answer`       | `StyleTextFormat`           | Style for the answer text after submission          |
| `cancelAnswer` | `StyleTextFormat`           | Style for the answer text after cancellation        |
| `submitRender` | `"clear" \| "preserve"`     | How to render after submission (default: `"clear"`) |
| `cancelRender` | `"clear" \| "preserve"`     | How to render after Ctrl+C (default: `"clear"`)     |
| `error`        | `StyleTextFormat`           | Style for validation error messages                 |
| `success`      | `StyleTextFormat`           | Style for validation success messages               |
| `footer`       | `StyleTextFormat`           | Style for footer text                               |

`StyleTextFormat` is the format parameter of Node.js's `util.styleText()` — e.g. `"bold"`, `"red"`, `"cyan"`, `["strikethrough", "dim"]`.

### `createPrompt(shared)`

Create a reusable prompt function with shared configuration. Per-call options are shallow-merged over the shared config.

```typescript
import { createPrompt, presets } from "@toiroakr/read-multiline";

const ask = createPrompt(presets.inquirer);
const [name] = await ask("Name:");
const [email] = await ask("Email:");
```

### Presets

#### `presets.inquirer`

Mimics `@inquirer/prompts` visual style:

```
? Enter name:          (pending)
  John

✔ Enter name:          (submitted)
  John
```

- Blue `?` prefix → green `✔` on submit
- Bold prompt, cyan answer
- `submitRender: "preserve"`, `cancelRender: "preserve"`

#### `presets.clack`

Mimics `@clack/prompts` visual style:

```
│                      (pending)
◆  Enter name:
│  John

│                      (submitted)
◇  Enter name:
│  John
```

- Cyan `◆` → green `◇` on submit, red `■` on cancel, yellow `▲` on error
- Gray guide bar, dim answer, strikethrough+dim cancel answer
- `submitRender: "preserve"`, `cancelRender: "preserve"`

> **Note:** Ctrl+J (0x0A) always inserts a newline regardless of `preferNewlineOnEnter`.
> When `preferNewlineOnEnter: true` is set but the kitty keyboard protocol is not supported,
> the option automatically falls back to `false` to ensure submit (Enter) and newline (Ctrl+J) are always available.

### Key Bindings

The following table shows all key bindings and their availability across terminal types.

**Legend:** "All" = works in all terminals, "Kitty" = requires [kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)

#### Submit / Newline

`preferNewlineOnEnter` (default `false`) swaps the role of Enter and modified Enter keys. Ctrl+J always inserts a newline regardless of this setting.

| Key         | Action (`preferNewlineOnEnter: false`) | Action (`true`) | Terminal      |
| ----------- | -------------------------------------- | --------------- | ------------- |
| Enter       | Submit                                 | Newline         | All           |
| Shift+Enter | Newline                                | Submit          | Kitty         |
| Ctrl+Enter  | Newline                                | Submit          | Kitty         |
| Cmd+Enter   | Newline                                | Submit          | Kitty (macOS) |
| Alt+Enter   | Newline                                | Submit          | All \*        |
| Ctrl+J      | Newline                                | Newline         | All           |

\* Alt+Enter requires "Use Option as Meta key" on some macOS terminals.

#### Editing

| Key                                         | Action                                   | Terminal |
| ------------------------------------------- | ---------------------------------------- | -------- |
| Backspace                                   | Delete character backward (merges lines) | All      |
| Delete                                      | Delete character forward (merges lines)  | All      |
| Ctrl+U                                      | Delete to line start                     | All      |
| Ctrl+K                                      | Delete to line end                       | All      |
| Ctrl+W                                      | Delete previous word                     | All      |
| Ctrl+Z / Cmd+Z                              | Undo                                     | All \*\* |
| Ctrl+Y / Ctrl+Shift+Z / Cmd+Shift+Z / Cmd+Y | Redo                                     | All \*\* |
| Ctrl+L                                      | Clear screen and redraw                  | All      |

\*\* Ctrl+Z/Y work in all terminals. Cmd+Z/Y and Ctrl+Shift+Z require kitty protocol.

#### Cursor Movement

| Key                                  | Action                                     | Terminal      |
| ------------------------------------ | ------------------------------------------ | ------------- |
| Left / Right                         | Move cursor (crosses line boundaries)      | All           |
| Up / Down                            | Move between lines (history at boundaries) | All           |
| Alt+Left / Alt+Right                 | Word jump                                  | All           |
| Alt+Up / Alt+Down                    | History prev / next                        | All           |
| Ctrl+P / Ctrl+N                      | History prev / next                        | All           |
| PageUp / PageDown                    | History prev / next                        | All           |
| Ctrl+Left / Ctrl+Right               | Line start / end                           | All           |
| Ctrl+Up / Ctrl+Down                  | Buffer start / end                         | All           |
| Option+Left / Option+Right (ESC+b/f) | Word jump                                  | All (macOS)   |
| Cmd+Left / Cmd+Right                 | Line start / end                           | Kitty (macOS) |
| Ctrl+A / Ctrl+E                      | Line start / end                           | All           |
| Cmd+Up / Cmd+Down                    | Buffer start / end                         | Kitty (macOS) |
| Home / End                           | Line start / end                           | All           |

#### Control

| Key    | Action                                                                                                         | Terminal |
| ------ | -------------------------------------------------------------------------------------------------------------- | -------- |
| Ctrl+C | Cancel (returns `[null, { kind: "cancel" }]`, or `[value, error]` if `onError` is set)                         | All      |
| Ctrl+D | Delete at cursor, or EOF if empty (returns `[null, { kind: "eof" }]`, or `[value, error]` if `onError` is set) | All      |

### Disabling Keys

Use `disabledKeys` to ignore specific key combinations:

```typescript
// Disable Ctrl+J (e.g., if it conflicts with your app)
await readMultiline("", { disabledKeys: ["ctrl+j"] });

// Only allow Shift+Enter and Ctrl+J as newline
await readMultiline("", { disabledKeys: ["ctrl+enter", "cmd+enter", "alt+enter"] });
```

Valid values: `"shift+enter"`, `"ctrl+enter"`, `"cmd+enter"`, `"alt+enter"`, `"ctrl+j"`

### History

Pass an array for in-memory history, or a `HistoryOptions` object for file-based persistence:

```typescript
// In-memory history
await readMultiline("", { history: ["previous input"] });

// File-based persistent history
await readMultiline("", {
  history: { filePath: "~/.myapp/history.json", maxEntries: 50 },
});
```

| Option       | Type     | Default    | Description                    |
| ------------ | -------- | ---------- | ------------------------------ |
| `filePath`   | `string` | (required) | JSON file path for persistence |
| `maxEntries` | `number` | `100`      | Maximum entries to keep        |

The file is loaded synchronously at startup and saved asynchronously after each submit (errors are silently ignored). The parent directory is created automatically if it doesn't exist.

#### `historyArrowNavigation`

Controls how Up/Down arrow keys interact with history at boundaries:

- `"single"` (default): at boundary, one press navigates history
- `"double"`: at boundary, two consecutive presses navigate history
- `"disabled"`: Up/Down never triggers history — use dedicated keys (Alt+Up/Down, Ctrl+P/N, PageUp/PageDown) instead

### Footer

Use `footer` for custom text, `helpFooter` for auto-generated key bindings help:

```typescript
// Auto-generated help footer (detects terminal capabilities)
await readMultiline("", { helpFooter: true });

// Customized help footer
await readMultiline("", {
  helpFooter: {
    items: ["submit", "newline", "undo"], // Choose actions and order (default: ["submit", "newline", "undo", "cancel", "eof"])
    maxKeysPerAction: 3, // Show up to 3 key alternatives per action (default: 2)
    maxLines: 1, // Limit to 1 line (default: unlimited)
    style: "dim", // Overall style (default: "dim")
    keyStyle: "bold", // Style for key labels
  },
});

// Custom footer + help footer together
await readMultiline("", {
  footer: "Type your message below",
  helpFooter: true,
});
```

`helpFooter` automatically detects [kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) support and only shows keys available in the current terminal. The `preferNewlineOnEnter` and `disabledKeys` options are inherited, and terminal width is auto-calculated.

### Validation

When a `validate` function is provided:

1. On submit, the input is validated. If validation fails, a red error message appears below the input and submission is blocked.
2. After the first validation failure, validation runs on every change (debounced) with live feedback: red for errors, green "OK" when valid.
3. When a theme with error visual state is configured (e.g. `presets.clack`), the prefix and line prefix switch to their error-state appearance during validation errors.

### Limits

When `maxLines` or `maxLength` is set, input beyond the limit is silently blocked and a red error message appears below the input.

## License

MIT
