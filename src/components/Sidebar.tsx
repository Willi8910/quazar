import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as actions from "../actions";
import { attention, sharedCheckouts } from "../attention";
import { isMac, key } from "../platform";
import { agentInfo, sidebarTree, useApp } from "../store";
import { tabTags } from "../tags";
import type { DropPosition } from "../store";
import type { Tab } from "../types";
import { isCollapsed, MovePosition, Node, ownerGroupId, pathTo, subtreeTabs } from "../tree";
import { timeAgo, tildify } from "../util";
import { HiddenManager, ManagerAnchor } from "./HiddenManager";
import { useHoverPopover, windowRect } from "./hover";
import { MetricsBar, TabMetrics } from "./Metrics";
import {
  AgentIcon,
  HistoryIcon,
  LightbulbIcon,
  CollapseAllIcon,
  ExpandAllIcon,
  EyeIcon,
  EyeOffIcon,
  FolderTreeIcon,
  PlusIcon,
  PanelIcon,
  TrashIcon,
  WindowIcon,
} from "./icons";
import { TagBadge, TagButton } from "./Tags";
import { unseenTips } from "./Tips";

interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
}
interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  useEffect(() => {
    const off = () => onClose();
    window.addEventListener("mousedown", off);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("mousedown", off);
      window.removeEventListener("blur", off);
    };
  }, [onClose]);
  return (
    <div className="ctx" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.map((item) => (
        <div
          key={item.label}
          className={"ctx-item" + (item.danger ? " danger" : "")}
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}

const newTab = () => useApp.getState().openModal({ kind: "launcher", mode: "tab" });

/** "New": a click opens a shell beside the current tab; hovering shows a menu for a tab, an agent or a group. */
function NewButton() {
  const [open, setOpen] = useState(false);
  // Agents that can skip their permission prompts (the quick entries start them that way).
  const agents = useApp((s) => s.agents).filter((a) => a.options.bypass);
  const timer = useRef<number | undefined>(undefined);
  const hover = (next: boolean) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), next ? 150 : 200);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const pick = (run: () => void) => {
    window.clearTimeout(timer.current);
    setOpen(false);
    run();
  };
  return (
    <div className="new-wrap" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <button
        className="icon-btn new-btn"
        onClick={() => pick(actions.newShellHere)}
        title="New shell beside this tab (same group and folder)"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        New <span className="new-caret">▾</span>
      </button>
      {open && (
        <div className="ctx new-menu" role="menu">
          <div className="ctx-item" role="menuitem" onClick={() => pick(newTab)}>
            Tab in folder…
          </div>
          {agents.map((a) => (
            <div
              key={a.name}
              className="ctx-item new-agent"
              role="menuitem"
              title={`New ${a.label} tab beside this one (same folder and group), permissions bypassed`}
              onClick={() => pick(() => actions.newAgentHere(a.name))}
            >
              <AgentIcon agent={a.name} color={a.color} />
              {a.label}
            </div>
          ))}
          <div className="ctx-item" role="menuitem" onClick={() => pick(() => actions.newGroup())}>
            Group
          </div>
        </div>
      )}
    </div>
  );
}

function dotClass(tab: Tab, live: boolean) {
  if (!live) return "dot off";
  if (!tab.agentRunning) return "dot shell";
  return "dot " + tab.status;
}

function subtitle(tab: Tab, live: boolean): string {
  if (tab.agentRunning && tab.status === "working") return tab.detail || tab.lastPrompt || "Working…";
  if (tab.agentRunning && tab.status === "waiting") return tab.detail || "Needs your input";
  if (tab.summary) return tab.summary;
  if (!live && tab.sessionId) return "Session saved · open to resume";
  return tildify(tab.cwd);
}

type Drop =
  | { kind: "tab"; node: string; target: string | null; position: DropPosition }
  | { kind: "node"; target: string; position: MovePosition };

