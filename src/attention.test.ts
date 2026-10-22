import { describe, expect, it } from "vitest";
import { attention, nextAttention, sharedCheckouts } from "./attention";
import type { AgentInfo, Tab } from "./types";

const tab = (id: string, patch: Partial<Tab> = {}) =>
  ({
    id,
    title: id,
    agentRunning: true,
    status: "working",
    unseen: false,
    updatedAt: 0,
    repoRoot: "/repo",
    launchArgv: ["claude"],
    agent: "claude",
    ...patch,
  }) as Tab;
const agents = [{ name: "claude", options: { worktree: "--worktree" } }] as AgentInfo[];
const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id);

describe("attention queue", () => {
  const tabs = [
    tab("done-old", { status: "done", unseen: true, updatedAt: 1 }),
    tab("wait-new", { status: "waiting", updatedAt: 5 }),
    tab("done-new", { status: "done", unseen: true, updatedAt: 4 }),
    tab("wait-old", { status: "waiting", updatedAt: 2 }),
    tab("seen", { status: "done", updatedAt: 9 }),
    tab("busy"),
  ];

  it("puts the longest-waiting first, then the latest finished", () => {
    expect(ids(attention(tabs))).toEqual(["wait-old", "wait-new", "done-new", "done-old"]);
  });

  it("goes through the whole queue and wraps around", () => {
    expect(nextAttention(tabs, "busy")?.id).toBe("wait-old");
    expect(nextAttention(tabs, "wait-old")?.id).toBe("wait-new");
    expect(nextAttention(tabs, "done-old")?.id).toBe("wait-old");
    expect(nextAttention([tab("only", { status: "waiting" })], "only")).toBeNull();
  });
});

describe("shared checkouts", () => {
  it("flags running agents in the same checkout", () => {
    const found = sharedCheckouts([tab("a"), tab("b"), tab("c", { repoRoot: "/other" })], agents);
    expect([...found.keys()]).toEqual(["a", "b"]);
    expect(found.get("a")).toEqual(["b"]);
  });

  it("leaves out worktrees, stopped agents and agents headed for a worktree", () => {
    const tabs = [
      tab("a"),
      tab("b", { worktree: "/repo/.claude/worktrees/x" }),
      tab("c", { agentRunning: false }),
      tab("d", { launchArgv: ["claude", "--worktree"] }),
    ];
    expect(sharedCheckouts(tabs, agents).size).toBe(0);
  });
});
