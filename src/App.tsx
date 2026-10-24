import { useEffect, useRef, useState } from "react";
import {
  answerSuggestedRoot,
  canFork,
  canOpenInNewWindow,
  copyText,
  deleteGroup,
  forkTab,
  groupDeletion,
  init,
  openInNewWindow,
  openInVSCode,
  quickLaunch,
  renameTab,
  revealInFinder,
  saveConfig,
} from "./actions";
import { api } from "./api";
import { CodeIcon, DiffIcon, FolderIcon, ForkIcon, PanelIcon, TrashIcon, WindowIcon } from "./components/icons";
import { LaunchOptions } from "./components/LaunchOptions";
import { Modals } from "./components/Modals";
import { Onboarding } from "./components/Onboarding";
import { TabResources } from "./components/Metrics";
import { Sidebar } from "./components/Sidebar";
import { launchCommand, profileAgent } from "./launch";
import { fileManager, isMac, key } from "./platform";
import { agentInfo, useApp } from "./store";
import * as terms from "./terminals";
import { basename, tildify } from "./util";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

/** Agent picker at the bottom of a new console; typing in the console dismisses it. */
function QuickLaunch() {
  const tabId = useApp((s) => (s.quickLaunchTab === s.activeId ? s.activeId : null));
  const allProfiles = useApp((s) => s.config!.profiles);
  const options = useApp((s) => s.config!.launchOptions);
  if (!tabId) return null;
  return (
    // Clicks keep the keyboard focus in the console.
    <div className="quick-launch" onMouseDown={(e) => e.preventDefault()}>
      <span className="quick-launch-label">Start</span>
      {allProfiles
        .filter((p) => p.command.trim())
        .map((p) => (
          <button
            key={p.id}
            className="chip"
            title={launchCommand(p, options)}
            style={{ color: profileAgent(p)?.color }}
            onClick={() => quickLaunch(tabId, p)}
          >
            {p.name}
          </button>
        ))}
      <LaunchOptions />
      <button
        className="icon-btn small quick-launch-close"
        title="Keep a plain shell"
        onClick={() => useApp.setState({ quickLaunchTab: null })}
      >
        ×
      </button>
    </div>
  );
}

function TerminalArea() {
  const activeId = useApp((s) => s.activeId);
  const hasTabs = useApp((s) => s.tabs.some((t) => (t.window ?? "main") === s.me));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeId && ref.current) terms.show(activeId, ref.current);
  }, [activeId]);

  useEffect(() => {
    if (!ref.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => terms.fitActive(useApp.getState().activeId));
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="terminal-area">
      <div className="terminals" ref={ref} />
      <QuickLaunch />
      {!hasTabs && (
        <div className="empty">
          <div className="empty-title">Quazar</div>
          <button
            className="btn primary"
            onClick={() => useApp.getState().openModal({ kind: "launcher", mode: "agent" })}
          >
            New agent <kbd>{key("new-agent")}</kbd>
          </button>
          <button className="btn" onClick={() => useApp.getState().openModal({ kind: "launcher", mode: "tab" })}>
            New tab <kbd>{key("new-tab")}</kbd>
          </button>
          <button className="btn" onClick={() => useApp.getState().openModal({ kind: "palette" })}>
            Commands <kbd>{key("palette")}</kbd>
          </button>
        </div>
      )}
    </div>
  );
}

/** A path shown by name: hover for the full path, click to copy it, double-click to open in Finder. */
function PathLink({
  path,
  label,
  what,
  className,
  children,
}: {
  path: string;
  label?: string;
  what: string;
  className: string;
  children?: React.ReactNode;
}) {
  const timer = useRef<number | undefined>(undefined);
  return (
    <button
      className={className + " path-link"}
      title={`${tildify(path)}\nClick to copy · double-click to open in ${fileManager}`}
      onClick={() => {
        // Wait to see whether this is the first click of a double-click.
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void copyText(path, what), 250);
      }}
      onDoubleClick={() => {
        window.clearTimeout(timer.current);
        revealInFinder(path);
      }}
    >
      {children ?? label}
    </button>
  );
}

function Toast() {
  const toast = useApp((s) => s.toast);
  return toast ? (
    <div className="toast" key={toast.id}>
      {toast.text}
    </div>
  ) : null;
}

