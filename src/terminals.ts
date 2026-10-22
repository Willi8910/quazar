// xterm.js instances live outside React: one per tab, created on first view and kept
// (hidden) so scrollback survives tab switches. Only the visible one holds a WebGL context.
// Only the window showing a tab has its terminal; moving a tab hands its screen to the new window.
import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import { useApp } from "./store";
import type { Tab } from "./types";

interface Entry {
  term: Terminal;
  fit: FitAddon;
  serialize: SerializeAddon;
  host: HTMLDivElement;
  webgl: WebglAddon | null;
  running: boolean;
}

const entries = new Map<string, Entry>();
/** Command to type + run once the tab's shell shows its first prompt. */
const pendingRun = new Map<string, string>();

export const theme = {
  background: "#16181d",
  foreground: "#d6d9e0",
  cursor: "#d6d9e0",
  cursorAccent: "#16181d",
  selectionBackground: "#3b4252aa",
  black: "#1d2026",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#d6d9e0",
  brightBlack: "#5c6370",
  brightRed: "#ef7b85",
  brightGreen: "#a9d48a",
  brightYellow: "#f0cf8c",
  brightBlue: "#74bdf7",
  brightMagenta: "#d48ae6",
  brightCyan: "#67c7d2",
  brightWhite: "#ffffff",
};

function send(tabId: string, data: string) {
  const entry = entries.get(tabId);
  if (!entry) return;
  if (!entry.running) {
    // Shell has exited: any key starts a fresh one.
    void start(tabId);
    return;
  }
  void api.write(tabId, data);
}

function create(tabId: string, container: HTMLElement): Entry {
  const config = useApp.getState().config!;
  const term = new Terminal({
    allowProposedApi: true,
    fontFamily: config.fontFamily,
    fontSize: config.fontSize,
    lineHeight: 1.15,
    theme,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    // Kept modest: with many tabs, scrollback is most of the app's memory.
    scrollback: 5000,
    cursorBlink: true,
    drawBoldTextInBrightColors: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const serialize = new SerializeAddon();
  term.loadAddon(serialize);
  term.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri)));
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";

  const host = document.createElement("div");
  host.className = "term-host";
  // xterm measures fonts when opened, so the host must already be in the page.
  container.appendChild(host);
  term.open(host);

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    // Shift+Enter: newline inside Claude Code / Codex instead of submitting.
    if (e.key === "Enter" && e.shiftKey && plain) {
      send(tabId, "\x1b\r");
      return false;
    }
    if (e.metaKey && !e.ctrlKey && !e.altKey) {
      const keys: Record<string, string> = { ArrowLeft: "\x01", ArrowRight: "\x05", Backspace: "\x15" };
      if (keys[e.key]) {
        send(tabId, keys[e.key]);
        return false;
      }
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      send(tabId, e.key === "ArrowLeft" ? "\x1bb" : "\x1bf");
      return false;
    }
    return true;
  });

  // ⌘V with an image (no text) on the clipboard: hand it to the agent like Ctrl+V,
  // which makes Claude Code read the image from the clipboard itself.
  host.addEventListener(
    "paste",
    (e) => {
      const data = e.clipboardData;
      if (!data || data.getData("text/plain")) return;
      const hasImage = Array.from(data.items).some((i) => i.kind === "file" || i.type.startsWith("image/"));
      if (hasImage) {
        e.preventDefault();
        e.stopPropagation();
        send(tabId, "\x16");
      }
    },
    true,
  );

  term.onData((data) => {
    useApp.getState().setFocusArea("terminal");
    // Typing a command yourself dismisses the agent picker. Escape sequences are mostly the
    // terminal answering the shell's queries (or arrow keys), not typing.
    const typed = !data.startsWith("\x1b") || data === "\x1b";
    if (typed && useApp.getState().quickLaunchTab === tabId) useApp.setState({ quickLaunchTab: null });
    send(tabId, data);
  });
  term.onBinary((data) => send(tabId, data));
  term.onResize(({ cols, rows }) => {
    if (entries.get(tabId)?.running) void api.resize(tabId, cols, rows);
  });
  term.onTitleChange((title) => onTerminalTitle(tabId, title));

  const entry: Entry = { term, fit, serialize, host, webgl: null, running: false };
  entries.set(tabId, entry);
  return entry;
}

