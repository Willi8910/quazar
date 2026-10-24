/** What differs between macOS and Windows on the frontend: shortcut labels and keys, and names. */

export const isWindows = typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);
export const isMac = !isWindows;

/** The app's file manager. */
export const fileManager = isWindows ? "Explorer" : "Finder";

/**
 * App shortcuts by menu command id. On Windows plain Ctrl+key belongs to the shell (Ctrl+C, Ctrl+W, …),
 * so they use Ctrl+Shift, as Windows Terminal does.
 */
const SHORTCUTS: Record<string, { mac: string; win: string }> = {
  "new-agent": { mac: "⌘N", win: "Ctrl+Shift+N" },
  "new-tab": { mac: "⌘T", win: "Ctrl+Shift+T" },
  palette: { mac: "⌘K", win: "Ctrl+Shift+K" },
  "next-attention": { mac: "⌘J", win: "Ctrl+Shift+J" },
  "close-tab": { mac: "⌘W", win: "Ctrl+Shift+W" },
  "rename-tab": { mac: "⇧⌘R", win: "Ctrl+Shift+R" },
  "toggle-sidebar": { mac: "⌘B", win: "Ctrl+Shift+B" },
  "sidebar-side": { mac: "⇧⌘B", win: "Ctrl+Alt+B" },
  "next-tab": { mac: "⇧⌘]", win: "Ctrl+Tab" },
  "prev-tab": { mac: "⇧⌘[", win: "Ctrl+Shift+Tab" },
  settings: { mac: "⌘,", win: "Ctrl+," },
  "zoom-in": { mac: "⌘=", win: "Ctrl+=" },
  "zoom-out": { mac: "⌘-", win: "Ctrl+-" },
  "zoom-reset": { mac: "⌘0", win: "Ctrl+0" },
  "goto-tab": { mac: "⌘1–9", win: "Ctrl+Alt+1–9" },
  confirm: { mac: "⌘Enter", win: "Ctrl+Enter" },
};

/** The label of a shortcut on this platform, e.g. `key("palette")` is "⌘K" or "Ctrl+Shift+K". */
export function key(id: keyof typeof SHORTCUTS, windows = isWindows): string {
  const s = SHORTCUTS[id];
  return s ? (windows ? s.win : s.mac) : "";
}

/** The Windows command id for a keydown (menus aren't used there), or null. "goto-tab:3" for Ctrl+Alt+3. */
export function windowsShortcut(
  e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
) {
  if (!e.ctrlKey || e.metaKey) return null;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (e.altKey && !e.shiftKey && digit) return `goto-tab:${digit[1]}`;
  // By physical key: with Shift held, `e.key` is the shifted character.
  const name = e.code.startsWith("Key") ? e.code.slice(3) : e.key === "Tab" ? "Tab" : e.key;
  const pressed = ["Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", name].filter(Boolean).join("+");
  for (const [id, s] of Object.entries(SHORTCUTS)) if (s.win === pressed) return id;
  return null;
}

/** Whether the platform's "confirm" modifier is held (⌘ on macOS, Ctrl on Windows). */
export function modKey(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey">, windows = isWindows): boolean {
  return windows ? e.ctrlKey : e.metaKey;
}

/**
 * Commands run one after another, each only if the one before succeeded: `a && b` in zsh; nested
 * `a; if ($?) { b }` in PowerShell, as Windows PowerShell 5.1 has no `&&`.
 */
export function joinCommands(commands: string[], windows = isWindows): string {
  if (!windows) return commands.join(" && ");
  return commands.reduceRight((rest, command) => `${command}; if ($?) { ${rest} }`);
}
