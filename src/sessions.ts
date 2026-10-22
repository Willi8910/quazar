// The resume list of a folder: agent sessions from the agents' own history, merged with the ones
// Quazar opened (open tabs, and the session log of closed ones), which know how they were launched.
import type { AgentName, PastSession, SessionRecord, Tab } from "./types";

export interface SessionRow {
  key: string;
  agent: AgentName;
  id: string;
  title: string;
  /** The title was set by the user; resuming keeps it. */
  customTitle: boolean;
  /** Where the session resumes from. */
  cwd: string;
  /** Git worktree the agent last worked in. */
  worktree: string | null;
  firstPrompt: string | null;
  lastPrompt: string | null;
  lastReply: string | null;
  branch: string | null;
  model: string | null;
  /** ms since the epoch. */
  started: number | null;
  updated: number;
  /** Last permission mode, when known. */
  bypass: boolean | null;
  plan: boolean | null;
  /** Open in this tab. */
  tab: Tab | null;
  /** Launched from Quazar: resumes with this exact command. */
  record: SessionRecord | null;
}

/** `path` is `folder` or inside it. */
export const within = (path: string, folder: string) => path === folder || path.startsWith(folder + "/");

const isWorktree = (path: string | null | undefined) => (path && /\/worktrees?\//.test(path) ? path : null);

export function sessionRows(folder: string, past: PastSession[], tabs: Tab[], log: SessionRecord[]): SessionRow[] {
  const rows = new Map<string, SessionRow>();
  const row = (agent: AgentName, id: string, cwd: string): SessionRow => {
    const key = `${agent}:${id}`;
    if (!rows.has(key))
      rows.set(key, {
        key,
        agent,
        id,
        title: "",
        customTitle: false,
        cwd,
        worktree: null,
        firstPrompt: null,
        lastPrompt: null,
        lastReply: null,
        branch: null,
        model: null,
        started: null,
        updated: 0,
        bypass: null,
        plan: null,
        tab: null,
        record: null,
      });
    return rows.get(key)!;
  };

  for (const s of past) {
    Object.assign(row(s.agent, s.id, s.cwd), {
      title: s.title ?? "",
      worktree: isWorktree(s.lastCwd),
      firstPrompt: s.firstPrompt,
      lastPrompt: s.lastPrompt,
      lastReply: s.lastReply,
      branch: s.branch,
      model: s.model,
      started: s.started ? Date.parse(s.started) || null : null,
      updated: s.updated,
      bypass: s.bypass,
      plan: s.plan,
    });
  }
  // Quazar's own knowledge wins over the history files: newer for open tabs, and user-named.
  const overlay = (
    r: SessionRow,
    from: { title: string; titleSource: Tab["titleSource"]; worktree?: string | null },
  ) => {
    if (from.titleSource === "custom") Object.assign(r, { title: from.title, customTitle: true });
    else if (!r.title && from.titleSource !== "auto") r.title = from.title;
    r.worktree = from.worktree ?? r.worktree;
  };
  for (const rec of log) {
    if (!within(rec.cwd, folder)) continue;
    const r = row(rec.agent, rec.sessionId, rec.cwd);
    r.record = rec;
    overlay(r, rec);
    r.lastPrompt ??= rec.lastPrompt || null;
    r.lastReply ??= rec.summary || null;
    r.updated = Math.max(r.updated, rec.updatedAt);
  }
  for (const tab of tabs) {
    if (!tab.agent || !tab.sessionId || !(within(tab.cwd, folder) || tab.repoRoot === folder)) continue;
    const r = row(tab.agent, tab.sessionId, tab.cwd);
    r.tab = tab;
    overlay(r, tab);
    r.lastPrompt = tab.lastPrompt || r.lastPrompt;
    r.lastReply = tab.summary || r.lastReply;
    r.updated = Math.max(r.updated, tab.updatedAt);
  }
  for (const r of rows.values()) r.title ||= r.firstPrompt || "Untitled session";
  return [...rows.values()].sort((a, b) => b.updated - a.updated);
}
