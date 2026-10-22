/** An agent's id, e.g. "claude". The supported agents are defined in the backend (`agents/`). */
export type AgentName = string;

export interface AgentInfo {
  name: AgentName;
  label: string;
  /** Colour of the agent's tag. */
  color: string;
  /** Executable names that start it. */
  programs: string[];
  /** Shown after installing its hooks. */
  installNote: string;
  /** Whether a session can be forked into a new one. */
  canFork: boolean;
  /** Flags behind the launcher's checkboxes; null when the agent has none for that option. */
  options: Record<LaunchOption, string | null>;
}

/** Launcher checkboxes that add a flag to the profile's command. */
export type LaunchOption = "bypass" | "plan" | "worktree";

/** What the agent in a tab is doing. Only meaningful while `agentRunning`. */
export type AgentStatus = "idle" | "working" | "waiting" | "done";

export interface Tab {
  id: string;
  cwd: string;
  repoRoot: string | null;
  title: string;
  /** Where the title came from; "custom" titles are never overwritten. */
  titleSource: "auto" | "prompt" | "terminal" | "custom";
  /** Custom group id; null = placed by the groups' folder rules; "none" = kept out of custom groups. */
  groupId: string | null;
  agent: AgentName | null;
  /** The command the agent was started with, flags included. */
  launchArgv: string[] | null;
  sessionId: string | null;
  /** The agent's own working directory (from its hooks); differs from `cwd` when it works in a git worktree. */
  agentCwd?: string | null;
  /** Last git worktree the agent worked in. Kept across resumes, which restart in the main checkout. */
  worktree?: string | null;
  agentRunning: boolean;
  status: AgentStatus;
  detail: string;
  summary: string;
  lastPrompt: string;
  /** Finished or needs attention while the user was looking elsewhere. */
  unseen: boolean;
  /** Left out of the sidebar unless hidden tabs are shown; its shell keeps running. */
  hidden?: boolean;
  /** A quick terminal: listed under "Terminals" instead of its folder (unless put in a group). */
  loose?: boolean;
  /** Label of the window showing the tab (one window per tab); unset = the main window. */
  window?: string;
  /** Uncommitted changes in the tab's checkout, as of the agent's last turn (see `git_changes`). */
  changes?: ChangeCount | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChangeCount {
  files: number;
  added: number;
  removed: number;
}

/** A file changed in a checkout since its last commit (see `git_changes`). */
export interface FileChange {
  path: string;
  /** "M", "A", "D" or "?" (untracked). */
  status: string;
  added: number;
  removed: number;
}

export interface Group {
  id: string;
  name: string;
  folders: string[];
  collapsed: boolean;
  /** Containing group id, or a folder group key (`auto:<root>`); unset = top level. */
  parent?: string | null;
}

export interface Profile {
  id: string;
  name: string;
  /** Empty for a plain shell. */
  command: string;
  /** Flags the launcher checkboxes add; unset ones fall back to the agent's known flags. */
  options?: Partial<Record<LaunchOption, string>>;
}

export interface Config {
  sidebarSide: "left" | "right";
  sidebarWidth: number;
  /** Sidebar text scale (⌘+/⌘− while the sidebar is focused). */
  sidebarZoom: number;
  /** Group tabs outside custom groups by repo/folder; off = one flat list. */
  autoGroup: boolean;
  fontSize: number;
  fontFamily: string;
  projectRoots: string[];
  scanDepth: number;
  profiles: Profile[];
  /** Shell commands run in order right before every agent launch and resume, e.g. `usa`. */
  preLaunch: string[];
  lastProfileId?: string;
  /** Show hidden tabs (dimmed) in the sidebar. */
  showHiddenTabs?: boolean;
  /** The first-launch setup was finished or skipped. */
  onboarded?: boolean;
  /** Build time of the Quazar last opened, to say so when it changed (an update). */
  seenBuild?: number;
  /** Text next to the console header's button icons (on for new users; off = icons only). */
  headerLabels?: boolean;
  /** How the Changes dialog shows a diff. */
  diffView?: "unified" | "split";
  /** Launcher checkboxes, remembered between launches. */
  launchOptions: Record<LaunchOption, boolean>;
}

export interface Usage {
  count: number;
  last: number;
}

export interface PersistedState {
  version: 1;
  tabs: Tab[];
  groups: Group[];
  activeId: string | null;
  usage: Record<string, Usage>;
  collapsedAuto: string[];
  /** Sidebar sections hidden as a whole; independent of each tab's own `hidden`. */
  hiddenSections?: string[];
  /** Section keys in the order the user dragged them into. */
  sectionOrder: string[];
  /** Agent sessions that were open in a tab, kept after the tab closes so they can be resumed as launched. */
  sessionLog?: SessionRecord[];
  /** Windows besides the main one; `activeId` above is the main window's. */
  windows?: WindowRecord[];
}

/** A window besides the main one, and the tab it shows. */
export interface WindowRecord {
  label: string;
  activeId: string | null;
  /** Unset = hidden: the main window usually shows the sidebar already. */
  sidebarHidden?: boolean;
}

/** An agent session that ran in a Quazar tab: how it was launched, and what the tab showed. */
export interface SessionRecord {
  agent: AgentName;
  sessionId: string;
  launchArgv: string[];
  cwd: string;
  worktree?: string | null;
  title: string;
  titleSource: Tab["titleSource"];
  lastPrompt: string;
  summary: string;
  updatedAt: number;
}

/** A session from an agent's own history (see `list_sessions`). */
export interface PastSession {
  agent: AgentName;
  id: string;
  /** Where it started, and resumes from. */
  cwd: string;
  /** Where the agent last worked, when elsewhere (e.g. a worktree). */
  lastCwd: string | null;
  title: string | null;
  firstPrompt: string | null;
  lastPrompt: string | null;
  lastReply: string | null;
  branch: string | null;
  model: string | null;
  /** ISO timestamp. */
  started: string | null;
  /** ms since the epoch. */
  updated: number;
  bypass: boolean | null;
  plan: boolean | null;
}

export interface Launch {
  agent: AgentName;
  argv: string[];
}

export interface ShellEvent {
  tab: string;
  kind: "preexec" | "precmd";
  cwd?: string;
  launch?: Launch | null;
}

export interface AgentEvent {
  tab: string;
  agent: AgentName;
  event: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  summary?: string | null;
}

export interface HookStatus {
  agent: AgentName;
  path: string;
  installed: boolean;
}

/** CPU (percent of one core) and resident memory (bytes). */
export interface ResourceUse {
  cpu: number;
  memory: number;
}

/** What a tab's shell and the programs under it use (see `process_metrics`). */
export interface TabUsage extends ResourceUse {
  tabId: string;
  processes: number;
  /** The busiest program under the shell, e.g. "claude". */
  top: string | null;
}

export interface AppInfo {
  version: string;
  /** Build time, ms since the epoch. */
  built: number | null;
}

/** Whether this app can be rebuilt from its source folder, and whether that source changed since. */
export interface UpdateStatus {
  supported: boolean;
  available: boolean;
  source: string;
}

/** Where updating Quazar stands. */
export type UpdatePhase =
  { phase: "available" } | { phase: "building"; line: string } | { phase: "ready" } | { phase: "failed"; log: string };

/** One process in a tab (see `tab_processes`). */
export interface ProcessInfo extends ResourceUse {
  pid: number;
  /** How deep under the tab's shell (the shell is 0). */
  depth: number;
  name: string;
  command: string;
  /** TCP ports it listens on. */
  ports: number[];
}

export interface Metrics {
  tabs: TabUsage[];
  app: ResourceUse;
  cores: number;
  totalMemory: number;
}
