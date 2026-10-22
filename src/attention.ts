// Supervising many agents: which ones need you, and which share a checkout (and so may edit the
// same files).
import type { AgentInfo, Tab } from "./types";

/** Agents waiting for you (longest-waiting first), then ones that finished while you looked elsewhere (latest first). */
export function attention(tabs: Tab[]): Tab[] {
  const waiting = tabs
    .filter((t) => t.agentRunning && t.status === "waiting")
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const done = tabs.filter((t) => t.unseen && t.status === "done").sort((a, b) => b.updatedAt - a.updatedAt);
  return [...waiting, ...done];
}

/** The next tab needing you after the active one (wrapping around), or null when none does. */
export function nextAttention(tabs: Tab[], activeId: string | null): Tab | null {
  const queue = attention(tabs);
  const at = queue.findIndex((t) => t.id === activeId);
  const next = queue[(at + 1) % queue.length];
  return next && next.id !== activeId ? next : null;
}

/** The checkout an agent works in: its worktree, else its repo. */
export const checkoutOf = (tab: Tab) => tab.worktree ?? tab.repoRoot;

/** Started with the agent's worktree flag, so it will move into a worktree of its own. */
function inOwnWorktree(tab: Tab, agents: AgentInfo[]): boolean {
  const flag = agents.find((a) => a.name === tab.agent)?.options.worktree;
  return !!flag && !tab.worktree && !!tab.launchArgv?.some((a) => a === flag || a.startsWith(flag + "="));
}

/** A running agent (not in a worktree) whose repo contains `folder`: a new agent there would share its files. */
export function busyIn(tabs: Tab[], folder: string, agents: AgentInfo[]): Tab | undefined {
  return tabs.find((t) => {
    const repo = t.repoRoot;
    return (
      t.agentRunning &&
      !t.worktree &&
      !inOwnWorktree(t, agents) &&
      !!repo &&
      (folder === repo || folder.startsWith(repo + "/"))
    );
  });
}

/** Running agents in a checkout another running agent also works in, each with the other agents' titles. */
export function sharedCheckouts(tabs: Tab[], agents: AgentInfo[]): Map<string, string[]> {
  const byCheckout = new Map<string, Tab[]>();
  for (const tab of tabs) {
    const checkout = checkoutOf(tab);
    if (!tab.agentRunning || !checkout || inOwnWorktree(tab, agents)) continue;
    byCheckout.set(checkout, [...(byCheckout.get(checkout) ?? []), tab]);
  }
  const out = new Map<string, string[]>();
  for (const group of byCheckout.values()) {
    if (group.length < 2) continue;
    for (const tab of group)
      out.set(
        tab.id,
        group.filter((t) => t !== tab).map((t) => t.title),
      );
  }
  return out;
}
