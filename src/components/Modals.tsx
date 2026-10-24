import { useCallback, useEffect, useState } from "react";
import { attention, busyIn } from "../attention";
import { Changes } from "./Changes";
import * as actions from "../actions";
import { fileManager, key } from "../platform";
import { api } from "../api";
import { agentInfo, useApp } from "../store";
import { groupPath, NO_GROUP } from "../tree";
import * as terms from "../terminals";
import type { HookStatus } from "../types";
import { basename, fuzzyScore, tildify, untildify } from "../util";
import { FolderPlusIcon, TerminalIcon } from "./icons";
import { LaunchOptions } from "./LaunchOptions";
import { Picker, PickerItem, PromptModal } from "./Picker";
import { Sessions } from "./Sessions";
import { Settings } from "./Settings";

const close = () => {
  useApp.getState().openModal(null);
  terms.focus(useApp.getState().activeId);
};

/** Folders to offer: typed path, preferred (group) folders, current, frecent, scanned repos. */
function folderItems(query: string, preferred: string[]): { path: string; hint?: string }[] {
  const { tabs, activeId, usage, projects } = useApp.getState();
  const current = tabs.find((t) => t.id === activeId)?.cwd;
  const now = Date.now();
  const frecency = (p: string) => {
    const u = usage[p];
    if (!u) return 0;
    const days = (now - u.last) / 86_400_000;
    return u.count * (days < 1 ? 4 : days < 7 ? 2 : days < 30 ? 1 : 0.5);
  };
  const recent = Object.keys(usage).sort((a, b) => frecency(b) - frecency(a));

  const seen = new Set<string>();
  const out: { path: string; hint?: string; boost: number }[] = [];
  const add = (path: string | undefined, hint: string | undefined, boost: number) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    out.push({ path, hint, boost });
  };
  const q = query.trim();
  if (q.startsWith("/") || q.startsWith("~")) add(untildify(q.replace(/\/$/, "") || "/"), "open path", 1000);
  preferred.forEach((p) => add(p, "group", 30));
  add(current, "current", 20);
  recent.forEach((p) => add(p, "recent", 10 + Math.min(frecency(p), 10)));
  projects.forEach((p) => add(p, undefined, 0));

  return out
    .map((item) => ({ ...item, score: fuzzyScore(q, tildify(item.path)) }))
    .filter((item) => item.hint === "open path" || item.score !== null)
    .sort((a, b) => b.score! + b.boost - (a.score! + a.boost))
    .slice(0, 60);
}

function Launcher({ mode, groupId }: { mode: "tab" | "agent"; groupId?: string | null }) {
  const config = useApp((s) => s.config)!;
  const group = useApp((s) => s.groups.find((g) => g.id === groupId));
  const profiles = config.profiles;
  const initial =
    mode === "tab"
      ? (profiles.find((p) => !p.command) ?? profiles[0])
      : (profiles.find((p) => p.id === config.lastProfileId && p.command) ??
        profiles.find((p) => p.command) ??
        profiles[0]);
  const [profileId, setProfileId] = useState(initial?.id);
  const profile = profiles.find((p) => p.id === profileId);
  const tabs = useApp((s) => s.tabs);
  const agents = useApp((s) => s.agents);
  // Starting an agent outside a worktree: flag folders another agent is already working in.
  const warnBusy = !!profile?.command && !config.launchOptions.worktree;

  const items = useCallback(
    (query: string): PickerItem[] =>
      folderItems(query, group?.folders ?? []).map(({ path, hint }) => ({
        id: path,
        label: basename(path),
        detail: tildify(path),
        hint: (warnBusy && busyIn(tabs, path, agents) && "agent already working here") || hint,
        run: () => actions.newTab(path, profile?.command ? profile : undefined, groupId ?? null),
      })),
    [group, profile, groupId, warnBusy, tabs, agents],
  );

  const cycle = (delta: number) => {
    const i = profiles.findIndex((p) => p.id === profileId);
    setProfileId(profiles[(i + delta + profiles.length) % profiles.length].id);
  };

  return (
    <Picker
      placeholder={group ? `Folder for a new tab in “${group.name}”…` : "Choose a folder, or type a path…"}
      items={items}
      onClose={close}
      inputAccessory={
        <>
          <button
            className="picker-input-btn"
            title={`Open a folder from ${fileManager}…`}
            onClick={() => {
              close();
              void actions.newTabInPickedFolder(profile?.command ? profile : undefined, groupId ?? null);
            }}
          >
            <FolderPlusIcon />
          </button>
          <button
            className="picker-input-btn quick-terminal"
            data-tip="Plain shell in ~, outside the folder groups (for k9s, aws, …)"
            onClick={() => {
              close();
              actions.newQuickTerminal();
            }}
          >
            <TerminalIcon />
            Quick terminal
          </button>
        </>
      }
      onKey={(e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          cycle(e.shiftKey ? -1 : 1);
          return true;
        }
        return false;
      }}
      header={
        <div className="profiles">
          {profiles.map((p) => (
            <button
              key={p.id}
              className={"chip" + (p.id === profileId ? " on" : "")}
              onClick={() => setProfileId(p.id)}
              title={p.command || "Plain shell"}
            >
              {p.name}
            </button>
          ))}
          <span className="profiles-hint">Tab to switch</span>
          {profile?.command && <LaunchOptions profile={profile} />}
        </div>
      }
    />
  );
}