/** Offers to add a folder opened from Finder to the project folders. */
function RootDrawer() {
  const path = useApp((s) => s.suggestedRoot);
  if (!path) return null;
  return (
    <div className="drawer" role="dialog">
      <FolderIcon size={16} />
      <div className="drawer-text">
        <div>
          Add <b title={path}>{basename(path)}</b> to your project folders?
        </div>
        <div className="drawer-sub">
          {tildify(path)} isn't in Settings → Project folders yet. Adding it lists it in the folder picker.
        </div>
      </div>
      <button className="btn small" onClick={() => answerSuggestedRoot(false)}>
        Not now
      </button>
      <button className="btn small primary" onClick={() => answerSuggestedRoot(true)}>
        Add folder
      </button>
    </div>
  );
}

/** Reminds that macOS notifications are off, while any agent notification is turned on in Settings. */
function NotificationsDrawer() {
  const show = useApp(
    (s) =>
      s.me === "main" &&
      s.notifyPermission === "denied" &&
      (s.config!.notifyDone !== false || s.config!.notifyWaiting !== false) &&
      !s.config!.notifyPromptDismissed &&
      // Not over the first-launch setup.
      (s.config!.onboarded === true || s.tabs.length > 0),
  );
  if (!show) return null;
  const dismiss = () => {
    useApp.getState().setConfig({ notifyPromptDismissed: true });
    saveConfig();
  };
  return (
    <div className="drawer" role="dialog">
      <span className="updated-check notify-bell">🔔</span>
      <div className="drawer-text">
        <div>
          <b>Notifications are off for Quazar</b>
        </div>
        <div className="drawer-sub">
          Turn them on to hear when an agent finishes or needs you, even while you're in another app. In System
          Settings, switch on <i>Allow notifications</i> for Quazar.
        </div>
      </div>
      <button className="btn small" onClick={dismiss}>
        Not now
      </button>
      <button className="btn small primary" onClick={() => void api.openNotificationSettings()}>
        Open Settings
      </button>
    </div>
  );
}

/** Says once that Quazar was updated, and to which build. */
function UpdatedDrawer() {
  const updated = useApp((s) => s.updated);
  useEffect(() => {
    if (!updated) return;
    const timer = window.setTimeout(() => useApp.setState({ updated: null }), 10_000);
    return () => window.clearTimeout(timer);
  }, [updated]);
  if (!updated) return null;
  return (
    <div className="drawer updated" role="status">
      <span className="updated-check">✓</span>
      <div className="drawer-text">
        <div>
          <b>Quazar updated</b>
        </div>
        <div className="drawer-sub">Now running {updated}.</div>
      </div>
      <button className="btn small" onClick={() => useApp.setState({ updated: null })}>
        OK
      </button>
    </div>
  );
}

/** Confirms deleting a group that still holds tabs or groups. */
function DeleteGroupDrawer() {
  const id = useApp((s) => s.pendingDelete);
  useApp((s) => s.groups); // re-render if it changes meanwhile
  if (!id) return null;
  const { name, tabs, groups, parent } = groupDeletion(id);
  const parts = [tabs && `${tabs} tab${tabs === 1 ? "" : "s"}`, groups && `${groups} group${groups === 1 ? "" : "s"}`];
  const cancel = () => useApp.setState({ pendingDelete: null });
  return (
    <div className="drawer danger" role="dialog">
      <TrashIcon size={16} />
      <div className="drawer-text">
        <div>
          Delete <b>{name}</b>?
        </div>
        <div className="drawer-sub">
          Its {parts.filter(Boolean).join(" and ")} move up to {parent ? `“${parent}”` : "the top level"}; tabs keep
          running.
        </div>
      </div>
      <button className="btn small" onClick={cancel}>
        Cancel
      </button>
      <button className="btn small danger" onClick={() => deleteGroup(id, true)}>
        Delete
      </button>
    </div>
  );
}

