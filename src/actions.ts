import { emitTo, listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { openPath } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import { busyIn, nextAttention } from "./attention";
import { launchCommand, profileAgent } from "./launch";
import { fileManager, isWindows, joinCommands, windowsShortcut } from "./platform";
import type { SessionRow } from "./sessions";
import {
  agentInfo,
  isMine,
  nextOwned,
  onActivateElsewhere,
  persisted,
  profileById,
  sidebarTree,
  tabPath,
  useApp,
} from "./store";
import { listenHere, requestSnapshot, startSync } from "./sync";
import { flatten, isCollapsed, pathTo, subtreeTabs, visibleTabs } from "./tree";
import * as terms from "./terminals";
import type { AgentEvent, Group, Profile, ShellEvent, Tab } from "./types";
import { basename, describeTool, digest, newId, setHome, shellQuote, tildify, untildify } from "./util";

const get = () => useApp.getState();
const tabById = (id: string) => get().tabs.find((t) => t.id === id);

// ---------- tabs ----------

/** Opens a tab in `cwd`, starting `profile` with the launcher's checked options. */
export function newTab(cwd: string, profile?: Profile, groupId: string | null = null): Tab {
  // Two agents in one checkout edit the same files; point to the Worktree option.
  const busy = profile?.command && !get().config!.launchOptions.worktree && busyIn(get().tabs, cwd, get().agents);
  if (busy) get().showToast(`“${busy.title}” is already working in this repo — consider Worktree`);
  const tab = get().addTab(cwd, groupId);
  // Opening a tab in a hidden or collapsed group shows the group again (its other hidden tabs stay hidden).
  const keys = tabPath(tab.id).map((n) => n.key);
  useApp.setState({ hiddenSections: get().hiddenSections.filter((k) => !keys.includes(k)) });
  expandNodes(keys);
  if (profile) get().setConfig({ lastProfileId: profile.id });
  void saveConfig();
  void api.gitRoot(cwd).then((repoRoot) => get().updateTab(tab.id, { repoRoot }));
  // The terminal view starts the shell when it shows the (now active) tab.
  const command = profile ? launchCommand(profile, get().config!.launchOptions) : "";
  if (command) terms.queueRun(tab.id, terms.withPreLaunch(command));
  return tab;
}

/** A plain shell in the home folder for odd jobs (k9s, aws …), kept out of the folder groups. */
export function newQuickTerminal() {
  const tab = newTab(untildify("~"));
  get().updateTab(tab.id, { loose: true, title: "Terminal" });
}

/** Opens a plain shell in `cwd` with a bar offering to start one of the agent profiles. */
export function newTabWithQuickLaunch(cwd: string, groupId: string | null = null) {
  const tab = newTab(cwd, undefined, groupId);
  useApp.setState({ quickLaunchTab: tab.id });
}

/** Starts `profile` (with the checked options) in the tab from {@link newTabWithQuickLaunch}. */
export function quickLaunch(tabId: string, profile: Profile) {
  useApp.setState({ quickLaunchTab: null });
  get().setConfig({ lastProfileId: profile.id });
  saveConfig();
  terms.run(tabId, terms.withPreLaunch(launchCommand(profile, get().config!.launchOptions)));
  terms.focus(tabId);
}

/** Picks a folder in Finder and opens a tab there; offers to remember folders outside the project folders. */
export async function newTabInPickedFolder(profile?: Profile, groupId: string | null = null) {
  const picked = await open({
    directory: true,
    title: "Open folder in a new tab",
  });
  if (typeof picked !== "string") return;
  newTab(picked, profile, groupId);
  if (!isKnownFolder(picked)) useApp.setState({ suggestedRoot: picked });
}

/** In the scanned repos, or within search depth of a project folder. */
function isKnownFolder(path: string) {
  const { projects, config } = get();
  if (projects.includes(path)) return true;
  return config!.projectRoots.map(untildify).some((root) => {
    if (path === root) return true;
    if (!path.startsWith(root + "/")) return false;
    return path.slice(root.length + 1).split("/").length <= config!.scanDepth;
  });
}

/** Answers the offer from {@link newTabInPickedFolder}. */
export function answerSuggestedRoot(add: boolean) {
  const path = get().suggestedRoot;
  useApp.setState({ suggestedRoot: null });
  if (!add || !path) return;
  get().setConfig({
    projectRoots: [...get().config!.projectRoots, tildify(path)],
  });
  saveConfig();
  void rescanProjects();
  get().showToast(`Added ${tildify(path)} to project folders`);
}

export async function closeTab(id: string) {
  const tab = tabById(id);
  if (!tab) return;
  if (tab.agentRunning && (tab.status === "working" || tab.status === "waiting")) {
    const ok = await ask(`The agent in “${tab.title}” is still working. Close the tab anyway?`, {
      title: "Close tab?",
      kind: "warning",
      okLabel: "Close",
    });
    if (!ok) return;
  }
  terms.dispose(id);
  get().removeTab(id);
}

/** Closes a tab right away, without asking (e.g. clearing out hidden tabs). */
export function deleteTab(id: string) {
  const tab = tabById(id);
  if (!tab) return;
  terms.dispose(id);
  get().removeTab(id);
  get().showToast(`Deleted ${tab.title}`);
}

/** Opens the tab's folder in VS Code — the agent's (last) worktree when it has one. */
export async function openInVSCode(id: string) {
  const tab = tabById(id);
  if (!tab) return;
  const candidates = [tab.worktree, tab.agentRunning ? tab.agentCwd : null, tab.cwd];
  await openFolderInVSCode(...candidates.filter((p): p is string => !!p));
}

/** Opens the first existing of `paths` in VS Code. */
export async function openFolderInVSCode(...paths: string[]) {
  try {
    await api.openInVSCode(paths);
  } catch (e) {
    await message(String(e), { title: "Couldn't open VS Code", kind: "error" });
  }
}

export async function copyText(text: string, what: string) {
  await navigator.clipboard.writeText(text);
  get().showToast(`${what} copied`);
}

export function revealInFinder(path: string) {
  api.openInFinder(path).catch(
    (e) =>
      void message(String(e), {
        title: `Couldn't open ${fileManager}`,
        kind: "error",
      }),
  );
}

export function visualOrder(): Tab[] {
  return visibleTabs(sidebarTree(), get().collapsedAuto);
}

export function cycleTab(delta: number) {
  const order = visualOrder().filter(isMine);
  if (!order.length) return;
  const at = order.findIndex((t) => t.id === get().activeId);
  get().activate(order[(at + delta + order.length) % order.length].id);
}

export function renameTab(id: string) {
  const tab = tabById(id);
  if (!tab) return;
  get().openModal({
    kind: "prompt",
    title: "Rename tab — leave empty to name it automatically again",
    initial: tab.title,
    onSubmit: (title) =>
      title.trim()
        ? get().updateTab(id, { title: title.trim(), titleSource: "custom" })
        : get().updateTab(id, { titleSource: "auto" }),
  });
}

/** Forking needs a live agent with a known session (and how it was launched, to keep its flags). */
export function canFork(tab: Tab): boolean {
  return tab.agentRunning && !!agentInfo(tab.agent)?.canFork && !!tab.sessionId && !!tab.launchArgv;
}

/** Opens a new tab next to `id` that continues its agent session as an independent fork. */
export async function forkTab(id: string) {
  const tab = tabById(id);
  if (!tab || !canFork(tab)) {
    await message("Forking needs an agent session running in this tab.", {
      title: "Nothing to fork",
    });
    return;
  }
  const command = await api.forkCommand(tab.agent!, tab.launchArgv!, tab.sessionId!);
  if (!command) return;
  const fork = get().addTab(tab.cwd, tab.groupId, tab.id);
  get().updateTab(fork.id, {
    repoRoot: tab.repoRoot,
    title: `${tab.title} (fork)`,
    titleSource: "custom",
    agent: tab.agent,
    launchArgv: tab.launchArgv,
    worktree: tab.worktree,
    summary: tab.summary,
  });
  terms.queueRun(fork.id, terms.withPreLaunch(command));
}

/**
 * Opens a session from the resume list: switches to its tab when it's open (unhiding it), else
 * resumes it in a new tab with the command it was launched with in Quazar, or for sessions
 * started elsewhere, the agent's profile with its last permission mode (other boxes as checked).
 */
export async function resumeSession(row: SessionRow, groupId: string | null) {
  if (row.tab && tabById(row.tab.id)) return revealTab(row.tab.id);
  const argv = row.record?.launchArgv ?? (await defaultLaunchArgv(row));
  const command = argv && (await api.resumeCommand(row.agent, argv, row.id));
  if (!command) {
    await message(`Couldn't build a command to resume this ${agentInfo(row.agent)?.label ?? row.agent} session.`, {
      title: "Can't resume",
    });
    return;
  }
  const tab = newTab(row.cwd, undefined, groupId);
  get().updateTab(tab.id, {
    title: digest(row.title, 48),
    titleSource: row.customTitle ? "custom" : "prompt",
    agent: row.agent,
    sessionId: row.id,
    launchArgv: argv,
    worktree: row.worktree,
    lastPrompt: row.lastPrompt ?? "",
    summary: row.lastReply ?? "",
  });
  terms.queueRun(tab.id, terms.withPreLaunch(command));
}

async function defaultLaunchArgv(row: SessionRow): Promise<string[] | null> {
  const profile = get().config!.profiles.find((p) => profileAgent(p)?.name === row.agent);
  const checked = { ...get().config!.launchOptions, worktree: false };
  if (row.bypass !== null) Object.assign(checked, { bypass: row.bypass, plan: !row.bypass && !!row.plan });
  const command = profile ? launchCommand(profile, checked) : agentInfo(row.agent)?.programs[0];
  return command ? ((await api.detectLaunch(command))?.argv ?? null) : null;
}

export async function copyResumeCommand(id: string) {
  const tab = tabById(id);
  const cmd = tab ? await terms.resumeCommand(tab) : null;
  if (!cmd) {
    await message("This tab has no agent session to resume yet.", {
      title: "Nothing to resume",
    });
    return;
  }
  await navigator.clipboard.writeText(joinCommands([`cd ${shellQuote(tab!.cwd)}`, cmd]));
}

/** Adds an empty "New Group" at the top level, or inside `parent` (a group id or folder group key). */
/** Expands the sidebar nodes `keys` (groups and folder nodes). */
export function expandNodes(keys: string[]) {
  const s = get();
  useApp.setState({
    groups: s.groups.map((g) => (g.collapsed && keys.includes(g.id) ? { ...g, collapsed: false } : g)),
    collapsedAuto: s.collapsedAuto.filter((k) => !keys.includes(k)),
  });
}

export function newGroup(parent: string | null = null): Group {
  const created = get().addGroup("New Group", [], parent);
  // Show where it went.
  if (parent) expandNodes([parent]);
  get().showToast("Group added · double-click its name to rename");
  return created;
}

/** What deleting group `id` affects, and where its contents go. */
export function groupDeletion(id: string) {
  const tree = sidebarTree(true);
  const path = pathTo(tree, id);
  const node = path?.[path.length - 1];
  const tabs = node ? subtreeTabs(node).length : 0;
  const groups = node ? flatten(node.children).filter((n) => n.kind === "group").length : 0;
  const parent = path && path.length > 1 ? path[path.length - 2].name : null;
  return { name: node?.name ?? "group", tabs, groups, parent };
}

/** Deletes a group; asks first (in a drawer) when it still holds tabs or groups. */
export function deleteGroup(id: string, confirmed = false) {
  const { name, tabs, groups } = groupDeletion(id);
  if (!confirmed && (tabs || groups)) {
    useApp.setState({ pendingDelete: id });
    return;
  }
  get().removeGroup(id);
  get().showToast(`Deleted ${name}`);
}

export function renameGroup(id: string) {
  const group = get().groups.find((g) => g.id === id);
  if (!group) return;
  get().openModal({
    kind: "prompt",
    title: "Rename group",
    initial: group.name,
    onSubmit: (name) => name.trim() && get().updateGroup(id, { name: name.trim() }),
  });
}

// ---------- config ----------

let configTimer: number | undefined;
export function saveConfig() {
  window.clearTimeout(configTimer);
  configTimer = window.setTimeout(() => {
    const config = get().config;
    if (config) void api.saveConfig(config);
  }, 300);
}

/** ⌘+ / ⌘− / ⌘0: zoom the sidebar or the terminals, whichever was used last. */
export function zoom(delta: number | null) {
  const config = get().config!;
  if (get().focusArea === "sidebar") {
    const sidebarZoom =
      delta === null ? 1 : Math.min(1.8, Math.max(0.7, Math.round((config.sidebarZoom + delta * 0.1) * 10) / 10));
    get().setConfig({ sidebarZoom });
  } else {
    const fontSize = delta === null ? 13 : Math.min(28, Math.max(9, config.fontSize + delta));
    get().setConfig({ fontSize });
    terms.setFont(fontSize, config.fontFamily);
  }
  saveConfig();
}

export function setSidebarWidth(width: number) {
  get().setConfig({
    sidebarWidth: Math.round(Math.min(560, Math.max(180, width))),
  });
  terms.fitActive(get().activeId);
}

/** Hides or shows one tab in the sidebar; separate from hiding its whole section. */
/** Hides (and stops, to free its resources) or unhides a tab. */
export async function setTabHidden(id: string, hidden: boolean) {
  if (hidden && !(await stopTabs([id], "Hide"))) return;
  const order = visualOrder();
  get().updateTab(id, { hidden });
  if (hidden) leaveHidden(order, [id]);
  const stopped = hidden && tabById(id)?.sessionId;
  get().showToast(hidden ? `Tab hidden${stopped ? " and stopped · unhide it to resume" : ""}` : "Tab unhidden");
}

/** Hides or shows a whole sidebar node (with everything in it). Its tabs keep their own hidden state. */
export async function setSectionHidden(key: string, hidden: boolean) {
  const order = visualOrder();
  const node = pathTo(sidebarTree(true), key)?.slice(-1)[0];
  // Hidden tabs are stopped, to free their resources.
  if (
    hidden &&
    node &&
    !(await stopTabs(
      subtreeTabs(node).map((t) => t.id),
      "Hide",
    ))
  )
    return;
  const list = get().hiddenSections.filter((k) => k !== key);
  useApp.setState({ hiddenSections: hidden ? [...list, key] : list });
  if (hidden && node)
    leaveHidden(
      order,
      subtreeTabs(node).map((t) => t.id),
    );
  get().showToast(`${hidden ? "Hid" : "Unhid"} ${node?.name ?? "group"}`);
}

/** If the active tab is among `ids` and now out of sight, moves to the nearest visible tab in `order`. */
function leaveHidden(order: Tab[], ids: string[]) {
  const { activeId, config } = get();
  if (!activeId || !ids.includes(activeId) || config!.showHiddenTabs) return;
  const visible = new Set(visualOrder().map((t) => t.id));
  const at = order.findIndex((t) => t.id === activeId);
  const stays = (t: Tab) => visible.has(t.id) && isMine(t);
  const next = order.slice(at + 1).find(stays) ?? order.slice(0, at).reverse().find(stays);
  get().activate(next?.id ?? null);
}

/** Unhides every hidden group and tab. */
export function unhideAll() {
  useApp.setState({
    hiddenSections: [],
    tabs: get().tabs.map((t) => (t.hidden ? { ...t, hidden: false } : t)),
  });
  get().showToast("Everything unhidden");
}

/** Unhides a tab, and any hidden group it's in, then opens it. */
export function revealTab(id: string) {
  if (tabById(id)?.hidden) get().updateTab(id, { hidden: false });
  const keys = new Set(tabPath(id).map((n) => n.key));
  useApp.setState({ hiddenSections: get().hiddenSections.filter((k) => !keys.has(k)) });
  get().activate(id);
}

/** Whether the tab, or a group it's in, is hidden. */
export function isTabHidden(id: string): boolean {
  const { hiddenSections } = get();
  return !!tabById(id)?.hidden || tabPath(id).some((n) => hiddenSections.includes(n.key));
}

export function toggleShowHiddenTabs() {
  get().setConfig({ showHiddenTabs: !get().config!.showHiddenTabs });
  saveConfig();
}

/** True when every sidebar node is collapsed. */
export function allSectionsCollapsed(): boolean {
  const { collapsedAuto } = get();
  return flatten(sidebarTree()).every((n) => isCollapsed(n, collapsedAuto));
}

/** Collapses every section, or expands them all when they're all collapsed already. */
export function toggleAllSections() {
  const collapse = !allSectionsCollapsed();
  const autoKeys = flatten(sidebarTree())
    .filter((n) => !n.group)
    .map((n) => n.key);
  const { collapsedAuto, groups } = get();
  useApp.setState({
    collapsedAuto: collapse
      ? Array.from(new Set([...collapsedAuto, ...autoKeys]))
      : collapsedAuto.filter((k) => !autoKeys.includes(k)),
    groups: groups.map((g) => ({ ...g, collapsed: collapse })),
  });
}

export function toggleAutoGroup() {
  get().setConfig({ autoGroup: !get().config!.autoGroup });
  saveConfig();
}

export function toggleSidebarSide() {
  get().setConfig({
    sidebarSide: get().config!.sidebarSide === "left" ? "right" : "left",
  });
  saveConfig();
}

export async function openConfigFile() {
  await openPath(await api.configPath());
}

export async function rescanProjects() {
  const config = get().config!;
  useApp.setState({
    projects: await api.scanProjects(config.projectRoots, config.scanDepth),
  });
}

/** Re-reads which agents have Quazar's hooks installed. */
export async function loadHookStatus() {
  const status = await api.hooksStatus().catch(() => []);
  useApp.setState({ hooksInstalled: Object.fromEntries(status.map((s) => [s.agent, s.installed])) });
}

export async function installHooks(agent: string) {
  try {
    const path = await api.installHooks(agent);
    void loadHookStatus();
    const note = agentInfo(agent)?.installNote;
    await message(`Quazar hooks added to ${path}.${note ? "\n\n" + note : ""}`, { title: "Hooks installed" });
  } catch (err) {
    await message(String(err), {
      title: "Could not install hooks",
      kind: "error",
    });
  }
}

/** Installs (or refreshes) the hooks of every supported agent, with one summary at the end. */
export async function installAllHooks(agents: string[]) {
  const done: string[] = [];
  const failed: string[] = [];
  for (const agent of agents) {
    const label = agentInfo(agent)?.label ?? agent;
    try {
      const path = await api.installHooks(agent);
      const note = agentInfo(agent)?.installNote;
      done.push(`• ${label}: ${tildify(path)}${note ? `\n  ${note}` : ""}`);
    } catch (err) {
      failed.push(`• ${label}: ${String(err)}`);
    }
  }
  void loadHookStatus();
  const parts = [
    done.length ? `Quazar hooks added for:\n${done.join("\n")}` : "",
    failed.length ? `Couldn't install for:\n${failed.join("\n")}` : "",
  ];
  await message(parts.filter(Boolean).join("\n\n"), {
    title: failed.length ? "Some hooks weren't installed" : "Hooks installed",
    kind: failed.length ? "warning" : "info",
  });
}

// ---------- quitting ----------

let quitting = false;
/** Quits (or, with `finish`, e.g. restarts to update) after saving, asking first if agents are working. */
export async function requestQuit(finish: () => Promise<unknown> = api.quit, verb = "Quit") {
  if (quitting) return;
  quitting = true;
  try {
    const busy = get().tabs.filter((t) => t.agentRunning && (t.status === "working" || t.status === "waiting"));
    if (busy.length) {
      // The question shows on the main window, which may be hidden (closed while others were open).
      await getCurrentWindow().show();
      const names = busy.map((t) => `• ${t.title}`).join("\n");
      const ok = await ask(
        `${busy.length} agent${busy.length > 1 ? "s are" : " is"} still working:\n${names}\n\n${verb === "Quit" ? "Quitting" : "Restarting"} stops them. Their sessions can be resumed later.`,
        { title: `${verb} Quazar?`, kind: "warning", okLabel: verb },
      );
      if (!ok) return;
    }
    await api.saveState(persisted());
    await finish();
  } catch (e) {
    await message(String(e), { title: `Couldn't ${verb.toLowerCase()}`, kind: "error" });
  } finally {
    quitting = false;
  }
}

// ---------- updating Quazar ----------
// For a Quazar built from source on this Mac: rebuild when the source changed, then swap and relaunch.

let updateCheckedAt = 0;

/** "0.1.0 · built Oct 22, 23:41" */
export function versionText(): string {
  const info = get().appInfo;
  if (!info) return "";
  const built = info.built
    ? new Date(info.built).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  return `${info.version}${built ? ` · built ${built}` : ""}`;
}

/** Reads the version, and announces a new build the first time it opens (the main window only). */
async function loadAppInfo() {
  const info = await api.appInfo().catch(() => null);
  useApp.setState({ appInfo: info });
  if (!info?.built || get().me !== "main") return;
  const seen = get().config!.seenBuild;
  if (seen === info.built) return;
  get().setConfig({ seenBuild: info.built });
  saveConfig();
  // The first run ever isn't an update.
  if (seen) useApp.setState({ updated: versionText() });
}

/** Looks for source changes since this build (at start, then on focus, at most every 5 minutes). */
export async function checkForUpdate(force = false) {
  const phase = get().update?.phase;
  if (phase === "building" || phase === "ready") return;
  if (!force && Date.now() - updateCheckedAt < 5 * 60_000) return;
  updateCheckedAt = Date.now();
  const status = await api.updateStatus().catch(() => null);
  useApp.setState({ update: status?.available ? { phase: "available" } : null });
}

/** Rebuilds Quazar in the background; progress arrives as `update-progress` / `update-built`. */
export async function startUpdate() {
  try {
    useApp.setState({ update: { phase: "building", line: "Starting the build…" } });
    await api.updateBuild();
  } catch (e) {
    if (!String(e).includes("already building")) useApp.setState({ update: { phase: "failed", log: String(e) } });
  }
}

/** Restarts into the new build. The main window saves the state, so it runs this. */
export function installUpdate() {
  if (get().me !== "main") return void emitTo("main", "install-update");
  void requestQuit(api.updateInstall, "Restart");
}

// ---------- events from the backend ----------

function visible(tabId: string) {
  return get().activeId === tabId && document.hasFocus();
}

/** A system notification about `tab`, unless it's on screen or that kind is turned off in Settings. */
type NotifyKind = "done" | "approval" | "input";

/**
 * Tells about an agent that finished or needs you, unless its tab is on screen or that kind is off in
 * Settings. Clicking the notification opens the tab.
 */
function notify(tab: Tab, kind: NotifyKind, text: string) {
  const config = get().config!;
  const enabled = kind === "done" ? config.notifyDone !== false : config.notifyWaiting !== false;
  if (!enabled || get().notifyPermission === "denied" || visible(tab.id)) return;
  const agent = agentInfo(tab.agent)?.label ?? "Your agent";
  const title = {
    done: `${agent} finished`,
    approval: `${agent} needs your approval`,
    input: `${agent} is waiting for you`,
  }[kind];
  // Which tab, and where it works: "Fix login bug · platform_api".
  const place = basename(tab.worktree ?? tab.repoRoot ?? tab.cwd);
  const subtitle = tab.title === place ? place : `${tab.title} · ${place}`;
  const body =
    text ||
    { done: "Ready for your next prompt.", approval: "It's waiting to run a tool.", input: "It needs your input." }[
      kind
    ];
  void api.notify(tab.id, title, subtitle, body).then((shown) => {
    // Without the system framework (development builds): a plain notification, no click-through.
    if (!shown) sendNotification({ title: `${title} — ${tab.title}`, body });
  });
}

/** A notification was clicked: the window showing that tab opens it. */
async function onNotificationClicked(tabId: string) {
  const tab = tabById(tabId);
  if (!tab || !isMine(tab)) return;
  if (tab.hidden) get().updateTab(tabId, { hidden: false });
  get().activate(tabId);
  const win = getCurrentWindow();
  await win.show();
  await win.unminimize();
  await win.setFocus();
}

/**
 * Reads whether macOS allows Quazar's notifications; with `ask`, shows the macOS prompt if it was
 * never answered.
 */
export async function checkNotifications(ask = false) {
  let permission = await api.notificationPermission().catch(() => "unsupported" as const);
  if (permission === "not-determined" && ask) permission = await api.requestNotificationPermission();
  useApp.setState({ notifyPermission: permission });
  return permission;
}

/** Asks for permission if needed and sends a sample notification; false when macOS blocks them. */
export async function testNotification(): Promise<boolean> {
  const permission = await checkNotifications(true);
  if (permission === "denied") return false;
  sendNotification({ title: "Quazar", body: "This is how you'll hear that an agent is done or needs you." });
  return true;
}

// Each window handles the events of the tabs it shows; the others get the result through sync.

function onShellEvent(ev: ShellEvent) {
  const tab = tabById(ev.tab);
  if (!tab || !isMine(tab)) return;
  if (ev.cwd && ev.cwd !== tab.cwd) {
    get().updateTab(tab.id, { cwd: ev.cwd });
    void api.gitRoot(ev.cwd).then((repoRoot) => get().updateTab(tab.id, { repoRoot }));
  }
  if (ev.kind === "preexec" && ev.launch) {
    get().updateTab(tab.id, {
      agent: ev.launch.agent,
      launchArgv: ev.launch.argv,
      agentRunning: true,
      agentExited: false,
      status: "idle",
      detail: "",
    });
  }
  if (ev.kind === "precmd") {
    // Back at the shell prompt with the agent gone: the user exited it.
    if (tab.agentRunning) get().updateTab(tab.id, { agentRunning: false, agentExited: true, detail: "" });
    terms.onPrompt(tab.id);
    window.dispatchEvent(new CustomEvent("quazar:prompt", { detail: tab.id }));
  }
}

/** Paths a tool call touches: file arguments, `cd X` / `git -C X`, and `…/worktrees/<name>`. */
function toolPaths(input: any, cwd: string): string[] {
  const out: string[] = [];
  for (const key of ["file_path", "path", "notebook_path", "cwd"]) {
    if (typeof input?.[key] === "string") out.push(input[key]);
  }
  if (typeof input?.command === "string") {
    const cmd: string = input.command;
    for (const m of cmd.matchAll(/(?:\bcd|\s-C)\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/g))
      out.push(m[1].replace(/^["']|["']$/g, ""));
    for (const m of cmd.matchAll(/[^\s"';&|=]*\/worktrees\/[^\s"';&|/)]+/g)) out.push(m[0]);
  }
  return Array.from(new Set(out.map((p) => (p.startsWith("/") || p.startsWith("~") ? p : `${cwd}/${p}`))));
}

/** Per tab: paths that weren't in a worktree yet (e.g. one being created); rechecked on Stop. */
const unresolved = new Map<string, Set<string>>();

/** Records the most recent git worktree among `paths` as the tab's worktree. */
async function trackWorktree(tabId: string, paths: Iterable<string>) {
  const known = tabById(tabId)?.worktree;
  for (const path of Array.from(paths).reverse()) {
    if (known && (path === known || path.startsWith(known + "/"))) return;
    const worktree = await api.worktreeRoot(path);
    if (worktree) {
      get().updateTab(tabId, { worktree });
      return;
    }
    if (path.includes("/worktrees/")) {
      if (!unresolved.has(tabId)) unresolved.set(tabId, new Set());
      unresolved.get(tabId)!.add(path);
    }
  }
}

function onAgentEvent(ev: AgentEvent) {
  const tab = tabById(ev.tab);
  if (!tab || !isMine(tab)) return;
  const p = ev.payload ?? {};
  // Any hook event means the agent is alive (also for tabs restored from a previous run).
  const agentCwd = typeof p.cwd === "string" && p.cwd ? p.cwd : tab.agentCwd;
  if (agentCwd && agentCwd !== tab.agentCwd) void trackWorktree(tab.id, [agentCwd]);
  // `/resume` or `/clear` inside the agent switches session without a new launch.
  const sessionId = typeof p.session_id === "string" && p.session_id ? p.session_id : tab.sessionId;
  const update = (patch: Partial<Tab>) =>
    get().updateTab(tab.id, {
      agent: ev.agent,
      agentRunning: true,
      agentExited: false,
      agentCwd,
      sessionId,
      ...patch,
    });
  switch (ev.event) {
    case "SessionStart":
      update({
        agent: ev.agent,
        sessionId: p.session_id ?? tab.sessionId,
        agentRunning: true,
        status: "idle",
        detail: "",
      });
      break;
    case "UserPromptSubmit": {
      const prompt = typeof p.prompt === "string" ? p.prompt : "";
      const patch: Partial<Tab> = {
        agentRunning: true,
        status: "working",
        detail: "",
        lastPrompt: digest(prompt, 200),
      };
      if (tab.titleSource === "auto" && prompt)
        Object.assign(patch, {
          title: digest(prompt, 48),
          titleSource: "prompt",
        });
      update(patch);
      break;
    }
    case "PreToolUse":
      void trackWorktree(tab.id, toolPaths(p.tool_input, agentCwd ?? tab.cwd));
      update({
        agentRunning: true,
        status: "working",
        detail: describeTool(p.tool_name ?? "Tool", p.tool_input),
      });
      break;
    case "Notification": {
      const msg: string = p.message ?? "";
      if (/permission|approv|needs your/i.test(msg) || tab.status === "working") {
        update({
          status: "waiting",
          detail: msg || "Needs your input",
          unseen: !visible(tab.id),
        });
        notify(tab, /permission|approv/i.test(msg) ? "approval" : "input", msg);
      }
      break;
    }
    case "PermissionRequest": {
      const tool = describeTool(p.tool_name ?? "tool", p.tool_input);
      const detail = `Approve ${tool}?`;
      update({ status: "waiting", detail, unseen: !visible(tab.id) });
      // "Bash: npm test", "Edit: login.ts"
      const name = p.tool_name ?? "a tool";
      const target = tool.slice(name.length).trim();
      notify(tab, "approval", target ? `${name}: ${target}` : `Use ${name}`);
      break;
    }
    case "Stop": {
      // Worktrees created during the turn only exist once their tool call has run.
      void trackWorktree(tab.id, unresolved.get(tab.id) ?? []);
      unresolved.delete(tab.id);
      const summary = digest(ev.summary ?? "") || tab.summary;
      update({ status: "done", detail: "", summary, unseen: !visible(tab.id) });
      void refreshChanges(tab.id, true);
      notify(tab, "done", summary);
      break;
    }
    case "SessionEnd":
      update({ agentRunning: false, agentExited: true, detail: "" });
      break;
  }
}

// ---------- changes ----------

/** The checkout whose changes a tab shows: the agent's worktree, else the tab's repo. */
export const changesPath = (tab: Tab) => tab.worktree ?? (tab.repoRoot ? tab.cwd : null);

const changesReadAt = new Map<string, number>();

/** Re-reads the tab's uncommitted changes (git runs only here: after a turn, on switching to it, on review). */
export async function refreshChanges(tabId: string, force = false) {
  const tab = tabById(tabId);
  const path = tab && changesPath(tab);
  if (!tab || !path || !tab.sessionId) return;
  if (!force && Date.now() - (changesReadAt.get(tabId) ?? 0) < 10_000) return;
  changesReadAt.set(tabId, Date.now());
  const files = await api.gitChanges(path).catch(() => null);
  const changes = files && {
    files: files.length,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
  };
  const before = tabById(tabId)?.changes;
  const same =
    before?.files === changes?.files && before?.added === changes?.added && before?.removed === changes?.removed;
  if (!same) get().updateTab(tabId, { changes });
}

/** Jumps to the next agent waiting for you or finished while you were away. */
export function nextNeedingYou() {
  const next = nextAttention(get().tabs, get().activeId);
  if (next) revealTab(next.id);
  else get().showToast("No agent needs you right now");
}

// ---------- resource use ----------

/** Reads CPU/memory every 3 s (every 15 s while the window is in the background). */
function pollMetrics() {
  const read = () =>
    api.processMetrics().then(
      (metrics) => useApp.setState({ metrics }),
      () => {},
    );
  void read();
  let last = Date.now();
  window.setInterval(() => {
    if (document.hidden && Date.now() - last < 15_000) return;
    last = Date.now();
    void read();
  }, 3000);
}

/**
 * Stops everything running in a tab to free its CPU and memory. The tab stays; an agent exits
 * cleanly and opening the tab again starts a shell that resumes the session.
 */
export async function stopTab(id: string) {
  const tab = tabById(id);
  if (tab && get().live[id] && (await stopTabs([id], "Stop")))
    get().showToast(`Stopped ${tab.title}${tab.sessionId ? " · its resume command is ready" : ""}`);
}

/**
 * Stops the running tabs among `ids` (asking first if an agent is still working); their agents
 * don't resume by themselves. False if the user cancelled.
 */
async function stopTabs(ids: string[], verb: "Stop" | "Hide"): Promise<boolean> {
  const running = ids.map(tabById).filter((t): t is Tab => !!t && !!get().live[t.id]);
  const busy = running.filter((t) => t.agentRunning && (t.status === "working" || t.status === "waiting"));
  if (busy.length) {
    const names = busy.map((t) => `• ${t.title}`).join("\n");
    const ok = await ask(
      `${busy.length === 1 ? "This agent is" : "These agents are"} still working:\n${names}\n\n${verb === "Hide" ? "Hiding stops" : "Stopping ends"} ${busy.length === 1 ? "it" : "them"}; you can resume later.`,
      { title: `${verb} anyway?`, kind: "warning", okLabel: verb },
    );
    if (!ok) return false;
  }
  for (const tab of running) {
    terms.markStopping(tab.id);
    await api.terminate(tab.id);
  }
  return true;
}

// ---------- windows ----------
// Each tab is shown in one window (`Tab.window`). Moving it hands its screen over and keeps its shell.

/** Moves the tab to a new window of its own. */
export async function openInNewWindow(tabId: string) {
  const tab = tabById(tabId);
  if (!tab) return;
  if (!isMine(tab)) return void emitTo(tab.window ?? "main", "give-tab", { tabId, to: null });
  const label = newId("w-");
  useApp.setState({ windows: [...get().windows, { label, activeId: tabId }] });
  await handOver(tabId, label);
  await api.openWindow(label);
}

/** Brings a tab shown in another window over to this one. */
export function moveTabHere(tabId: string) {
  const tab = tabById(tabId);
  if (tab && !isMine(tab)) void emitTo(tab.window ?? "main", "give-tab", { tabId, to: get().me });
}

/** Lets go of one of this window's tabs and gives it to the window `to`. */
async function handOver(tabId: string, to: string) {
  if (get().activeId === tabId) useApp.setState({ activeId: nextOwned(get().tabs, tabId) });
  await terms.release(tabId);
  get().updateTab(tabId, { window: to === "main" ? undefined : to });
}

async function onRevealTab(tabId: string) {
  const tab = tabById(tabId);
  if (!tab) return;
  // The handover may arrive before the synced tab does.
  if (!isMine(tab)) get().updateTab(tabId, { window: get().me === "main" ? undefined : get().me });
  get().activate(tabId);
}

/**
 * When this window is left without a tab of its own, it takes the next tab in the sidebar (after
 * `after`, the one it lost) that no window is showing, instead of falling back to the empty page.
 */
function fillEmpty(after: string | null) {
  if (closing || get().activeId) return;
  const shown = new Set(Object.values(get().showing));
  const order = visualOrder();
  const at = order.findIndex((t) => t.id === after);
  const free = (t: Tab) => t.id !== after && !shown.has(t.id);
  const pick = order.slice(at + 1).find(free) ?? order.slice(0, Math.max(at, 0)).find(free);
  if (pick) get().activate(pick.id); // moves it here if another window has it
}

/** Set while this window closes, so it doesn't take tabs on its way out. */
let closing = false;

/** Another window asks for one of this window's tabs; `to: null` means a new window. */
async function onGiveTab({ tabId, to }: { tabId: string; to: string | null }) {
  const tab = tabById(tabId);
  if (!tab || !isMine(tab)) return;
  if (!to) return openInNewWindow(tabId);
  await handOver(tabId, to);
  void emitTo(to, "reveal-tab", tabId);
}

/** Closing a window besides the main one: its tabs go back to the main window, still running. */
async function closeWindow() {
  const { me, tabs, windows } = get();
  // Its tabs go to a window that stays open: the main one, or (closing the main window) another.
  const to = me === "main" ? windows[0]?.label : "main";
  if (!to) return;
  closing = true;
  for (const tab of tabs.filter(isMine)) await handOver(tab.id, to);
  if (me === "main") {
    // The main window keeps the saved state, so it stays running, hidden; the dock icon brings it back.
    closing = false;
    return getCurrentWindow().hide();
  }
  useApp.setState({ windows: get().windows.filter((w) => w.label !== me) });
  await getCurrentWindow().destroy();
}

/** Whether this window can give the tab away: not when it would leave a window other than the main one empty. */
export function canOpenInNewWindow(tab: Tab) {
  return get().me === "main" || !isMine(tab) || get().tabs.filter(isMine).length > 1;
}

// ---------- startup ----------

let saveTimer: number | undefined;

export async function init() {
  setHome(await homeDir());
  const me = getCurrentWindow().label;
  useApp.setState({ me });
  // Opening a tab of another window (click, ⌘1–9, resume list…) moves it here; the other window stays put.
  onActivateElsewhere((tab) => moveTabHere(tab.id));
  if (me === "main") {
    const [state, config, agents] = await Promise.all([api.loadState(), api.loadConfig(), api.agentList()]);
    useApp.setState({ agents });
    get().hydrate(state, config);
    // Writes back any migrated settings (e.g. the old flag profiles turned into checkboxes).
    saveConfig();
  } else {
    const [snapshot, agents] = await Promise.all([requestSnapshot(), api.agentList()]);
    useApp.setState({ agents });
    const mine = snapshot.state.windows?.find((w) => w.label === me);
    get().hydrate(snapshot.state, snapshot.config, mine?.activeId ?? null);
    useApp.setState({
      live: snapshot.live,
      metrics: snapshot.metrics,
      showing: snapshot.showing,
      sidebarHidden: mine?.sidebarHidden ?? true,
    });
  }
  await startSync(onRemoteChange);
  useApp.subscribe((s, prev) => {
    if (prev.activeId && !s.activeId) fillEmpty(prev.activeId);
    if (s.activeId && s.activeId !== prev.activeId) void refreshChanges(s.activeId);
    if (s.activeId !== prev.activeId) terms.freeIdle();
    // An extra window remembers whether it shows the sidebar.
    if (s.sidebarHidden !== prev.sidebarHidden && s.me !== "main")
      useApp.setState({
        windows: s.windows.map((w) => (w.label === s.me ? { ...w, sidebarHidden: s.sidebarHidden } : w)),
      });
  });
  void rescanProjects();
  void loadHookStatus();
  void checkForUpdate(true);
  void loadAppInfo();
  window.addEventListener("focus", () => void checkForUpdate());
  await listen<string>("update-progress", (e) => {
    if (e.payload) useApp.setState({ update: { phase: "building", line: e.payload } });
  });
  await listen<{ ok: boolean; log: string }>("update-built", (e) =>
    useApp.setState({ update: e.payload.ok ? { phase: "ready" } : { phase: "failed", log: e.payload.log } }),
  );

  // Sent to this window only; the rest go to every window.
  await listenHere<string>("reveal-tab", (id) => void onRevealTab(id));
  await listenHere<{ tabId: string; to: string | null }>("give-tab", (ask) => void onGiveTab(ask));
  await listenHere("window-close", () => void closeWindow());
  await listenHere<string>("menu", (id) => onMenu(id));
  // Windows has no app menu (its Ctrl shortcuts would take keys from the shell): the window handles them.
  if (isWindows)
    window.addEventListener(
      "keydown",
      (e) => {
        const id = windowsShortcut(e);
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        onMenu(id.startsWith("goto-tab:") ? `tab-${id.slice(9)}` : id);
      },
      true,
    );
  await listen<ShellEvent>("shell-event", (e) => onShellEvent(e.payload));
  await listen<AgentEvent>("agent-event", (e) => onAgentEvent(e.payload));
  await listen<string>("notification-clicked", (e) => void onNotificationClicked(e.payload));
  await listen<string>("pty-exit", (e) => {
    const tab = tabById(e.payload);
    if (tab && isMine(tab)) terms.onExit(e.payload);
  });

  await getCurrentWebview().onDragDropEvent((e) => {
    const id = get().activeId;
    if (e.payload.type === "drop" && id && e.payload.paths.length) {
      terms.writeInput(id, e.payload.paths.map((word) => shellQuote(word)).join(" ") + " ");
      terms.focus(id);
    }
  });

  // Ask macOS once (it prompts only the first time); later, notice when it's been turned on or off.
  void checkNotifications(me === "main");
  window.addEventListener("focus", () => void checkNotifications());

  if (me === "main") await initMain();
}

/** After another window's change: keep this window on a tab of its own, and drop closed tabs' terminals. */
function onRemoteChange() {
  const { activeId, tabs } = get();
  const active = tabs.find((t) => t.id === activeId);
  if (activeId && (!active || !isMine(active)))
    useApp.setState({ activeId: tabs.find(isMine) ? nextOwned(tabs, activeId) : null });
  terms.prune();
}

/** The main window keeps the saved state, measures resource use, shows the dock badge and quits. */
async function initMain() {
  pollMetrics();
  // Already using Quazar: no first-launch setup.
  if (!get().config!.onboarded && get().tabs.length) {
    get().setConfig({ onboarded: true });
    saveConfig();
  }
  await listenHere<string>("window-gone", (label) => {
    useApp.setState({
      windows: get().windows.filter((w) => w.label !== label),
      tabs: get().tabs.map((t) => (t.window === label ? { ...t, window: undefined } : t)),
      showing: { ...get().showing, [label]: null },
    });
  });
  // Reopen the other windows that still have tabs.
  const windows = get().windows.filter((w) => get().tabs.some((t) => t.window === w.label));
  useApp.setState({ windows });
  for (const w of windows) void api.openWindow(w.label);

  // Persist every change (debounced) so a crash or reboot loses at most a moment.
  useApp.subscribe((s, prev) => {
    const keys = [
      "tabs",
      "groups",
      "activeId",
      "usage",
      "collapsedAuto",
      "hiddenSections",
      "sectionOrder",
      "sessionLog",
      "windows",
    ] as const;
    if (keys.every((k) => s[k] === prev[k])) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void api.saveState(persisted()), 400);
    if (s.tabs !== prev.tabs) {
      const waiting = s.tabs.filter((t) => t.agentRunning && t.status === "waiting").length;
      void getCurrentWindow().setBadgeCount(waiting || undefined);
    }
  });

  await listenHere("quit-requested", () => void requestQuit());
  await listenHere("install-update", () => installUpdate());
}

export function onMenu(id: string) {
  const s = get();
  const active = s.activeId;
  if (id.startsWith("tab-")) {
    const tab = visualOrder()[Number(id.slice(4)) - 1];
    if (tab) s.activate(tab.id);
    return;
  }
  switch (id) {
    case "quit":
      // The main window keeps the saved state, so it runs the quit.
      return s.me === "main" ? void requestQuit() : void emitTo("main", "quit-requested");
    case "new-tab":
      return s.openModal({ kind: "launcher", mode: "tab" });
    case "new-agent":
      return s.openModal({ kind: "launcher", mode: "agent" });
    case "close-tab":
      // ⌘W with no tabs left closes the window (or quits, if it's the last one).
      if (active) return void closeTab(active);
      return void getCurrentWindow().close();
    case "rename-tab":
      return active && renameTab(active);
    case "next-attention":
      return nextNeedingYou();
    case "next-tab":
      return cycleTab(1);
    case "prev-tab":
      return cycleTab(-1);
    case "palette":
      return s.openModal(s.modal?.kind === "palette" ? null : { kind: "palette" });
    case "toggle-sidebar":
      return useApp.setState({ sidebarHidden: !s.sidebarHidden });
    case "sidebar-side":
      return toggleSidebarSide();
    case "zoom-in":
      return zoom(1);
    case "zoom-out":
      return zoom(-1);
    case "zoom-reset":
      return zoom(null);
    case "settings":
      return s.openModal({ kind: "settings" });
    case "install-hooks":
      return s.openModal({ kind: "hooks" });
  }
}

export { profileById };
