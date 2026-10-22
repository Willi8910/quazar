import { create } from "zustand";
import type {
  AgentInfo,
  AppInfo,
  Config,
  Group,
  LaunchOption,
  Metrics,
  PersistedState,
  Profile,
  SessionRecord,
  Tab,
  Usage,
  UpdatePhase,
  WindowRecord,
} from "./types";
import {
  buildTree,
  moveNode,
  MovePosition,
  Node,
  ownerGroupId,
  parseKey,
  pathTo,
  pathToTab,
  withoutHidden,
} from "./tree";
import { basename, newId } from "./util";

export type DropPosition = "before" | "after";

export type ModalState =
  | { kind: "palette" }
  | { kind: "launcher"; mode: "tab" | "agent"; groupId?: string | null }
  | { kind: "group-folders"; groupId: string }
  | {
      kind: "prompt";
      title: string;
      initial: string;
      onSubmit: (value: string) => void;
    }
  | { kind: "move-tab"; tabId: string }
  | { kind: "hooks" }
  | { kind: "settings" }
  | { kind: "sessions"; folder: string; groupId: string | null }
  | { kind: "changes"; tabId: string };

interface AppState {
  ready: boolean;
  /** This window's label ("main" for the main window). */
  me: string;
  /** Windows besides the main one (see `PersistedState.windows`). */
  windows: WindowRecord[];
  /** The tab each window is showing, by window label (shared between windows). */
  showing: Record<string, string | null>;
  config: Config | null;
  tabs: Tab[];
  groups: Group[];
  activeId: string | null;
  usage: Record<string, Usage>;
  collapsedAuto: string[];
  /** Sections hidden as a whole (see `PersistedState`). */
  hiddenSections: string[];
  sectionOrder: string[];
  /** See `PersistedState.sessionLog`. */
  sessionLog: SessionRecord[];
  /** Tabs whose shell is running in this app session. */
  live: Record<string, boolean>;
  /** Latest CPU/memory reading of the running tabs (polled). */
  metrics: Metrics | null;
  sidebarHidden: boolean;
  /** Last area the user clicked or typed in; ⌘+/⌘− zoom that one. */
  focusArea: "sidebar" | "terminal";
  modal: ModalState | null;
  projects: string[];
  /** Supported agents, from the backend. */
  agents: AgentInfo[];
  /** Set after an update, to say so once ("0.1.0 · built …"). */
  updated: string | null;
  /** This app's version and build time. */
  appInfo: AppInfo | null;
  /** Updating Quazar from its source folder; null when there's nothing to update. */
  update: UpdatePhase | null;
  /** Whether each agent has Quazar's hooks installed (without them its status never updates). */
  hooksInstalled: Record<string, boolean>;
  /** Brief confirmation shown at the bottom of the window. */
  toast: { id: number; text: string } | null;
  /** Folder opened from Finder that isn't in the project folders yet; offers to add it. */
  suggestedRoot: string | null;
  /** Tab showing the agent picker at the bottom of its new, empty console. */
  quickLaunchTab: string | null;
  /** Group waiting for the user to confirm its deletion. */
  pendingDelete: string | null;

  /** `activeId` is this window's tab, when it isn't the main window. */
  hydrate: (state: PersistedState | null, config: Config, activeId?: string | null) => void;
  setConfig: (patch: Partial<Config>) => void;
  /** Adds a tab at the end, or right after `afterId`, and activates it. */
  addTab: (cwd: string, groupId?: string | null, afterId?: string) => Tab;
  updateTab: (id: string, patch: Partial<Tab> | ((tab: Tab) => Partial<Tab>)) => void;
  removeTab: (id: string) => void;
  activate: (id: string | null) => void;
  setLive: (id: string, live: boolean) => void;
  /** Adds a group at the top level, or inside `parent` (a group id or folder group key). */
  addGroup: (name: string, folders: string[], parent?: string | null) => Group;
  updateGroup: (id: string, patch: Partial<Group>) => void;
  removeGroup: (id: string) => void;
  toggleAutoCollapsed: (key: string) => void;
  /** Moves a tab next to `targetTabId` (or to the end of node `nodeKey`) and into that node's group. */
  moveTab: (tabId: string, nodeKey: string, targetTabId: string | null, position: DropPosition) => void;
  /** Moves a sidebar node next to, or into, another (see `moveNode` in tree.ts). */
  moveNode: (key: string, targetKey: string, position: MovePosition) => void;
  touchFolder: (path: string) => void;
  openModal: (modal: ModalState | null) => void;
  setFocusArea: (area: "sidebar" | "terminal") => void;
  showToast: (text: string) => void;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  me: "main",
  windows: [],
  showing: {},
  config: null,
  tabs: [],
  groups: [],
  activeId: null,
  usage: {},
  collapsedAuto: [],
  hiddenSections: [],
  sectionOrder: [],
  sessionLog: [],
  live: {},
  metrics: null,
  sidebarHidden: false,
  focusArea: "terminal",
  modal: null,
  projects: [],
  agents: [],
  hooksInstalled: {},
  update: null,
  appInfo: null,
  updated: null,
  toast: null,
  suggestedRoot: null,
  quickLaunchTab: null,
  pendingDelete: null,

