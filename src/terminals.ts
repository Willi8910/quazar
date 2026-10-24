// xterm.js instances live outside React: one per tab, created on first view and kept
// (hidden) so scrollback survives tab switches. Only the visible one holds a WebGL context.
// Only the window showing a tab has its terminal; moving a tab hands its screen to the new window.
import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { IBufferCell, IMarker, Terminal } from "@xterm/xterm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import { isWindows, joinCommands } from "./platform";
import { useApp } from "./store";
import type { Tab } from "./types";

interface Entry {
  term: Terminal;
  fit: FitAddon;
  serialize: SerializeAddon;
  host: HTMLDivElement;
  webgl: WebglAddon | null;
  running: boolean;
  /** Markers of the links coloured on screen (see `colorLinks`). */
  links: IMarker[];
  /** What the screen showed when links were last coloured, to skip unchanged screens. */
  linksSeen: string;
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

/**
 * Turns off what a full-screen program (an agent) may have left on when it was killed: mouse
 * tracking, focus reports, bracketed paste, the alternate screen, a hidden cursor.
 */
const RESET_MODES =
  "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l\x1b[?1004l\x1b[?2004l\x1b[?1049l\x1b[?25h\x1b[0m";

/** Mouse and focus reports the terminal sends by itself — not the user typing. */
const isReport = (data: string) => /^\x1b\[(<|M|I$|O$)/.test(data);

function send(tabId: string, data: string) {
  const entry = entries.get(tabId);
  if (!entry) return;
  if (!entry.running) {
    // Shell has exited: a key (not a mouse move) starts a fresh one.
    if (!isReport(data)) void start(tabId);
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
    // Windows, as in Windows Terminal: Ctrl+C copies when text is selected, Ctrl+V pastes (the browser's
    // paste, so an image still reaches the agent below).
    if (isWindows && e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      if (e.code === "KeyC" && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return false;
      }
      if (e.code === "KeyV") return false;
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

  const entry: Entry = { term, fit, serialize, host, webgl: null, running: false, links: [], linksSeen: "" };
  // Links in blue (xterm only underlines them on hover): looked for shortly after new output, a
  // scroll or a resize — never while the terminal is idle.
  let linkTimer: number | undefined;
  const linksLater = () => {
    window.clearTimeout(linkTimer);
    linkTimer = window.setTimeout(() => colorLinks(entry), 150);
  };
  term.onWriteParsed(linksLater);
  term.onScroll(linksLater);
  term.onResize(linksLater);
  entries.set(tabId, entry);
  return entry;
}

/** Reused while reading cells, instead of a new object per cell. */
let scratchCell: IBufferCell | undefined;

const URL_PATTERN = /https?:\/\/[^\s"'<>`\][{}|\\^]+/g;

/** Colours the links on screen blue: only the visible lines, and only when they changed. */
function colorLinks(entry: Entry) {
  const { term } = entry;
  if (entry.host.style.display === "none") return;
  const buffer = term.buffer.active;
  const lines = [];
  for (let y = buffer.viewportY; y < buffer.viewportY + term.rows; y++) {
    const line = buffer.getLine(y);
    if (line) lines.push({ y, line, text: line.translateToString(true) });
  }
  // Cheap check first: most output (an agent's spinner, typing) doesn't change which links show.
  const seen = buffer.viewportY + "\n" + lines.map((l) => (/https?:\/\//.test(l.text) ? l.text : "")).join("\n");
  if (seen === entry.linksSeen) return;
  entry.linksSeen = seen;
  for (const marker of entry.links) marker.dispose();
  entry.links = [];
  const cursorLine = buffer.baseY + buffer.cursorY;
  for (const { y, line, text: plain } of lines) {
    if (!/https?:\/\//.test(plain)) continue;
    // The line's text, and the column each character starts at (wide characters take two).
    let text = "";
    const columns: number[] = [];
    for (let x = 0; x < line.length; x++) {
      const cell = (scratchCell = line.getCell(x, scratchCell));
      if (!cell || cell.getWidth() === 0) continue; // second half of a wide character
      const chars = cell.getChars() || " ";
      // One column per UTF-16 unit, matching the string indexes the pattern reports.
      for (let i = 0; i < chars.length; i++) columns.push(x);
      text += chars;
    }
    for (const match of text.matchAll(URL_PATTERN)) {
      const url = match[0].replace(/[.,;:!?'")]+$/, "");
      const start = columns[match.index];
      const end = columns[match.index + url.length - 1] + 1;
      const marker = term.registerMarker(y - cursorLine);
      if (!marker) continue;
      term.registerDecoration({ marker, x: start, width: end - start, foregroundColor: theme.blue, layer: "top" });
      entry.links.push(marker);
    }
  }
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

/**
 * Starts the tab's shell. A tab whose agent was cut off (see `Tab.resumeOnOpen`) resumes the
 * session as soon as the shell is ready; one whose agent was exited gets the resume command typed in.
 */
export async function start(tabId: string) {
  const state = useApp.getState();
  const tab = state.tabs.find((t) => t.id === tabId);
  const entry = entries.get(tabId);
  if (!tab || !entry) return;
  entry.running = true;
  state.setLive(tabId, true);
  let prefill: string | null = null;
  if (!pendingRun.has(tabId)) {
    const resume = await resumeCommand(tab);
    if (resume && tab.resumeOnOpen) pendingRun.set(tabId, resume);
    else prefill = resume;
    if (tab.resumeOnOpen) state.updateTab(tabId, { resumeOnOpen: false });
  }

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
  return joinCommands([...pre, command]);
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
  if (stopped) {
    // Stopped by the user (Stop, hiding the tab): its agent never resumes by itself — opening the tab
    // types the resume command in, ready for Enter, also after a restart.
    state.updateTab(tabId, { agentRunning: false, agentExited: true, resumeOnOpen: false, detail: "" });
  } else {
    // The shell died under a running agent: resume when opened again.
    const cutOff = tab.agentRunning;
    state.updateTab(tabId, { agentRunning: false, detail: "", ...(cutOff && { resumeOnOpen: true }) });
  }
  const entry = entries.get(tabId);
  if (!entry) return;
  entry.running = false;
  // Out of sight: nothing to show the message to, so free its screen now.
  if (useApp.getState().activeId !== tabId) return freeIdle();
  if (stopped) {
    // A fresh console in place of the agent's screen, with its resume command typed in.
    entry.term.reset();
    const resumable = tab.agent && tab.sessionId;
    entry.term.write(
      `\x1b[2m[stopped to free resources${resumable ? " — press Enter to resume the session" : ""}]\x1b[0m\r\n`,
    );
    void start(tabId);
    return;
  }
  entry.term.write(RESET_MODES + "\r\n\x1b[2m[shell exited — press any key to start a new one]\x1b[0m\r\n");
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
  entry.linksSeen = "";
  colorLinks(entry);
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
