import { describe, expect, it } from "vitest";
import { joinCommands, key, windowsShortcut } from "./platform";

const press = (code: string, keyName: string, mods: { shift?: boolean; alt?: boolean; meta?: boolean } = {}) => ({
  code,
  key: keyName,
  ctrlKey: true,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
});

describe("shortcuts", () => {
  it("labels each platform", () => {
    expect(key("palette", false)).toBe("⌘K");
    expect(key("palette", true)).toBe("Ctrl+Shift+K");
  });

  it("maps Windows keys to commands", () => {
    expect(windowsShortcut(press("KeyK", "K", { shift: true }))).toBe("palette");
    expect(windowsShortcut(press("KeyB", "b", { alt: true }))).toBe("sidebar-side");
    expect(windowsShortcut(press("Tab", "Tab", { shift: true }))).toBe("prev-tab");
    expect(windowsShortcut(press("Equal", "="))).toBe("zoom-in");
    expect(windowsShortcut(press("Digit3", "3", { alt: true }))).toBe("goto-tab:3");
  });

  it("maps Alt+arrows to back and forward", () => {
    const alt = (key: string) => ({ code: key, key, ctrlKey: false, shiftKey: false, altKey: true, metaKey: false });
    expect(windowsShortcut(alt("ArrowLeft"))).toBe("go-back");
    expect(windowsShortcut(alt("ArrowRight"))).toBe("go-forward");
    expect(windowsShortcut({ ...alt("ArrowLeft"), shiftKey: true })).toBeNull();
  });

  it("leaves plain Ctrl keys to the shell", () => {
    expect(windowsShortcut(press("KeyC", "c"))).toBeNull();
    expect(windowsShortcut(press("KeyW", "w"))).toBeNull();
  });
});

describe("joinCommands", () => {
  it("chains with && in zsh", () => {
    expect(joinCommands(["usa", "claude"], false)).toBe("usa && claude");
  });

  it("nests if ($?) in PowerShell", () => {
    expect(joinCommands(["a", "b", "c"], true)).toBe("a; if ($?) { b; if ($?) { c } }");
    expect(joinCommands(["claude"], true)).toBe("claude");
  });
});