  hydrate: (state, config, activeId = state?.activeId) => {
    // Tabs of windows that no longer exist go back to the main window.
    const windows = state?.windows ?? [];
    const exists = (label?: string) => !label || windows.some((w) => w.label === label);
    set({
      ready: true,
      config: migrateConfig(config),
      windows,
      // Nothing is running after a restart; statuses are kept only as a record of the last turn.
      // (A new window hydrates from the main window's live state instead; see sync.ts.)
      tabs: (state?.tabs ?? []).map((t) => ({
        ...t,
        // An agent still running when Quazar quit resumes when its tab is opened.
        ...(get().me === "main" && { agentRunning: false, detail: "", resumeOnOpen: t.resumeOnOpen || t.agentRunning }),
        window: exists(t.window) ? t.window : undefined,
      })),
      groups: state?.groups ?? [],
      activeId: activeId ?? null,
      usage: state?.usage ?? {},
      collapsedAuto: state?.collapsedAuto ?? [],
      hiddenSections: state?.hiddenSections ?? [],
      sectionOrder: state?.sectionOrder ?? [],
      sessionLog: state?.sessionLog ?? [],
    });
    const { tabs, me } = get();
    if (!tabs.some((t) => t.id === get().activeId && ownedBy(t, me)))
      set({ activeId: tabs.find((t) => ownedBy(t, me))?.id ?? null });
  },

  setConfig: (patch) => set({ config: { ...get().config!, ...patch } }),

  addTab: (cwd, groupId = null, afterId) => {
    const now = Date.now();
    const tab: Tab = {
      id: newId("t"),
      cwd,
      repoRoot: null,
      title: basename(cwd),
      titleSource: "auto",
      groupId,
      agent: null,
      launchArgv: null,
      sessionId: null,
      agentRunning: false,
      status: "idle",
      detail: "",
      summary: "",
      lastPrompt: "",
      unseen: false,
      window: get().me === "main" ? undefined : get().me,
      createdAt: now,
      updatedAt: now,
    };
    const tabs = get().tabs;
    const at = afterId ? tabs.findIndex((t) => t.id === afterId) + 1 : 0;
    set({
      tabs: at > 0 ? [...tabs.slice(0, at), tab, ...tabs.slice(at)] : [...tabs, tab],
      activeId: tab.id,
    });
    get().touchFolder(cwd);
    return tab;
  },

