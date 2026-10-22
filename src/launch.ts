// Launcher checkboxes (bypass permissions, plan mode, worktree): which flag each adds to a profile.
import { useApp } from "./store";
import type { AgentInfo, LaunchOption, Profile } from "./types";
import { basename } from "./util";

export const LAUNCH_OPTIONS: {
  key: LaunchOption;
  label: string;
  hint: string;
}[] = [
  {
    key: "bypass",
    label: "Bypass permissions",
    hint: "Run without asking for approvals",
  },
  {
    key: "plan",
    label: "Plan mode",
    hint: "Plan first, without editing files",
  },
  { key: "worktree", label: "Worktree", hint: "Start in a new git worktree" },
];

/** Bypass and plan mode are alternative permission modes; turning one on turns the other off. */
export const EXCLUSIVE: Partial<Record<LaunchOption, LaunchOption>> = {
  bypass: "plan",
  plan: "bypass",
};

/** The agent a profile starts: the program of its command (after any `VAR=value`). */
export function profileAgent(profile: Profile): AgentInfo | undefined {
  const program = profile.command
    .trim()
    .split(/\s+/)
    .find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  if (!program) return undefined;
  const name = basename(program);
  return useApp.getState().agents.find((a) => a.programs.includes(name));
}

/** The flag `option` adds to `profile`: the profile's own, else the agent's known one. */
export function optionFlag(profile: Profile, option: LaunchOption): string | null {
  return profile.options?.[option]?.trim() || profileAgent(profile)?.options[option] || null;
}

/** The profile's command with the flags of the checked options. */
export function launchCommand(profile: Profile, checked: Record<LaunchOption, boolean>): string {
  if (!profile.command.trim()) return "";
  const flags = LAUNCH_OPTIONS.filter(({ key }) => checked[key]).map(({ key }) => optionFlag(profile, key));
  return [profile.command.trim(), ...flags.filter(Boolean)].join(" ");
}