function TopBar() {
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.activeId));
  const lights = useApp((s) => s.sidebarHidden || s.config!.sidebarSide === "right");
  const labels = useApp((s) => s.config!.headerLabels ?? true);
  const side = useApp((s) => s.config!.sidebarSide);
  const hidden = useApp((s) => s.sidebarHidden);
  const showSidebar = hidden && (
    <button
      className={"icon-btn topbar-panel " + side}
      title={`Show sidebar (${key("toggle-sidebar")})`}
      onClick={() => useApp.setState({ sidebarHidden: false })}
    >
      <PanelIcon side={side} />
    </button>
  );
  // Re-checked as this window gains or loses tabs.
  const movable = useApp((s) => !!tab && s.tabs.length > 0 && canOpenInNewWindow(tab));
  const [branch, setBranch] = useState<string | null>(null);
  // The agent's worktree, else the console's own folder when it's in a repo.
  const repoPath = tab?.worktree ?? (tab?.repoRoot ? tab.cwd : null);
  // Re-read at each turn boundary and shell prompt: a command may switch branches.
  const [prompts, setPrompts] = useState(0);
  useEffect(() => {
    const onPrompt = (e: Event) => (e as CustomEvent<string>).detail === tab?.id && setPrompts((n) => n + 1);
    window.addEventListener("quazar:prompt", onPrompt);
    return () => window.removeEventListener("quazar:prompt", onPrompt);
  }, [tab?.id]);
  useEffect(() => {
    if (!repoPath) return setBranch(null);
    void api.gitBranch(repoPath).then(setBranch, () => setBranch(null));
  }, [repoPath, tab?.status, prompts]);
  return (
    <div className={"topbar" + (lights && isMac ? " lights" : "")} data-tauri-drag-region>
      {side === "left" && showSidebar}
      {tab && (
        <>
          <div className="topbar-text" data-tauri-drag-region>
            <span className="topbar-line" data-tauri-drag-region>
              <button
                className="topbar-title"
                onClick={() => renameTab(tab.id)}
                title={tab.titleSource === "custom" ? "Click to rename (kept as you named it)" : "Click to rename"}
              >
                {tab.title}
              </button>
              <PathLink path={tab.cwd} className="topbar-path" label={basename(tab.cwd)} what="Path" />
            </span>
            {(tab.worktree || branch) && (
              <span className="topbar-sub" data-tauri-drag-region>
                {tab.worktree && (
                  <PathLink path={tab.worktree} className="worktree-tag" what="Worktree path">
                    <FolderIcon />
                    {basename(tab.worktree)}
                  </PathLink>
                )}
                {branch && (
                  <button
                    className="branch-tag"
                    title={`${branch}\nClick to copy`}
                    onClick={() => void copyText(branch, "Branch name")}
                  >
                    ⎇ {branch}
                  </button>
                )}
              </span>
            )}
          </div>
          <div className={"topbar-actions" + (labels ? "" : " compact")}>
            <TabResources tabId={tab.id} labels={labels} />
            {!!tab.changes?.files && (
              <button
                className="topbar-btn"
                onClick={() => useApp.getState().openModal({ kind: "changes", tabId: tab.id })}
                title={`Review the uncommitted changes in this checkout (${tab.changes.files} file${tab.changes.files === 1 ? "" : "s"})`}
              >
                {!labels && <DiffIcon />}
                <span className="plus">+{tab.changes.added}</span>
                <span className="minus">−{tab.changes.removed}</span>
                {labels && `Changes · ${tab.changes.files}`}
              </button>
            )}
            <button
              className="topbar-btn"
              onClick={() => void forkTab(tab.id)}
              disabled={!canFork(tab)}
              title={
                canFork(tab)
                  ? "Fork this session into a new tab"
                  : tab.agent && agentInfo(tab.agent)?.canFork === false
                    ? `${agentInfo(tab.agent)!.label} can't fork sessions`
                    : "Fork is available while an agent is running"
              }
            >
              <ForkIcon />
              {labels && "Fork"}
            </button>
            <button
              className="topbar-btn"
              onClick={() => void openInVSCode(tab.id)}
              title={tab.worktree ? `Open worktree ${tildify(tab.worktree)} in VS Code` : "Open in VS Code"}
            >
              <CodeIcon />
              {labels && "VS Code"}
            </button>
            <button
              className="topbar-btn"
              onClick={() => void openInNewWindow(tab.id)}
              disabled={!movable}
              title={movable ? "Move this tab to a new window (it keeps running)" : "This is the window's only tab"}
            >
              <WindowIcon />
              {labels && "New window"}
            </button>
          </div>
        </>
      )}
      {side === "right" && showSidebar}
    </div>
  );
}

export default function App() {
  const ready = useApp((s) => s.ready);
  const side = useApp((s) => s.config?.sidebarSide ?? "left");
  const hidden = useApp((s) => s.sidebarHidden);

  useEffect(() => {
    void init();
  }, []);

  if (!ready) return <div className="app" />;
  return (
    <div className={`app side-${side}`}>
      {!hidden && <Sidebar />}
      <main className="main" onPointerDownCapture={() => useApp.getState().setFocusArea("terminal")}>
        <TopBar />
        <TerminalArea />
      </main>
      <Modals />
      <RootDrawer />
      <DeleteGroupDrawer />
      <UpdatedDrawer />
      <NotificationsDrawer />
      <Onboarding />
      <Toast />
    </div>
  );
}
