# read-multiline

Simple multi-line input reader for Node.js terminals. Solves the limitation of Node.js's built-in `readline` module which only supports single-line input.

## Features

- **Enter** to submit, **Shift+Enter** / **Ctrl+J** to insert newlines (swappable)
- Arrow key cursor navigation across lines
- **Alt+Arrow** for word jumping, **Cmd+Arrow** for line/buffer jumping
- **Delete**, **Ctrl+U**, **Ctrl+K** for forward delete and line editing
- **Ctrl+W** to delete previous word
- **Ctrl+Z** / **Ctrl+Y** for undo/redo
- **Ctrl+L** to clear screen and redraw
- Full-width (CJK) character support with correct cursor positioning
- Bracketed paste mode for multi-line paste
- Input history navigation (Up/Down at boundaries)
- Initial value pre-population
- Validation with debounced live feedback
- Max lines / max character length enforcement
- Terminal resize (SIGWINCH) handling
- **Ctrl+C** / **Ctrl+D** handling
- Non-TTY (pipe) input support
- Zero dependencies

Best experience with terminals supporting the [kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) (kitty, iTerm2, WezTerm, Ghostty, foot, etc.). Legacy terminals can use **Ctrl+J** as a universal newline/submit fallback.

## Install

```bash
pnpm add @toiroakr/read-multiline
```

## Usage

```typescript
import { readMultiline, CancelError, EOFError } from "@toiroakr/read-multiline";

try {
  const input = await readMultiline({
    prompt: "> ",
    linePrompt: "  ",
    history: ["previous input"],
    maxLines: 10,
    maxLength: 1000,
    validate: (v) => (v.trim() === "" ? "Input cannot be empty" : undefined),
  });
  console.log("You entered:", input);
} catch (e) {
  if (e instanceof CancelError) {
    console.log("Cancelled");
  } else if (e instanceof EOFError) {
    console.log("EOF");
  }
}
```

## API

### `readMultiline(options?): Promise<string>`

| Option               | Type                                             | Default          | Description                                          |
| -------------------- | ------------------------------------------------ | ---------------- | ---------------------------------------------------- |
| `prompt`             | `string`                                         | `""`             | Prompt for the first line                            |
| `linePrompt`         | `string`                                         | same as `prompt` | Prompt for continuation lines                        |
| `input`              | `TTYInput`                                       | `process.stdin`  | Input stream                                         |
| `output`             | `WritableStream`                                 | `process.stdout` | Output stream                                        |
| `initialValue`       | `string`                                         | `undefined`      | Pre-populate the input                               |
| `history`            | `string[]`                                       | `[]`             | History entries (oldest first)                       |
| `maxLines`           | `number`                                         | `undefined`      | Maximum number of lines                              |
| `maxLength`          | `number`                                         | `undefined`      | Maximum total character count                        |
| `validate`           | `(value: string) => string \| undefined \| null` | `undefined`      | Validation function (return error message to reject) |
| `validateDebounceMs` | `number`                                         | `300`            | Debounce interval for live validation                |
| `submitOnEnter`      | `boolean`                                        | `true`           | `true`: Enter=submit, `false`: Enter=newline         |
| `disabledKeys`       | `ModifiedEnterKey[]`                             | `[]`             | Key combos to disable                                |

### Key Bindings

The following table shows all key bindings and their availability across terminal types.

**Legend:** "All" = works in all terminals, "Kitty" = requires [kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)

#### Submit / Newline

`submitOnEnter` (default `true`) swaps the action column — Enter gets one role, all modified Enter keys get the other.

| Key         | Action (`submitOnEnter: true`) | Action (`false`) | Terminal      |
| ----------- | ------------------------------ | ---------------- | ------------- |
| Enter       | Submit                         | Newline          | All           |
| Shift+Enter | Newline                        | Submit           | Kitty         |
| Ctrl+Enter  | Newline                        | Submit           | Kitty         |
| Cmd+Enter   | Newline                        | Submit           | Kitty (macOS) |
| Alt+Enter   | Newline                        | Submit           | All \*        |
| Ctrl+J      | Newline                        | Submit           | All           |

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
| Ctrl+Left / Ctrl+Right               | Word jump                                  | All           |
| Option+Left / Option+Right (ESC+b/f) | Word jump                                  | All (macOS)   |
| Cmd+Left / Cmd+Right                 | Line start / end                           | Kitty (macOS) |
| Ctrl+A / Ctrl+E                      | Line start / end                           | All           |
| Cmd+Up / Cmd+Down                    | Buffer start / end                         | Kitty (macOS) |
| Home / End                           | Line start / end                           | All           |

#### Control

| Key    | Action                                            | Terminal |
| ------ | ------------------------------------------------- | -------- |
| Ctrl+C | Cancel (`CancelError`)                            | All      |
| Ctrl+D | Submit if input exists, EOF if empty (`EOFError`) | All      |

### Disabling Keys

Use `disabledKeys` to ignore specific key combinations:

```typescript
// Disable Ctrl+J (e.g., if it conflicts with your app)
await readMultiline({ disabledKeys: ["ctrl+j"] });

// Only allow Shift+Enter and Ctrl+J as newline
await readMultiline({ disabledKeys: ["ctrl+enter", "cmd+enter", "alt+enter"] });
```

Valid values: `"shift+enter"`, `"ctrl+enter"`, `"cmd+enter"`, `"alt+enter"`, `"ctrl+j"`

### Validation

When a `validate` function is provided:

1. On submit, the input is validated. If validation fails, a red error message appears below the input and submission is blocked.
2. After the first validation failure, validation runs on every change (debounced) with live feedback: red for errors, green "OK" when valid.

### Limits

When `maxLines` or `maxLength` is set, input beyond the limit is silently blocked and a red error message appears below the input.

## License

MIT
