import { describe, expect, it } from "vitest";
import { pickSkills, skillInvoked } from "./skills";
import type { Skill } from "./types";

const skill = (name: string, modified: number, scope: Skill["scope"] = "user"): Skill => ({
  name,
  description: `${name} it`,
  scope,
  modified,
});

describe("skillInvoked", () => {
  const known = (name: string) => ["ship", "review"].includes(name);

  it("finds a skill typed as a slash command", () => {
    expect(skillInvoked("/ship", known)).toBe("ship");
    expect(skillInvoked("  /review the login page", known)).toBe("review");
    expect(skillInvoked("/superpowers:brainstorming", known)).toBe("superpowers:brainstorming");
  });

  it("ignores built-in commands and ordinary prompts", () => {
    expect(skillInvoked("/clear", known)).toBeNull();
    expect(skillInvoked("please /ship it", known)).toBeNull();
    expect(skillInvoked("/shipping", known)).toBeNull();
    expect(skillInvoked("/usr/bin is missing", known)).toBeNull();
  });
});

describe("pickSkills", () => {
  const available = [skill("old", 1), skill("ship", 2), skill("new", 3, "project"), skill("review", 4)];

  it("lists recently run skills first, then the user's own by newest", () => {
    const usage = { "claude:ship": { count: 3, last: 200 }, "claude:plugin:x": { count: 1, last: 300 } };
    const picked = pickSkills("claude", usage, available, 4);
    expect(picked.map((s) => [s.name, s.recent])).toEqual([
      ["plugin:x", true],
      ["ship", true],
      ["review", false],
      ["new", false],
    ]);
    expect(picked[1].description).toBe("ship it");
  });

  it("keeps each agent's history apart and respects the count", () => {
    const usage = { "codex:ship": { count: 1, last: 100 } };
    expect(pickSkills("claude", usage, available, 2).map((s) => s.name)).toEqual(["review", "new"]);
  });
});
