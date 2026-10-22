import { describe, expect, it } from "vitest";
import { sessionRows } from "./sessions";
import type { PastSession, SessionRecord, Tab } from "./types";

const past = (id: string, extra: Partial<PastSession> = {}): PastSession => ({
  agent: "claude",
  id,
  cwd: "/r/api",
  lastCwd: null,
  title: null,
  firstPrompt: "fix the bug",
  lastPrompt: null,
  lastReply: null,
  branch: null,
  model: null,
  started: null,
  updated: 100,
  bypass: null,
  plan: null,
  ...extra,
});
const record = (sessionId: string, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  agent: "claude",
  sessionId,
  launchArgv: ["claude", "--dangerously-skip-permissions"],
  cwd: "/r/api",
  title: "fix the bug",
  titleSource: "prompt",
  lastPrompt: "",
  summary: "",
  updatedAt: 50,
  ...extra,
});
const tab = (sessionId: string, extra: Partial<Tab> = {}): Tab =>
  ({
    id: "t1",
    cwd: "/r/api",
    repoRoot: "/r/api",
    agent: "claude",
    sessionId,
    title: "t",
    titleSource: "auto",
    lastPrompt: "",
    summary: "",
    updatedAt: 10,
    ...extra,
  }) as Tab;

describe("sessionRows", () => {
  it("merges history, the session log and open tabs by session, newest first", () => {
    const rows = sessionRows(
      "/r/api",
      [past("a", { title: "AI title", updated: 100 }), past("b", { updated: 300 })],
      [tab("a", { title: "Mine", titleSource: "custom", summary: "done", updatedAt: 500 })],
      [record("a"), record("c", { updatedAt: 200 })],
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rows[0]).toMatchObject({ title: "Mine", customTitle: true, lastReply: "done", updated: 500 });
    expect(rows[0].tab?.id).toBe("t1");
    expect(rows[0].record?.launchArgv).toEqual(["claude", "--dangerously-skip-permissions"]);
    expect(rows[1]).toMatchObject({ title: "fix the bug", record: null, tab: null });
  });

  it("keeps the agent's title over a prompt title and skips other folders", () => {
    const rows = sessionRows(
      "/r/api",
      [past("a", { title: "AI title" })],
      [],
      [record("a"), record("x", { cwd: "/r/apiary" })],
    );
    expect(rows.map((r) => [r.id, r.title])).toEqual([["a", "AI title"]]);
  });

  it("marks a session that moved into a worktree", () => {
    const [row] = sessionRows("/r/api", [past("a", { lastCwd: "/r/api/.claude/worktrees/feat" })], [], []);
    expect(row.worktree).toBe("/r/api/.claude/worktrees/feat");
  });
});
