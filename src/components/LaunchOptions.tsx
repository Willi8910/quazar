import * as actions from "../actions";
import { EXCLUSIVE, LAUNCH_OPTIONS, optionFlag, profileAgent } from "../launch";
import { useApp } from "../store";
import type { LaunchOption, Profile } from "../types";

/**
 * Checkboxes that add flags (bypass, plan mode, worktree) to an agent's command. With a `profile`,
 * options it has no flag for are disabled; without one they all apply to whichever agent starts.
 */
export function LaunchOptions({ profile }: { profile?: Profile }) {
  const checked = useApp((s) => s.config!.launchOptions);
  const agent = profile && profileAgent(profile);
  const toggle = (key: LaunchOption) => {
    const next = { ...checked, [key]: !checked[key] };
    const other = EXCLUSIVE[key];
    if (next[key] && other) next[other] = false;
    useApp.getState().setConfig({ launchOptions: next });
    actions.saveConfig();
  };
  return (
    <div className="launch-options">
      {LAUNCH_OPTIONS.map(({ key, label, hint }) => {
        const flag = profile ? optionFlag(profile, key) : key;
        return (
          <label
            key={key}
            className={"launch-option" + (flag ? "" : " off")}
            // Keep the focus where it was (the folder input or the terminal).
            onMouseDown={(e) => e.preventDefault()}
            title={
              !profile
                ? hint
                : flag
                  ? `${hint}: adds ${flag}`
                  : `${agent?.label ?? profile.name} has no flag for this; set one for the profile in Settings`
            }
          >
            <input type="checkbox" disabled={!flag} checked={!!flag && checked[key]} onChange={() => toggle(key)} />
            {label}
          </label>
        );
      })}
    </div>
  );
}
