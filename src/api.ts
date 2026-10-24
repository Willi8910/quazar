import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AgentInfo,
  AppInfo,
  Config,
  FileChange,
  HookStatus,
  Launch,
  Metrics,
  NotifyPermission,
  PastSession,
  Skill,
  PersistedState,
  ProcessInfo,
  UpdateStatus,
} from "./types";

export const api = {
  spawn: (
    tabId: string,
    cwd: string,
    cols: number,
    rows: number,
    prefill: string | null,
    onData: Channel<ArrayBuffer>,
  ) => invoke<void>("pty_spawn", { tabId, cwd, cols, rows, prefill, onData }),
  write: (tabId: string, data: string) => invoke<void>("pty_write", { tabId, data }),
  resize: (tabId: string, cols: number, rows: number) => invoke<void>("pty_resize", { tabId, cols, rows }),
  kill: (tabId: string) => invoke<void>("pty_kill", { tabId }),
  terminate: (tabId: string) => invoke<void>("pty_terminate", { tabId }),
  attach: (tabId: string, onData: Channel<ArrayBuffer>) => invoke<void>("pty_attach", { tabId, onData }),
  detach: (tabId: string) => invoke<void>("pty_detach", { tabId }),
  handoffPut: (tabId: string, data: string) => invoke<void>("handoff_put", { tabId, data }),
  handoffTake: (tabId: string) => invoke<string | null>("handoff_take", { tabId }),
  openWindow: (label: string) => invoke<void>("open_window", { label }),
  gitChanges: (path: string) => invoke<FileChange[]>("git_changes", { path }),
  gitFileDiff: (path: string, file: string, untracked: boolean) =>
    invoke<string>("git_file_diff", { path, file, untracked }),
  processMetrics: () => invoke<Metrics>("process_metrics"),
  updateStatus: () => invoke<UpdateStatus>("update_status"),
  appInfo: () => invoke<AppInfo>("app_info"),
  notificationPermission: () => invoke<NotifyPermission>("notification_permission"),
  requestNotificationPermission: () => invoke<NotifyPermission>("request_notification_permission"),
  openNotificationSettings: () => invoke<void>("open_notification_settings"),
  notify: (tabId: string, title: string, subtitle: string, body: string) =>
    invoke<boolean>("notify", { tabId, title, subtitle, body }),
  updateBuild: () => invoke<void>("update_build"),
  updateInstall: () => invoke<void>("update_install"),
  tabProcesses: (tabId: string) => invoke<ProcessInfo[]>("tab_processes", { tabId }),
  stopProcess: (tabId: string, pid: number) => invoke<void>("stop_process", { tabId, pid }),

  loadState: () => invoke<PersistedState | null>("load_state"),
  saveState: (state: PersistedState) => invoke<void>("save_state", { state }),
  loadConfig: () => invoke<Config>("load_config"),
  saveConfig: (config: Config) => invoke<void>("save_config", { config }),
  configPath: () => invoke<string>("config_path"),

  agentList: () => invoke<AgentInfo[]>("agent_list"),

  resumeCommand: (agent: string, argv: string[], sessionId: string) =>
    invoke<string | null>("build_resume_command", { agent, argv, sessionId }),

  detectLaunch: (cmdline: string) => invoke<Launch | null>("detect_launch", { cmdline }),
  listSessions: (folder: string) => invoke<PastSession[]>("list_sessions", { folder }),
  listSkills: (agent: string, cwd: string) => invoke<Skill[]>("list_skills", { agent, cwd }),

  forkCommand: (agent: string, argv: string[], sessionId: string) =>
    invoke<string | null>("build_fork_command", { agent, argv, sessionId }),

  hooksStatus: () => invoke<HookStatus[]>("hooks_status"),
  installHooks: (agent: string) => invoke<string>("install_hooks", { agent }),

  scanProjects: (roots: string[], depth: number) => invoke<string[]>("scan_projects", { roots, depth }),
  gitRoot: (path: string) => invoke<string | null>("git_root", { path }),
  openInVSCode: (paths: string[]) => invoke<string>("open_in_vscode", { paths }),
  worktreeRoot: (path: string) => invoke<string | null>("worktree_root", { path }),
  gitBranch: (path: string) => invoke<string | null>("git_branch", { path }),
  openInFinder: (path: string) => invoke<void>("open_in_finder", { path }),

  quit: () => invoke<void>("quit_app"),
};