function onTerminalTitle(tabId: string, raw: string) {
  const tab = useApp.getState().tabs.find((t) => t.id === tabId);
  // Agents set a meaningful title (Claude: "✳ Fix login bug"); shells mostly don't, so only
  // take titles while an agent runs.
  if (!tab || tab.titleSource === "custom" || !tab.agentRunning) return;
  const title = raw.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  // An agent's bare program name ("claude") is not a useful title.
  const programs = useApp.getState().agents.flatMap((a) => a.programs);
  if (title && !programs.includes(title.toLowerCase()))
    useApp.getState().updateTab(tabId, { title, titleSource: "terminal" });
}

/** Starts the tab's shell. A restored agent tab gets its resume command typed in, not run. */
export async function start(tabId: string) {
  const state = useApp.getState();
  const tab = state.tabs.find((t) => t.id === tabId);
  const entry = entries.get(tabId);
  if (!tab || !entry) return;
  entry.running = true;
  state.setLive(tabId, true);
  const prefill = pendingRun.has(tabId) ? null : await resumeCommand(tab);

  const channel = new Channel<ArrayBuffer | number[]>();
  channel.onmessage = (data) =>
    entry.term.write(data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data));
  try {
    await api.spawn(tabId, tab.cwd, entry.term.cols, entry.term.rows, prefill, channel);
  } catch (err) {
    entry.running = false;
    entry.term.write(`\r\n\x1b[31mCould not start shell: ${String(err)}\x1b[0m\r\n`);
  }
}

/** Shows a shell that is already running, e.g. one moved here from another window. */
async function attach(tabId: string) {
  const entry = entries.get(tabId);
  if (!entry) return;
  entry.running = true;
  const screen = await api.handoffTake(tabId);
  if (screen) entry.term.write(screen);
  const channel = new Channel<ArrayBuffer | number[]>();
  channel.onmessage = (data) =>
    entry.term.write(data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data));
  try {
    await api.attach(tabId, channel);
  } catch {
    // It ended meanwhile.
    entry.running = false;
    useApp.getState().setLive(tabId, false);
    return;
  }
  // Full-screen programs (agents, k9s) redraw on a size change; nudge one even when the size is the same.
  const { cols, rows } = entry.term;
  await api.resize(tabId, Math.max(2, cols - 1), rows);
  await api.resize(tabId, cols, rows);
}

/**
 * Lets go of the tab's terminal for another window: its screen goes along as a handoff and the
 * shell keeps running, its output held back until the other window attaches.
 */
export async function release(tabId: string) {
  const entry = entries.get(tabId);
  if (!entry) return;
  entries.delete(tabId);
  if (entry.running) {
    await api.detach(tabId);
    // Let output already received reach the screen first.
    await new Promise<void>((resolve) => entry.term.write("", resolve));
    await api.handoffPut(tabId, entry.serialize.serialize({ scrollback: 5000 }));
  }
  entry.webgl?.dispose();
  entry.term.dispose();
  entry.host.remove();
}

/**
 * Frees the screens of tabs whose shell has ended (stopped, exited), except the one on view: a
 * stopped tab starts a fresh shell when opened again anyway.
 */
export function freeIdle() {
  const { activeId } = useApp.getState();
  for (const [id, entry] of entries) {
    if (entry.running || id === activeId) continue;
    entry.webgl?.dispose();
    entry.term.dispose();
    entry.host.remove();
    entries.delete(id);
  }
}

/** Drops terminals of tabs that were closed in another window. */
export function prune() {
  const ids = new Set(useApp.getState().tabs.map((t) => t.id));
  for (const [id, entry] of entries) {
    if (ids.has(id)) continue;
    entry.webgl?.dispose();
    entry.term.dispose();
    entry.host.remove();
    entries.delete(id);
  }
}