/** Whether the pointer is past the window's edges (a drag keeps reporting it there). */
function outsideWindow(e: PointerEvent) {
  return e.clientX < 0 || e.clientY < 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight;
}

interface Drag {
  kind: "tab" | "node";
  id: string;
  x: number;
  y: number;
  active: boolean;
}

function TabRow({
  tab,
  dragging,
  drop,
  onMenu,
  onDragStart,
}: {
  tab: Tab;
  dragging: boolean;
  drop: DropPosition | null;
  onMenu: (e: React.MouseEvent, tab: Tab) => void;
  onDragStart: (e: React.PointerEvent) => void;
}) {
  const active = useApp((s) => s.activeId === tab.id);
  const live = useApp((s) => !!s.live[tab.id]);
  const elsewhere = useApp((s) => (tab.window ?? "main") !== s.me);
  // Other running agents in this tab's checkout (they may edit the same files).
  const sharing = useApp((s) => sharedCheckouts(s.tabs, s.agents).get(tab.id)?.join(", ") ?? "");
  const changes = tab.changes;
  const defs = useApp((s) => s.config!.tags);
  const tags = defs ? tabTags(tab, defs) : [];
  // Without its hooks the agent never reports status, so the dot, the attention pill and Changes stay idle.
  const noHooks = useApp((s) => !!tab.agent && tab.agentRunning && s.hooksInstalled[tab.agent] === false);
  const cls = [
    "tab",
    active && "active",
    elsewhere && "elsewhere",
    tab.unseen && "unseen",
    tab.hidden && "hidden",
    dragging && "dragging",
    drop && "drop-" + drop,
  ];
  return (
    <div
      className={cls.filter(Boolean).join(" ")}
      data-tab={tab.id}
      onPointerDown={(e) => e.button === 0 && onDragStart(e)}
      onClick={() => useApp.getState().activate(tab.id)}
      onDoubleClick={() => actions.renameTab(tab.id)}
      onContextMenu={(e) => onMenu(e, tab)}
      title={`${tab.title}\n${tildify(tab.cwd)}${tab.summary ? "\n\n" + tab.summary : ""}${elsewhere ? "\n\nIn another window — click to move it here" : ""}`}
    >
      <span className={dotClass(tab, live)} />
      <div className="tab-body">
        <div className="tab-line">
          {elsewhere && (
            <span className="tab-window">
              <WindowIcon size={10} />
            </span>
          )}
          {tags.map((tag) => (
            <TagBadge key={tag.id} tab={tab} tag={tag} />
          ))}
          <span className="tab-title">{tab.title}</span>
          {sharing && (
            <span
              className="tab-warn"
              title={`Another agent is working in this checkout (${sharing}) — they may edit the same files. Start one with Worktree checked.`}
            >
              ⚠
            </span>
          )}
          {tab.agent && (
            <AgentIcon agent={tab.agent} color={agentInfo(tab.agent)?.color} label={agentInfo(tab.agent)?.label} />
          )}
          <span className="tab-time">{timeAgo(tab.updatedAt)}</span>
        </div>
        <div className="tab-sub">
          {noHooks && (
            <button
              className="tab-nohooks"
              title={`${agentInfo(tab.agent)?.label ?? tab.agent} has no Quazar hooks, so this tab can't show what it's doing. Click to install them.`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                useApp.getState().openModal({ kind: "hooks" });
              }}
            >
              no status
            </button>
          )}
          <span className="tab-sub-text">{subtitle(tab, live)}</span>
          {!!changes?.files && (
            <button
              className="tab-changes"
              title={`${changes.files} file${changes.files === 1 ? "" : "s"} changed — click to review`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                useApp.getState().openModal({ kind: "changes", tabId: tab.id });
              }}
            >
              <span className="plus">+{changes.added}</span>
              <span className="minus">−{changes.removed}</span>
            </button>
          )}
          {live && <TabMetrics tabId={tab.id} />}
        </div>
      </div>
      <div
        className="tab-actions"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <TagButton tab={tab} />
        <button
          className="tab-action"
          onClick={(e) => {
            e.stopPropagation();
            actions.setTabHidden(tab.id, !tab.hidden);
          }}
          title={tab.hidden ? "Unhide tab" : "Hide tab (it keeps running)"}
        >
          {tab.hidden ? <EyeIcon size={12} /> : <EyeOffIcon size={12} />}
        </button>
        <button
          className="tab-action"
          onClick={(e) => {
            e.stopPropagation();
            void actions.closeTab(tab.id);
          }}
          title="Close tab"
        >
          ×
        </button>
      </div>
    </div>
  );
}