function GroupFolders({ groupId }: { groupId: string }) {
  const group = useApp((s) => s.groups.find((g) => g.id === groupId));
  const items = useCallback(
    (query: string): PickerItem[] =>
      folderItems(query, group?.folders ?? []).map(({ path }) => ({
        id: path,
        label: basename(path),
        detail: tildify(path),
      })),
    [group],
  );
  if (!group) return null;
  return (
    <Picker
      placeholder={`Folders that belong to “${group.name}”…`}
      items={items}
      onClose={close}
      header={<div className="picker-title">Select folders for “{group.name}”</div>}
      multi={{
        initial: group.folders,
        onConfirm: (folders) => useApp.getState().updateGroup(groupId, { folders }),
      }}
    />
  );
}

function MoveTab({ tabId }: { tabId: string }) {
  const items = useCallback(
    (query: string): PickerItem[] => {
      const { groups, updateTab } = useApp.getState();
      const all: PickerItem[] = [
        ...groups.map((g) => ({
          id: g.id,
          label: groupPath(g, groups),
          hint: "group",
          run: () => updateTab(tabId, { groupId: g.id }),
        })),
        {
          id: "__auto",
          label: "No custom group",
          run: () => updateTab(tabId, { groupId: NO_GROUP }),
        },
        {
          id: "__new",
          label: "New group",
          run: () => updateTab(tabId, { groupId: actions.newGroup().id }),
        },
      ];
      return all.filter((i) => fuzzyScore(query, i.label) !== null);
    },
    [tabId],
  );
  return <Picker placeholder="Move tab to group…" items={items} onClose={close} />;
}

function Hooks() {
  const [status, setStatus] = useState<HookStatus[]>([]);
  useEffect(() => void api.hooksStatus().then(setStatus), []);
  const items = useCallback(
    (): PickerItem[] =>
      status.map((s) => ({
        id: s.agent,
        label: `${s.installed ? "Reinstall" : "Install"} ${agentInfo(s.agent)?.label ?? s.agent} hooks`,
        detail: tildify(s.path),
        hint: s.installed ? "installed ✓" : "not installed",
        run: () => void actions.installHooks(s.agent).then(() => api.hooksStatus().then(setStatus)),
      })),
    [status],
  );
  const missing = status.filter((s) => !s.installed).length;
  const [installing, setInstalling] = useState(false);
  const installAll = async () => {
    setInstalling(true);
    await actions.installAllHooks(status.map((s) => s.agent));
    setStatus(await api.hooksStatus());
    setInstalling(false);
  };
  return (
    <Picker
      placeholder="Agent hooks report status and summaries to Quazar…"
      items={items}
      onClose={close}
      header={
        status.length > 1 && (
          <div className="hooks-all">
            <span className="field-hint">
              {missing
                ? `${missing} of ${status.length} agents without hooks`
                : `Installed for all ${status.length} agents ✓`}
            </span>
            <button className="btn small primary" disabled={installing} onClick={() => void installAll()}>
              {installing ? "Installing…" : missing ? "Install for all agents" : "Reinstall all"}
            </button>
          </div>
        )
      }
      footer={
        <div className="picker-footer muted">
          Adds a small hook that only does something inside Quazar. Your existing hooks are kept; a backup is saved next
          to the file.
        </div>
      }
    />
  );
}