export async function resumeCommand(tab: Tab): Promise<string | null> {
  if (!tab.agent || !tab.sessionId || !tab.launchArgv) return null;
  const command = await api.resumeCommand(tab.agent, tab.launchArgv, tab.sessionId);
  return command && withPreLaunch(command);
}

/** Prefixes an agent command with the configured pre-launch commands, run one by one. */
export function withPreLaunch(command: string): string {
  const pre = (useApp.getState().config?.preLaunch ?? []).map((c) => c.trim()).filter(Boolean);
  return [...pre, command].join(" && ");
}

/** Queues a command to run in a new tab as soon as its shell is ready. */
export function queueRun(tabId: string, command: string) {
  pendingRun.set(tabId, command);
}

/** Runs `command` now, or as soon as the shell is ready. */
export function run(tabId: string, command: string) {
  if (entries.get(tabId)?.running) void api.write(tabId, command + "\r");
  else queueRun(tabId, command);
}

/** Called when the shell reports a prompt: run any queued profile command. */
export function onPrompt(tabId: string) {
  const run = pendingRun.get(tabId);
  if (run) {
    pendingRun.delete(tabId);
    void api.write(tabId, run + "\r");
  }
}

/** Tabs being stopped from the resource panel, for a clearer exit message. */
const stopping = new Set<string>();
export const markStopping = (tabId: string) => stopping.add(tabId);

export function onExit(tabId: string) {
  const stopped = stopping.delete(tabId);
  const state = useApp.getState();
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  state.setLive(tabId, false);
  state.updateTab(tabId, { agentRunning: false, detail: "" });
  const entry = entries.get(tabId);
  if (!entry) return;
  entry.running = false;
  // Out of sight: nothing to show the message to, so free its screen now.
  if (useApp.getState().activeId !== tabId) return freeIdle();
  const resume = tab.agent && tab.sessionId ? " (its resume command will be typed in)" : "";
  entry.term.write(
    stopped
      ? `\r\n\x1b[2m[stopped to free resources — press any key to start again${resume}]\x1b[0m\r\n`
      : "\r\n\x1b[2m[shell exited — press any key to start a new one]\x1b[0m\r\n",
  );
}

/** Puts the tab's terminal into `container`, starting its shell on first view. */
export function show(tabId: string, container: HTMLElement) {
  const entry = entries.get(tabId) ?? create(tabId, container);
  for (const [id, other] of entries) {
    const visible = id === tabId;
    other.host.style.display = visible ? "block" : "none";
    if (!visible && other.webgl) {
      other.webgl.dispose();
      other.webgl = null;
    }
  }
  if (entry.host.parentElement !== container) container.appendChild(entry.host);
  if (!entry.webgl) {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        entry.webgl = null;
      });
      entry.term.loadAddon(webgl);
      entry.webgl = webgl;
    } catch {
      entry.webgl = null; // DOM renderer fallback
    }
  }
  fitActive(tabId);
  if (!entry.running) void (useApp.getState().live[tabId] ? attach(tabId) : start(tabId));
  entry.term.focus();
}

export function fitActive(tabId: string | null) {
  const entry = tabId ? entries.get(tabId) : undefined;
  if (!entry || entry.host.style.display === "none") return;
  try {
    entry.fit.fit();
  } catch {
    /* not laid out yet */
  }
}

export function focus(tabId: string | null) {
  if (tabId) entries.get(tabId)?.term.focus();
}

export function writeInput(tabId: string, data: string) {
  send(tabId, data);
}

export function dispose(tabId: string) {
  const entry = entries.get(tabId);
  pendingRun.delete(tabId);
  void api.kill(tabId);
  if (!entry) return;
  entry.webgl?.dispose();
  entry.term.dispose();
  entry.host.remove();
  entries.delete(tabId);
}

export function setFont(fontSize: number, fontFamily: string) {
  for (const entry of entries.values()) {
    entry.term.options.fontSize = fontSize;
    entry.term.options.fontFamily = fontFamily;
  }
  fitActive(useApp.getState().activeId);
}
