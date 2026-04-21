import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHelpFooter, _resetKittyDetection } from "./footer.js";

// Note: styleText strips ANSI codes in non-TTY environments (test).
// We test content correctness here; style application is tested via styleText's own contract.

describe("buildHelpFooter", () => {
  // In test env, kitty detection resolves to false (non-TTY).
  // Reset to undefined so all keys are shown by default in tests.
  beforeEach(() => {
    _resetKittyDetection(undefined);
  });

  afterEach(() => {
    _resetKittyDetection(undefined);
  });

  describe("default options", () => {
    it("includes Enter: submit and Shift+Enter/Ctrl+J: newline", () => {
      const footer = buildHelpFooter({ columns: 200 });
      expect(footer).toContain("Enter: submit");
      expect(footer).toContain("Shift+Enter/Ctrl+J: newline");
    });

    it("includes common control keys", () => {
      const footer = buildHelpFooter({ columns: 200 });
      expect(footer).toContain("Ctrl+Z: undo");
      expect(footer).toContain("Ctrl+C: cancel");
      expect(footer).toContain("Ctrl+D: EOF");
    });
  });

  describe("preferNewlineOnEnter: true", () => {
    it("Enter=newline, modified keys (minus Ctrl+J) for submit, Ctrl+J for newline", () => {
      const footer = buildHelpFooter({ preferNewlineOnEnter: true, columns: 200 });
      expect(footer).toContain("Enter/Ctrl+J: newline");
      expect(footer).toContain("Shift+Enter/Ctrl+Enter: submit");
      const submitIdx = footer.indexOf("submit");
      const newlineIdx = footer.indexOf("newline");
      expect(submitIdx).toBeLessThan(newlineIdx);
    });
  });

  describe("disabledKeys", () => {
    it("shows Ctrl+J/Ctrl+Enter when shift+enter is disabled", () => {
      const footer = buildHelpFooter({ disabledKeys: ["shift+enter"], columns: 200 });
      expect(footer).not.toContain("Shift+Enter");
      expect(footer).toContain("Ctrl+J/Ctrl+Enter: newline");
    });

    it("shows next available keys when multiple are disabled", () => {
      const footer = buildHelpFooter({
        disabledKeys: ["shift+enter", "ctrl+j"],
        columns: 200,
      });
      expect(footer).not.toContain("Shift+Enter");
      expect(footer).not.toContain("Ctrl+J");
      expect(footer).toContain("Ctrl+Enter/Alt+Enter: newline");
    });

    it("omits newline key when all modified keys are disabled", () => {
      const footer = buildHelpFooter({
        disabledKeys: ["shift+enter", "ctrl+j", "ctrl+enter", "alt+enter", "cmd+enter"],
        columns: 200,
      });
      expect(footer).not.toContain("newline");
      expect(footer).toContain("Enter: submit");
    });
  });

  describe("kitty detection", () => {
    it("excludes kitty-required keys when kitty is not supported", () => {
      _resetKittyDetection(false);
      const footer = buildHelpFooter({ columns: 200 });
      expect(footer).not.toContain("Shift+Enter");
      expect(footer).not.toContain("Ctrl+Enter");
      expect(footer).not.toContain("Cmd+Enter");
      expect(footer).toContain("Ctrl+J/Alt+Enter: newline");
    });

    it("includes kitty-required keys when kitty is supported", () => {
      _resetKittyDetection(true);
      const footer = buildHelpFooter({ columns: 200 });
      expect(footer).toContain("Shift+Enter/Ctrl+J: newline");
    });

    it("includes all keys when detection is pending (undefined)", () => {
      _resetKittyDetection(undefined);
      const footer = buildHelpFooter({ columns: 200 });
      expect(footer).toContain("Shift+Enter/Ctrl+J: newline");
    });
  });

  describe("grid layout", () => {
    it("arranges items in multiple columns for wide terminals", () => {
      const footer = buildHelpFooter({ columns: 120 });
      const lines = footer.split("\n");
      expect(lines.length).toBeLessThan(5);
    });

    it("falls back to single column for narrow terminals", () => {
      const footer = buildHelpFooter({ columns: 20 });
      const lines = footer.split("\n");
      expect(lines.length).toBe(5);
    });

    it("produces single line when terminal is wide enough", () => {
      const footer = buildHelpFooter({ columns: 200 });
      const lines = footer.split("\n");
      expect(lines.length).toBe(1);
    });

    it("limits lines with maxLines", () => {
      const footer = buildHelpFooter({ columns: 20, maxLines: 2 });
      const lines = footer.split("\n");
      expect(lines.length).toBe(2);
    });

    it("shows all lines when maxLines exceeds actual lines", () => {
      const footer = buildHelpFooter({ columns: 200, maxLines: 10 });
      const lines = footer.split("\n");
      expect(lines.length).toBe(1);
    });
  });

  describe("style option", () => {
    it("returns text content regardless of style", () => {
      const footer = buildHelpFooter({ style: "bold", columns: 200 });
      expect(footer).toContain("Enter: submit");
    });

    it("returns unstyled text when style is empty array", () => {
      const footer = buildHelpFooter({ style: [], columns: 200 });
      expect(footer).toContain("Enter: submit");
    });
  });

  describe("keyStyle option", () => {
    it("returns text content with keyStyle applied", () => {
      const footer = buildHelpFooter({ style: [], keyStyle: "bold", columns: 200 });
      expect(footer).toContain("Enter");
      expect(footer).toContain("submit");
    });
  });

  describe("maxKeysPerAction", () => {
    it("defaults to showing 2 keys per action", () => {
      const footer = buildHelpFooter({ columns: 200 });
      expect(footer).toContain("Shift+Enter/Ctrl+J: newline");
      expect(footer).not.toContain("Ctrl+Enter");
    });

    it("shows multiple keys separated by / when maxKeysPerAction > 1", () => {
      const footer = buildHelpFooter({ maxKeysPerAction: 2, columns: 200 });
      expect(footer).toContain("Shift+Enter/Ctrl+J: newline");
    });

    it("shows up to maxKeysPerAction keys", () => {
      const footer = buildHelpFooter({ maxKeysPerAction: 3, columns: 200 });
      expect(footer).toContain("Shift+Enter/Ctrl+J/Ctrl+Enter: newline");
      expect(footer).not.toContain("Alt+Enter");
    });

    it("skips disabled keys and shows remaining up to max", () => {
      const footer = buildHelpFooter({
        maxKeysPerAction: 2,
        disabledKeys: ["shift+enter"],
        columns: 200,
      });
      expect(footer).not.toContain("Shift+Enter");
      expect(footer).toContain("Ctrl+J/Ctrl+Enter: newline");
    });

    it("shows all enabled keys when maxKeysPerAction exceeds available keys", () => {
      const footer = buildHelpFooter({
        maxKeysPerAction: 10,
        disabledKeys: ["ctrl+enter", "alt+enter", "cmd+enter"],
        columns: 200,
      });
      expect(footer).toContain("Shift+Enter/Ctrl+J: newline");
    });
  });

  describe("items option", () => {
    it("shows only specified actions in order", () => {
      const footer = buildHelpFooter({ items: ["undo", "submit"], columns: 200 });
      expect(footer).toContain("Ctrl+Z: undo");
      expect(footer).toContain("Enter: submit");
      expect(footer).not.toContain("newline");
      expect(footer).not.toContain("cancel");
      expect(footer).not.toContain("EOF");
      const undoIdx = footer.indexOf("undo");
      const submitIdx = footer.indexOf("submit");
      expect(undoIdx).toBeLessThan(submitIdx);
    });

    it("shows only submit when items is ['submit']", () => {
      const footer = buildHelpFooter({ items: ["submit"], columns: 200 });
      expect(footer).toContain("Enter: submit");
      expect(footer).not.toContain("newline");
      expect(footer).not.toContain("undo");
    });

    it("respects preferNewlineOnEnter with custom items order", () => {
      const footer = buildHelpFooter({
        items: ["newline", "submit"],
        preferNewlineOnEnter: true,
        columns: 200,
      });
      expect(footer).toContain("Enter/Ctrl+J: newline");
      expect(footer).toContain("submit");
      const newlineIdx = footer.indexOf("newline");
      const submitIdx = footer.indexOf("submit");
      expect(newlineIdx).toBeLessThan(submitIdx);
    });

    it("returns empty string when items is empty", () => {
      const footer = buildHelpFooter({ items: [], columns: 200 });
      expect(footer).toBe("");
    });

    it("uses default items when not specified", () => {
      const footer = buildHelpFooter({ columns: 200 });
      expect(footer).toContain("submit");
      expect(footer).toContain("newline");
      expect(footer).toContain("undo");
      expect(footer).toContain("cancel");
      expect(footer).toContain("EOF");
    });

    it("supports all non-default actions", () => {
      const footer = buildHelpFooter({
        items: [
          "redo",
          "history",
          "word-jump",
          "line-start",
          "line-end",
          "delete-word",
          "delete-to-start",
          "delete-to-end",
          "clear-screen",
        ],
        columns: 200,
      });
      expect(footer).toContain("Ctrl+Y: redo");
      expect(footer).toContain("↑/↓: history");
      expect(footer).toContain("Alt+←/→: word jump");
      expect(footer).toContain("Ctrl+A/Home: line start");
      expect(footer).toContain("Ctrl+E/End: line end");
      expect(footer).toContain("Ctrl+W: delete word");
      expect(footer).toContain("Ctrl+U: delete to start");
      expect(footer).toContain("Ctrl+K: delete to end");
      expect(footer).toContain("Ctrl+L: clear screen");
    });

    it("does not show non-default actions by default", () => {
      const footer = buildHelpFooter({ columns: 200 });
      expect(footer).not.toContain("redo");
      expect(footer).not.toContain("history");
      expect(footer).not.toContain("word jump");
      expect(footer).not.toContain("clear screen");
    });
  });
});