/** Opens the tips; a dot while some tips haven't been opened yet. */
function TipsButton() {
  const unseen = useApp((s) => unseenTips(s.config!.tipsSeen));
  return (
    <button
      className="icon-btn tips-btn"
      title={unseen ? `Tips — ${unseen} new` : "Tips"}
      onClick={() => useApp.getState().openModal({ kind: "tips" })}
    >
      <LightbulbIcon />
      {unseen > 0 && <span className="tips-dot" />}
    </button>
  );
}

/** Rebuilding Quazar from its source: shown when the source changed since this build. */
function UpdateButton() {
  const update = useApp((s) => s.update);
  if (!update) return null;
  switch (update.phase) {
    case "available":
      return (
        <button
          className="update-btn"
          onClick={() => void actions.startUpdate()}
          title="Quazar's source changed since this build. Click to rebuild it in the background (a few minutes); you restart when it's ready."
        >
          Update
        </button>
      );
    case "building":
      return (
        <span className="update-btn building" title={update.line}>
          <span className="update-spinner" />
          Updating…
        </span>
      );
    case "ready":
      return (
        <button
          className="update-btn ready"
          onClick={actions.installUpdate}
          title="The new build is ready. Restart now: tabs and agent sessions come back."
        >
          Restart to update
        </button>
      );
    case "failed":
      return (
        <button
          className="update-btn failed"
          onClick={() => void actions.startUpdate()}
          title={`The build failed — see ${update.log}. Click to try again.`}
        >
          Update failed · retry
        </button>
      );
  }
}

/** "2 waiting · 1 done": agents needing you. Hover lists them (click one to open it); click for the next one (⌘J). */
function AttentionPill() {
  const waiting = useApp((s) => attention(s.tabs).filter((t) => t.status === "waiting").length);
  const done = useApp((s) => attention(s.tabs).length) - waiting;
  const hover = useHoverPopover<{ left: number; top: number }, HTMLButtonElement>((pill) => {
    const r = windowRect(pill);
    return { left: r.left, top: r.bottom + 4 };
  });
  if (!waiting && !done) return null;
  return (
    <>
      <button
        ref={hover.trigger}
        className={"attention-pill" + (waiting ? " waiting" : " done")}
        onClick={actions.nextNeedingYou}
        onMouseEnter={hover.onMouseEnter}
        onMouseLeave={hover.onMouseLeave}
        aria-label="Agents needing you"
      >
        <span className="attention-dot" />
        {[waiting && `${waiting} waiting`, done && `${done} done`].filter(Boolean).join(" · ")}
      </button>
      {hover.anchor &&
        createPortal(
          <AttentionList anchor={hover.anchor} panelRef={hover.panel} onClose={hover.close} />,
          document.body,
        )}
    </>
  );
}