  updateTab: (id, patch) => {
    const before = get().tabs.find((t) => t.id === id);
    set({
      tabs: get().tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              ...(typeof patch === "function" ? patch(t) : patch),
              updatedAt: Date.now(),
            }
          : t,
      ),
    });
    // The tab moved on to another session (`/clear`, `/resume`, a new launch): remember the old one.
    if (before?.sessionId && get().tabs.find((t) => t.id === id)?.sessionId !== before.sessionId) logSession(before);
  },

  removeTab: (id) => {
    const closing = get().tabs.find((t) => t.id === id);
    if (closing?.sessionId) logSession(closing);
    const { tabs, activeId, live } = get();
    const rest = tabs.filter((t) => t.id !== id);
    const { [id]: _, ...stillLive } = live;
    set({ tabs: rest, activeId: activeId === id ? nextOwned(tabs, id) : activeId, live: stillLive });
  },

  activate: (id) => {
    const tab = id ? get().tabs.find((t) => t.id === id) : null;
    // A tab in another window is opened there.
    if (tab && !ownedBy(tab, get().me)) return void showElsewhere?.(tab);
    set({ activeId: id });
    if (id) get().updateTab(id, { unseen: false });
    const { me, windows } = get();
    if (me !== "main") set({ windows: windows.map((w) => (w.label === me ? { ...w, activeId: id } : w)) });
  },

  setLive: (id, isLive) => set({ live: { ...get().live, [id]: isLive } }),

  addGroup: (name, folders, parent = null) => {
    const group: Group = { id: newId("g"), name, folders, collapsed: false, parent };
    set({ groups: [...get().groups, group] });
    return group;
  },

  updateGroup: (id, patch) =>
    set({
      groups: get().groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }),

  removeGroup: (id) => {
    // Nested groups and tabs move up to the removed group's place: its parent group, or — with no parent
    // group — back to the folder rules, so folder grouping picks them up again.
    const parent = get().groups.find((g) => g.id === id)?.parent ?? null;
    const parentGroup = parent ? parseKey(parent).group : null;
    set({
      groups: get()
        .groups.filter((g) => g.id !== id)
        .map((g) => (g.parent && parseKey(g.parent).group === id ? { ...g, parent } : g)),
      // Including tabs it only held through its folder rules.
      tabs: get().tabs.map((t) =>
        t.groupId === id || ownerGroupId(tabPath(t.id)) === id ? { ...t, groupId: parentGroup } : t,
      ),
      pendingDelete: get().pendingDelete === id ? null : get().pendingDelete,
    });
  },

  toggleAutoCollapsed: (key) => {
    const list = get().collapsedAuto;
    set({
      collapsedAuto: list.includes(key) ? list.filter((k) => k !== key) : [...list, key],
    });
  },

  moveTab: (tabId, nodeKey, targetTabId, position) => {
    const { tabs } = get();
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || tabId === targetTabId) return;
    const path = pathTo(sidebarTree(true), nodeKey);
    if (!path) return;
    const groupId = ownerGroupId(path);
    const moved = { ...tab, groupId };
    const rest = tabs.filter((t) => t.id !== tabId);
    let at = rest.length;
    if (targetTabId) {
      const i = rest.findIndex((t) => t.id === targetTabId);
      if (i >= 0) at = position === "before" ? i : i + 1;
    } else {
      // End of the node: right after its current last tab.
      const last = path[path.length - 1].tabs.filter((t) => t.id !== tabId).slice(-1)[0];
      if (last) at = rest.findIndex((t) => t.id === last.id) + 1;
    }
    set({ tabs: [...rest.slice(0, at), moved, ...rest.slice(at)] });
  },

  moveNode: (key, targetKey, position) => {
    if (key === targetKey) return;
    // The whole tree, so hidden nodes keep their place.
    const result = moveNode(sidebarTree(true), get(), key, targetKey, position);
    if (result) set(result);
  },

  touchFolder: (path) => {
    const prev = get().usage[path];
    set({
      usage: {
        ...get().usage,
        [path]: { count: (prev?.count ?? 0) + 1, last: Date.now() },
      },
    });
  },

  openModal: (modal) => set({ modal }),

  setFocusArea: (area) => get().focusArea !== area && set({ focusArea: area }),

  showToast: (text) => {
    const id = Date.now();
    set({ toast: { id, text } });
    window.setTimeout(() => get().toast?.id === id && set({ toast: null }), 1800);
  },
}));

export function persisted(): PersistedState {
  const { tabs, groups, activeId, usage, collapsedAuto, hiddenSections, sectionOrder, sessionLog, windows } =
    useApp.getState();
  return {
    version: 1,
    tabs,
    groups,
    activeId,
    usage,
    collapsedAuto,
    hiddenSections,
    sectionOrder,
    sessionLog,
    windows,
  };
}

/** Whether `tab` is shown in the window `label`. */
export const ownedBy = (tab: Tab, label: string) => (tab.window ?? "main") === label;

