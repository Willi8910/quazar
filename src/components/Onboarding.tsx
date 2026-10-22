import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import * as actions from "../actions";
import { useApp } from "../store";
import { tildify, untildify } from "../util";
import { FolderPlusIcon } from "./icons";

const STEPS = 3;

/** First launch: a few steps to set Quazar up, shown while there are no tabs yet. */
export function Onboarding() {
  const show = useApp((s) => s.me === "main" && s.config!.onboarded !== true && s.tabs.length === 0);
  const roots = useApp((s) => s.config!.projectRoots);
  const repos = useApp((s) => s.projects.length);
  const hooks = useApp((s) => s.hooksInstalled);
  // Steps out of the way of dialogs it opens (hooks, the launcher).
  const dialog = useApp((s) => s.modal !== null);
  const [step, setStep] = useState(1);
  if (!show || dialog) return null;

  const finish = () => {
    useApp.getState().setConfig({ onboarded: true });
    actions.saveConfig();
  };
  const next = () => (step < STEPS ? setStep(step + 1) : finish());

  const addFolders = async () => {
    const picked = await open({ directory: true, multiple: true, title: "Choose your development folders" });
    if (!picked) return;
    const known = new Set(roots.map(untildify));
    const added = ([] as string[]).concat(picked).filter((p) => !known.has(p));
    if (!added.length) return;
    useApp.getState().setConfig({ projectRoots: [...roots, ...added.map(tildify)] });
    actions.saveConfig();
    await actions.rescanProjects();
  };

  const installed = Object.values(hooks).filter(Boolean).length;
  return (
    <div className="drawer onboarding" role="dialog" aria-label="Set up Quazar">
      <div className="onboarding-steps">
        Step {step} of {STEPS}
        <button className="link-btn" onClick={finish}>
          Skip setup
        </button>
      </div>

      {step === 1 && (
        <>
          <div className="onboarding-title">Where do you keep your projects?</div>
          <p>
            Quazar looks for git repositories inside your development folders, so you can open any project in a couple
            of keystrokes (⌘T for a terminal, ⌘N for an agent) instead of browsing for it each time.
          </p>
          <div className="onboarding-roots">
            {roots.map((root) => (
              <span key={root} className="onboarding-root" title={untildify(root)}>
                {root}
              </span>
            ))}
            {roots.length === 0 && <span className="field-hint">No folders yet.</span>}
          </div>
          <div className="field-hint">
            {repos > 0 ? `Found ${repos} repositor${repos === 1 ? "y" : "ies"}. ` : "No repositories found yet. "}
            You can add or remove folders any time in Settings → Projects.
          </div>
          <div className="onboarding-actions">
            <button className="btn small" onClick={() => void addFolders()}>
              <FolderPlusIcon size={13} /> Add folders…
            </button>
            <button className="btn small primary" onClick={next}>
              Continue
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="onboarding-title">Let Quazar see what your agents are doing</div>
          <p>
            A small hook in each agent's settings (Claude Code, Codex, Gemini) reports when it's working, waiting for
            you or done — that drives the status dots, notifications and the “needs you” list. It only does anything
            inside Quazar, and your existing hooks are kept.
          </p>
          <div className="field-hint">
            {installed > 0 ? `Installed for ${installed} agent${installed === 1 ? "" : "s"}.` : "Not installed yet."}
          </div>
          <div className="onboarding-actions">
            <button className="btn small" onClick={() => useApp.getState().openModal({ kind: "hooks" })}>
              Install hooks…
            </button>
            <button className="btn small primary" onClick={next}>
              Continue
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="onboarding-title">Start your first agent</div>
          <p>
            Pick a project and an agent; it opens in a tab grouped by its folder. Open as many as you like — the sidebar
            shows which ones are working, waiting or done, and ⌘J jumps to the next one that needs you.
          </p>
          <div className="onboarding-actions">
            <button className="link-btn" onClick={finish}>
              Later
            </button>
            <button
              className="btn small primary"
              onClick={() => {
                finish();
                useApp.getState().openModal({ kind: "launcher", mode: "agent" });
              }}
            >
              New agent <kbd>⌘N</kbd>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