function AttentionList({
  anchor,
  panelRef,
  onClose,
}: {
  anchor: { left: number; top: number };
  panelRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const tabs = useApp((s) => s.tabs);
  const me = useApp((s) => s.me);
  const queue = attention(tabs);
  const width = 320;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  return (
    <div ref={panelRef} className="ctx attention-list" style={{ left, top: anchor.top, width }}>
      <div className="hm-head">
        <span>Needs you</span>
        <span className="metrics-note">{key("next-attention")} for the next</span>
      </div>
      {queue.length === 0 && <div className="hm-empty">Nothing right now.</div>}
      {queue.map((t) => (
        <div
          key={t.id}
          className="hm-row clickable"
          onClick={() => {
            onClose();
            actions.revealTab(t.id);
          }}
        >
          <span className={"dot " + t.status} />
          <div className="hm-text">
            <div className="hm-title">
              {t.title}
              {(t.window ?? "main") !== me && (
                <span className="tab-window" title="In another window — opens here">
                  <WindowIcon size={10} />
                </span>
              )}
            </div>
            <div className="hm-sub">
              {t.status === "waiting" ? t.detail || "Needs your input" : t.summary || "Finished"}
            </div>
          </div>
          <span className="hm-time">{timeAgo(t.updatedAt)}</span>
        </div>
      ))}
    </div>
  );
}

/** Where a drag would land if released at (x, y). */
function dropAt(drag: Drag, x: number, y: number): Drop | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const section = el?.closest<HTMLElement>("[data-section]");
  if (!section) return null;
  const key = section.dataset.section!;
  if (drag.kind === "node") {
    // Not onto itself or anything inside it.
    const dragged = document.querySelector(`[data-section="${CSS.escape(drag.id)}"]`);
    if (dragged?.contains(section)) return null;
    const head = el?.closest<HTMLElement>(".section-head");
    if (!head || head.parentElement !== section) return { kind: "node", target: key, position: "inside" };
    // Header: top quarter = before, bottom quarter = after, middle = inside.
    const r = head.getBoundingClientRect();
    const at = (y - r.top) / r.height;
    return { kind: "node", target: key, position: at < 0.25 ? "before" : at > 0.75 ? "after" : "inside" };
  }
  const row = el?.closest<HTMLElement>("[data-tab]");
  if (row && row.dataset.tab !== drag.id) {
    const r = row.getBoundingClientRect();
    return {
      kind: "tab",
      node: key,
      target: row.dataset.tab!,
      position: y < r.top + r.height / 2 ? "before" : "after",
    };
  }
  if (row) return null; // over itself
  return { kind: "tab", node: key, target: null, position: "after" };
}

