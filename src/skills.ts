// The skills offered by the console's floating button: the ones the user ran last (typed as `/name` in
// an agent), topped up with the skills they made themselves, newest first.
import type { Skill, Usage } from "./types";

export const DEFAULT_RECENT_SKILLS = 6;

/** A skill as the menu lists it. */
export interface SkillEntry {
  name: string;
  description: string;
  /** Run by the user before (else it's one of their own skills, listed to fill the menu). */
  recent: boolean;
  scope?: Skill["scope"];
}

/**
 * The skill a prompt runs, when it starts with `/name` and `name` is a skill: one of `known`, or a
 * plugin's (`plugin:name`). Built-in commands (`/clear`, `/compact`, …) aren't skills.
 */
export function skillInvoked(prompt: string, known: (name: string) => boolean): string | null {
  const match = /^\/([\w.-]+(?::[\w.-]+)*)(?:\s|$)/.exec(prompt.trimStart());
  if (!match) return null;
  return match[1].includes(":") || known(match[1]) ? match[1] : null;
}

export const usageKey = (agent: string, name: string) => `${agent}:${name}`;

/** Up to `count` skills for `agent`: recently run first, then the user's own skills by newest change. */
export function pickSkills(
  agent: string,
  usage: Record<string, Usage>,
  available: Skill[],
  count: number,
): SkillEntry[] {
  const byName = new Map(available.map((s) => [s.name, s]));
  const prefix = `${agent}:`;
  const recent = Object.entries(usage)
    .filter(([key]) => key.startsWith(prefix))
    .sort((a, b) => b[1].last - a[1].last)
    .slice(0, count)
    .map(([key]) => {
      const name = key.slice(prefix.length);
      const skill = byName.get(name);
      return { name, description: skill?.description ?? "", recent: true, scope: skill?.scope };
    });
  const listed = new Set(recent.map((s) => s.name));
  const own = available
    .filter((s) => !listed.has(s.name))
    .sort((a, b) => b.modified - a.modified)
    .slice(0, count - recent.length)
    .map((s) => ({ name: s.name, description: s.description, recent: false, scope: s.scope }));
  return [...recent, ...own];
}