/** Whether this window shows `tab`. */
export const isMine = (tab: Tab) => ownedBy(tab, useApp.getState().me);

/** The tab this window shows after `id` closes or leaves: the next one of its own, else the previous. */
export function nextOwned(tabs: Tab[], id: string): string | null {
  const me = useApp.getState().me;
  const at = tabs.findIndex((t) => t.id === id);
  const mine = (t: Tab) => t.id !== id && ownedBy(t, me);
  return (tabs.slice(at + 1).find(mine) ?? tabs.slice(0, Math.max(at, 0)).reverse().find(mine))?.id ?? null;
}

/** Opens a tab that another window shows (set by actions.ts). */
let showElsewhere: ((tab: Tab) => void) | null = null;
export const onActivateElsewhere = (fn: (tab: Tab) => void) => (showElsewhere = fn);

/** Records the tab's agent session in the session log (newest first, the last 500 kept). */
function logSession(tab: Tab) {
  if (!tab.agent || !tab.sessionId || !tab.launchArgv) return;
  const record: SessionRecord = {
    agent: tab.agent,
    sessionId: tab.sessionId,
    launchArgv: tab.launchArgv,
    cwd: tab.cwd,
    worktree: tab.worktree,
    title: tab.title,
    titleSource: tab.titleSource,
    lastPrompt: tab.lastPrompt,
    summary: tab.summary,
    updatedAt: tab.updatedAt,
  };
  const rest = useApp.getState().sessionLog.filter((r) => r.sessionId !== tab.sessionId);
  useApp.setState({ sessionLog: [record, ...rest].slice(0, 500) });
}

/**
 * The sidebar tree (see tree.ts). Hidden nodes and tabs are left out unless hidden things are shown or
 * `includeHidden`.
 */
export function sidebarTree(includeHidden = false): Node[] {
  const { tabs, groups, config, sectionOrder, hiddenSections } = useApp.getState();
  const tree = buildTree(tabs, groups, config?.autoGroup ?? true, sectionOrder);
  return includeHidden || config?.showHiddenTabs ? tree : withoutHidden(tree, hiddenSections);
}

/** Nodes from the top of the sidebar down to the one holding the tab. */
export function tabPath(tabId: string): Node[] {
  return pathToTab(sidebarTree(true), tabId) ?? [];
}

/** Old default profiles that baked a flag into their own profile; now launcher checkboxes. */
const FLAG_PROFILES: Record<string, { command: string; option: LaunchOption }> = {
  "claude-bypass": {
    command: "claude --dangerously-skip-permissions",
    option: "bypass",
  },
  "claude-plan": { command: "claude --permission-mode plan", option: "plan" },
  "codex-yolo": { command: "codex --yolo", option: "bypass" },
};

function migrateConfig(config: Config): Config {
  // `preLaunch` was a single string in early configs.
  const preLaunch = ([] as string[]).concat(config.preLaunch ?? []);
  const launchOptions: Record<LaunchOption, boolean> = Object.assign(
    { bypass: false, plan: false, worktree: false },
    config.launchOptions,
  );
  let { profiles, lastProfileId } = config;
  const untouched = (p: Profile) => FLAG_PROFILES[p.id]?.command === p.command;
  if (profiles.some(untouched)) {
    // Replace the old flag profiles (only if unedited) with Codex/Gemini, keeping the last choice.
    const last = profiles.find((p) => p.id === lastProfileId);
    if (last && untouched(last)) {
      launchOptions[FLAG_PROFILES[last.id].option] = true;
      lastProfileId = last.command.split(" ")[0];
    }
    profiles = profiles.filter((p) => !untouched(p));
    for (const [id, name] of [
      ["claude", "Claude"],
      ["codex", "Codex"],
      ["gemini", "Gemini"],
    ]) {
      if (!profiles.some((p) => p.id === id)) profiles.push({ id, name, command: id });
    }
  }
  return { ...config, preLaunch, launchOptions, profiles, lastProfileId };
}

export function agentInfo(name: string | null | undefined): AgentInfo | undefined {
  return useApp.getState().agents.find((a) => a.name === name);
}

export function profileById(id: string | undefined): Profile | undefined {
  return useApp.getState().config?.profiles.find((p) => p.id === id);
}