export function Sidebar() {
  // Subscribing to these re-renders the sidebar whenever sections could change.
  useApp((s) => s.tabs);
  useApp((s) => s.groups);
  useApp((s) => s.sectionOrder);
  const collapsedAuto = useApp((s) => s.collapsedAuto);
  const side = useApp((s) => s.config!.sidebarSide);
  const width = useApp((s) => s.config!.sidebarWidth);
  const zoom = useApp((s) => s.config!.sidebarZoom ?? 1);
  const autoGroup = useApp((s) => s.config!.autoGroup);
  const tabCount = useApp((s) => s.tabs.length);
  const hiddenSections = useApp((s) => s.hiddenSections);
  const hiddenCount = useApp((s) => s.tabs.filter((t) => t.hidden).length) + hiddenSections.length;
  const showHidden = useApp((s) => !!s.config!.showHiddenTabs);
  const [menu, setMenu] = useState<MenuState | null>(null);
  /** The hidden-items popover, opened by hovering the eye toggle. */
  const manager = useHoverPopover<ManagerAnchor, HTMLButtonElement>((eye) => {
    const r = windowRect(eye);
    return { right: r.right, top: r.bottom + 4 };
  });
  const [drop, setDrop] = useState<Drop | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  /** Set when a drag just ended, so the click that follows pointerup is ignored. */
  const suppressClick = useRef(false);

  const tree = sidebarTree();
  const allCollapsed = tree.length > 0 && actions.allSectionsCollapsed();

  const tabMenu = (e: React.MouseEvent, tab: Tab) => {
    e.preventDefault();
    const s = useApp.getState();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Rename…", run: () => actions.renameTab(tab.id) },
        { label: "Add tag…", run: () => s.openModal({ kind: "tag", tabId: tab.id }) },
        ...(actions.canOpenInNewWindow(tab)
          ? [{ label: "Open in new window", run: () => void actions.openInNewWindow(tab.id) }]
          : []),
        {
          label: "Move to group…",
          run: () => s.openModal({ kind: "move-tab", tabId: tab.id }),
        },
        {
          label: "Open in VS Code",
          run: () => void actions.openInVSCode(tab.id),
        },
        ...(actions.canFork(tab) ? [{ label: "Fork session", run: () => void actions.forkTab(tab.id) }] : []),
        {
          label: "Copy resume command",
          run: () => void actions.copyResumeCommand(tab.id),
        },
        ...s
          .config!.profiles.filter((p) => p.command)
          .map((p) => ({
            label: `New ${p.name} here`,
            run: () => actions.newTab(tab.cwd, p, tab.groupId),
          })),
        {
          label: tab.hidden ? "Unhide tab" : "Hide tab",
          run: () => actions.setTabHidden(tab.id, !tab.hidden),
        },
        {
          label: "Close tab",
          run: () => void actions.closeTab(tab.id),
          danger: true,
        },
      ],
    });
  };

  // "Open in VS Code" for each of a node's folders.
  const vscodeItems = (folders: string[]): MenuItem[] =>
    folders.map((f) => ({
      label: folders.length === 1 ? "Open in VS Code" : `Open ${tildify(f)} in VS Code`,
      run: () => void actions.openFolderInVSCode(f),
    }));

  const groupMenu = (e: React.MouseEvent, groupId: string, folders: string[]) => {
    e.preventDefault();
    const s = useApp.getState();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "New tab in group…",
          run: () => s.openModal({ kind: "launcher", mode: "agent", groupId }),
        },
        { label: "New subgroup", run: () => actions.newGroup(groupId) },
        ...vscodeItems(folders),
        {
          label: "Choose folders…",
          run: () => s.openModal({ kind: "group-folders", groupId }),
        },
        { label: "Rename…", run: () => actions.renameGroup(groupId) },
        {
          label: "Delete group (keeps tabs)",
          run: () => actions.deleteGroup(groupId),
          danger: true,
        },
      ],
    });
  };

  const folderMenu = (e: React.MouseEvent, key: string, folder: string, openSessions: () => void) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Resume a session…", run: openSessions },
        { label: "New group here", run: () => actions.newGroup(key) },
        ...vscodeItems([folder]),
      ],
    });
  };

  const startDrag = (kind: Drag["kind"], id: string) => (e: React.PointerEvent) => {
    drag.current = { kind, id, x: e.clientX, y: e.clientY, active: false };
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
        d.active = true;
        setDragId(d.id);
        document.body.classList.add("dragging-any");
      }
      if (!d.active) return;
      const out = d.kind === "tab" && outsideWindow(e);
      document.body.classList.toggle("tear-out", out);
      setDrop(out ? null : dropAt(d, e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      setDrop(null);
      setDragId(null);
      document.body.classList.remove("dragging-any", "tear-out");
      if (!d?.active) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      // Dropped outside the window: the tab gets a window of its own there, title bar under the pointer.
      if (d.kind === "tab" && outsideWindow(e)) {
        const tab = useApp.getState().tabs.find((t) => t.id === d.id);
        if (tab && actions.canOpenInNewWindow(tab))
          void actions.openInNewWindow(d.id, [e.screenX - 120, e.screenY - 14]);
        return;
      }
      const target = dropAt(d, e.clientX, e.clientY);
      const s = useApp.getState();
      if (target?.kind === "tab") s.moveTab(d.id, target.node, target.target, target.position);
      if (target?.kind === "node") s.moveNode(d.id, target.target, target.position);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const renderNode = (node: Node): React.ReactNode => {
    const collapsed = isCollapsed(node, collapsedAuto);
    // Shown (dimmed) only while hidden things are shown.
    const nodeHidden = hiddenSections.includes(node.key);
    const all = subtreeTabs(node);
    // A custom group's folders, or the repo/folder a folder node stands for.
    const folders = node.group ? node.group.folders : node.folder ? [node.folder] : [];
    const waiting = all.filter((t) => t.agentRunning && t.status === "waiting").length;
    const toggle = () =>
      node.group
        ? useApp.getState().updateGroup(node.group.id, { collapsed: !collapsed })
        : useApp.getState().toggleAutoCollapsed(node.key);
    const nodeDrop =
      drop?.kind === "node" && drop.target === node.key
        ? " drop-" + (drop.position === "inside" ? "into" : drop.position)
        : drop?.kind === "tab" && drop.node === node.key && !drop.target
          ? " drop-into"
          : "";
    // A folder node's sessions; resumed ones go to the group the folder is shown in.
    const openSessions = () => {
      const groupId = ownerGroupId(pathTo(sidebarTree(true), node.key) ?? []);
      useApp.getState().openModal({
        kind: "sessions",
        folder: node.folder!,
        groupId: groupId === "none" ? null : groupId,
      });
    };
    const newTabHere = () => {
      actions.expandNodes([node.key]);
      const s = useApp.getState();
      if (node.group) return s.openModal({ kind: "launcher", mode: "agent", groupId: node.group.id });
      // Folder nodes: a shell in the folder (in the group it's shown under), with an agent picker at the bottom.
      const cwd = node.folder ?? all[0]?.repoRoot ?? all[0]?.cwd;
      const path = pathTo(sidebarTree(true), node.key) ?? [];
      const groupId = ownerGroupId(path);
      if (cwd && (node.folder || all.length === 1))
        actions.newTabWithQuickLaunch(cwd, groupId === "none" ? null : groupId);
      else s.openModal({ kind: "launcher", mode: "agent" });
    };
    return (
      <div
        key={node.key}
        className={"section" + (node.depth ? " nested" : "") + nodeDrop + (dragId === node.key ? " dragging" : "")}
        data-section={node.key}
      >
        <div
          className={"section-head" + (node.group ? " custom" : "") + (nodeHidden ? " hidden" : "")}
          onPointerDown={(e) => e.button === 0 && startDrag("node", node.key)(e)}
          onClick={toggle}
          onDoubleClick={() => node.group && actions.renameGroup(node.group.id)}
          onContextMenu={(e) =>
            node.group
              ? groupMenu(e, node.group.id, folders)
              : node.folder && folderMenu(e, node.key, node.folder, openSessions)
          }
        >
          <span className={"chev" + (collapsed ? "" : " open")}>›</span>
          <span className="section-name">{node.name}</span>
          <span className="section-count">({all.length})</span>
          {waiting > 0 && <span className="badge">{waiting}</span>}
          <span className="section-actions">
            <button
              className="icon-btn small"
              title={
                nodeHidden ? "Unhide group (tabs you hid one by one stay hidden)" : "Hide group (its tabs keep running)"
              }
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                actions.setSectionHidden(node.key, !nodeHidden);
              }}
            >
              {nodeHidden ? <EyeIcon size={12} /> : <EyeOffIcon size={12} />}
            </button>
            {node.folder && (
              <button
                className="icon-btn small"
                title="Resume a session in this folder"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  openSessions();
                }}
              >
                <HistoryIcon />
              </button>
            )}
            <button
              className="icon-btn small"
              title="New tab here"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                newTabHere();
              }}
            >
              <PlusIcon />
            </button>
            {node.group && (
              <button
                className="icon-btn small danger"
                title="Delete group (its tabs and groups move up a level)"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.deleteGroup(node.key);
                }}
              >
                <TrashIcon />
              </button>
            )}
          </span>
        </div>
        {!collapsed && node.children.map(renderNode)}
        {!collapsed &&
          node.tabs.map((tab) => (
            <TabRow
              key={tab.id}
              tab={tab}
              dragging={dragId === tab.id}
              drop={drop?.kind === "tab" && drop.target === tab.id ? drop.position : null}
              onMenu={tabMenu}
              onDragStart={startDrag("tab", tab.id)}
            />
          ))}
        {!collapsed && node.group && all.length === 0 && node.children.length === 0 && (
          <div className="section-empty">Drop tabs or groups here, or ＋ to start one</div>
        )}
      </div>
    );
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const dir = side === "left" ? 1 : -1;
    document.body.classList.add("resizing");
    const move = (ev: PointerEvent) => actions.setSidebarWidth(startWidth + (ev.clientX - startX) * dir);
    const up = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      actions.saveConfig();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className="sidebar-wrap"
      style={{ width }}
      onPointerDownCapture={() => useApp.getState().setFocusArea("sidebar")}
    >
      <aside
        className="sidebar"
        style={{ zoom, width: width / zoom, "--z": zoom } as React.CSSProperties}
        onClickCapture={(e) => suppressClick.current && e.stopPropagation()}
      >
        <div className={"sidebar-head" + (side === "left" && isMac ? " lights" : "")} data-tauri-drag-region>
          <span className="brand" data-tauri-drag-region title={`Quazar ${actions.versionText()}`}>
            Quazar
          </span>
          <UpdateButton />
          <button
            className="icon-btn"
            title={`Hide sidebar (${key("toggle-sidebar")})`}
            onClick={() => useApp.setState({ sidebarHidden: true })}
          >
            <PanelIcon side={side} />
          </button>
          <TipsButton />
          <button
            className="icon-btn"
            title={`Settings (${key("settings")})`}
            onClick={() => useApp.getState().openModal({ kind: "settings" })}
          >
            {/* Lucide "settings" gear (ISC license). */}
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>

        <div className="sidebar-tools">
          <NewButton />
          <AttentionPill />
          <span className="tools-spacer" />
          <button
            className="icon-btn tool-btn"
            onClick={actions.toggleAllSections}
            aria-label={allCollapsed ? "Expand all" : "Collapse all"}
            data-tip={allCollapsed ? "Expand all groups" : "Collapse all groups"}
          >
            {allCollapsed ? <ExpandAllIcon /> : <CollapseAllIcon />}
          </button>
          <button
            ref={manager.trigger}
            className={"icon-btn tool-btn hidden-toggle" + (showHidden ? " on" : "")}
            onClick={actions.toggleShowHiddenTabs}
            onMouseEnter={manager.onMouseEnter}
            onMouseLeave={manager.onMouseLeave}
            aria-label="Show hidden groups and tabs"
          >
            {showHidden ? <EyeIcon /> : <EyeOffIcon />}
            {hiddenCount > 0 && <span className="hidden-count">{hiddenCount}</span>}
          </button>
          <button
            className={"icon-btn tool-btn" + (autoGroup ? " on" : "")}
            onClick={actions.toggleAutoGroup}
            aria-label="Group by folder"
            aria-pressed={autoGroup}
            data-tip={autoGroup ? "Grouping tabs by folder · click for one list" : "Group tabs by folder"}
          >
            <FolderTreeIcon />
          </button>
        </div>

        <div className="sections">
          {tree.map(renderNode)}
          {tabCount === 0 && (
            <div className="sidebar-empty">
              No tabs yet.
              <br />
              {key("new-tab")} new tab · {key("new-agent")} new agent
            </div>
          )}
        </div>
        <MetricsBar />
      </aside>
      <div
        className="resize-handle"
        onPointerDown={startResize}
        onDoubleClick={() => {
          actions.setSidebarWidth(280);
          actions.saveConfig();
        }}
        title="Drag to resize · double-click to reset"
      />
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {/* Portaled: the sidebar is zoomed, which would skew a fixed-position popover inside it. */}
      {manager.anchor &&
        createPortal(
          <HiddenManager anchor={manager.anchor} panelRef={manager.panel} onClose={manager.close} />,
          document.body,
        )}
    </div>
  );
}