function Palette() {
  const items = useCallback((query: string): PickerItem[] => {
    const s = useApp.getState();
    const active = s.tabs.find((t) => t.id === s.activeId);
    const cmd = (id: string, label: string, run: () => void, hint?: string): PickerItem => ({ id, label, run, hint });
    const commands: PickerItem[] = [
      cmd("new-tab", "New tab…", () => s.openModal({ kind: "launcher", mode: "tab" }), key("new-tab")),
      cmd("new-agent", "New agent…", () => s.openModal({ kind: "launcher", mode: "agent" }), key("new-agent")),
      ...s
        .config!.profiles.filter((p) => p.command && active)
        .map((p) =>
          cmd("here-" + p.id, `Start ${p.name} in ${basename(active!.cwd)}`, () => actions.newTab(active!.cwd, p)),
        ),
      cmd("new-group", "New group", () => actions.newGroup()),
      cmd("quick-terminal", "Quick terminal (plain shell in ~)", actions.newQuickTerminal),
      cmd("attention", "Next agent needing you", actions.nextNeedingYou, key("next-attention")),
      ...(active
        ? [
            cmd("rename", "Rename tab…", () => actions.renameTab(active.id), key("rename-tab")),
            cmd("move", "Move tab to group…", () => s.openModal({ kind: "move-tab", tabId: active.id })),
            ...(actions.canOpenInNewWindow(active)
              ? [cmd("new-window", "Open tab in new window", () => void actions.openInNewWindow(active.id))]
              : []),
            cmd("hide-tab", active.hidden ? "Unhide tab" : "Hide tab (keeps running)", () =>
              actions.setTabHidden(active.id, !active.hidden),
            ),
            ...(s.live[active.id]
              ? [cmd("stop", "Stop tab (free CPU and memory; resume later)", () => void actions.stopTab(active.id))]
              : []),
            cmd("sessions", `Resume a session in ${basename(active.repoRoot ?? active.cwd)}…`, () =>
              s.openModal({ kind: "sessions", folder: active.repoRoot ?? active.cwd, groupId: null }),
            ),
            cmd("vscode", "Open in VS Code", () => void actions.openInVSCode(active.id)),
            cmd("changes", "Review changes", () => s.openModal({ kind: "changes", tabId: active.id })),
            ...(actions.canFork(active)
              ? [cmd("fork", "Fork session into a new tab", () => void actions.forkTab(active.id))]
              : []),
            cmd("resume", "Copy resume command", () => void actions.copyResumeCommand(active.id)),
            cmd("close", "Close tab", () => void actions.closeTab(active.id), key("close-tab")),
          ]
        : []),
      cmd(
        "autogroup",
        `Group tabs by folder: ${s.config!.autoGroup ? "on → off" : "off → on"}`,
        actions.toggleAutoGroup,
      ),
      cmd("side", "Move sidebar left/right", actions.toggleSidebarSide, key("sidebar-side")),
      cmd("labels", `Header button labels: ${(s.config!.headerLabels ?? true) ? "on → off" : "off → on"}`, () => {
        s.setConfig({ headerLabels: !(s.config!.headerLabels ?? true) });
        actions.saveConfig();
      }),
      cmd(
        "collapse-all",
        actions.allSectionsCollapsed() ? "Expand all groups" : "Collapse all groups",
        actions.toggleAllSections,
      ),
      cmd(
        "show-hidden",
        s.config!.showHiddenTabs ? "Stop showing hidden tabs" : "Show hidden tabs",
        actions.toggleShowHiddenTabs,
      ),
      cmd("unhide-all", "Unhide everything", actions.unhideAll),
      cmd("hide", "Toggle sidebar", () => useApp.setState({ sidebarHidden: !s.sidebarHidden }), key("toggle-sidebar")),
      cmd("hooks", "Install agent hooks…", () => s.openModal({ kind: "hooks" })),
      cmd("settings", "Settings…", () => s.openModal({ kind: "settings" }), key("settings")),
      cmd("about", `About Quazar (${actions.versionText()})`, () => s.showToast(`Quazar ${actions.versionText()}`)),
      ...(s.update?.phase === "ready"
        ? [cmd("update", "Restart to update Quazar", actions.installUpdate)]
        : s.update?.phase === "available" || s.update?.phase === "failed"
          ? [cmd("update", "Update Quazar (rebuild from source)", () => void actions.startUpdate())]
          : [cmd("update-check", "Check for Quazar updates", () => void actions.checkForUpdate(true))]),
      cmd("config", "Open settings file", () => void actions.openConfigFile()),
      cmd("rescan", "Rescan project folders", () => void actions.rescanProjects()),
    ];
    // Agents needing you come first.
    const queue = attention(s.tabs);
    const ordered = [...queue, ...s.tabs.filter((t) => !queue.includes(t))];
    const tabs: PickerItem[] = ordered.map((t) => ({
      id: "tab:" + t.id,
      label: t.title,
      detail: tildify(t.cwd),
      hint: queue.includes(t)
        ? t.status === "waiting"
          ? "waiting"
          : "done"
        : actions.isTabHidden(t.id)
          ? "hidden tab"
          : "tab",
      // Picking a hidden tab brings it (and its hidden group) back into the sidebar.
      run: () => (s.config!.showHiddenTabs ? s.activate(t.id) : actions.revealTab(t.id)),
    }));
    return [...commands, ...tabs]
      .map((item) => ({
        item,
        score: fuzzyScore(query, item.label + " " + (item.detail ?? "")),
      }))
      .filter((x) => x.score !== null)
      .sort((a, b) => (query ? b.score! - a.score! : 0))
      .map((x) => x.item);
  }, []);
  return <Picker placeholder="Type a command or tab name…" items={items} onClose={close} />;
}

export function Modals() {
  const modal = useApp((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case "palette":
      return <Palette />;
    case "launcher":
      return <Launcher mode={modal.mode} groupId={modal.groupId} />;
    case "group-folders":
      return <GroupFolders groupId={modal.groupId} />;
    case "move-tab":
      return <MoveTab tabId={modal.tabId} />;
    case "hooks":
      return <Hooks />;
    case "settings":
      return <Settings onClose={close} />;
    case "changes":
      return <Changes tabId={modal.tabId} onClose={close} />;
    case "sessions":
      return <Sessions folder={modal.folder} groupId={modal.groupId} onClose={close} />;
    case "prompt":
      return <PromptModal title={modal.title} initial={modal.initial} onSubmit={modal.onSubmit} onClose={close} />;
  }
}
