// Tips: the features that hide behind hover, right-click and drag, each with a small live mock drawn with
// the app's own styles (no images, so they always look like the current app).
import { useEffect, useState } from "react";
import * as actions from "../actions";
import { key } from "../platform";
import { agentInfo, useApp } from "../store";
import type { TagColor } from "../types";
import { tagStyle } from "./Tags";
import { AgentIcon, BoltIcon, EyeOffIcon, HistoryIcon, TagIcon } from "./icons";

interface Tip {
  id: string;
  title: string;
  /** What it does and how to reach it. */
  body: React.ReactNode;
  mock: () => React.ReactNode;
  /** A button that opens the feature right away. */
  action?: { label: string; run: () => void };
}

function Badge({ name, color }: { name: string; color: TagColor }) {
  return (
    <span className="tag-badge static" style={tagStyle(color)}>
      <span className="tag-badge-name">{name}</span>
    </span>
  );
}

/** A sidebar tab row, as drawn in the sidebar. */
function MockTab({
  title,
  agent = "claude",
  status = "done",
  sub,
  tags = [],
  className = "",
  after,
  actions: withActions,
}: {
  title: string;
  agent?: string | null;
  status?: "working" | "waiting" | "done";
  sub: React.ReactNode;
  tags?: [string, TagColor][];
  className?: string;
  after?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className={"tab mock " + className}>
      <span className={"dot " + (agent ? status : "shell")} />
      <div className="tab-body">
        <div className="tab-line">
          {tags.map(([name, color]) => (
            <Badge key={name} name={name} color={color} />
          ))}
          <span className="tab-title">{title}</span>
          {agent && <AgentIcon agent={agent} color={agentInfo(agent)?.color} />}
          <span className="tab-time">2m</span>
        </div>
        <div className="tab-sub">
          <span className="tab-sub-text">{sub}</span>
          {after}
        </div>
      </div>
      {withActions && <div className="tab-actions shown">{withActions}</div>}
    </div>
  );
}

const TIPS: Tip[] = [
  {
    id: "tags",
    title: "Tag your tabs",
    body: (
      <>
        Hover a tab and point at its <b>tag button</b> for your tags — click one to add it. Click a tag on a tab to swap
        it for another (same category first); hover it for <b>×</b> to take it off. Manage and reorder tags in{" "}
        <b>Settings → Tags</b>.
      </>
    ),
    mock: () => (
      <div className="tip-mock-col">
        <MockTab
          title="Fix login redirect"
          tags={[
            ["In review", "yellow"],
            ["Bug", "rose"],
          ]}
          sub="Opened PR #142"
          actions={
            <span className="tab-action hot">
              <TagIcon />
            </span>
          }
        />
        <div className="ctx tip-pop">
          <div className="ctx-item tag-pop-item">
            <span className="tag-pop-check">✓</span>
            <Badge name="In review" color="yellow" />
            <span className="tag-pop-cat">Status</span>
          </div>
          <div className="ctx-item tag-pop-item active">
            <span className="tag-pop-check" />
            <Badge name="Done" color="green" />
            <span className="tag-pop-cat">Status</span>
          </div>
          <div className="ctx-item tag-pop-item">
            <span className="tag-pop-check">✓</span>
            <Badge name="Bug" color="rose" />
            <span className="tag-pop-cat">Kind</span>
          </div>
        </div>
      </div>
    ),
    action: { label: "Manage tags", run: () => useApp.getState().openModal({ kind: "settings", section: "Tags" }) },
  },
  {
    id: "skills",
    title: "Run skills from the console",
    body: (
      <>
        The <b>bolt</b> button floating in the console lists the skills you ran most recently, plus the ones you made.
        Click one to run it in the tab's agent; <b>Shift-click</b> types it so you can add details. Drag the button
        anywhere; double-click puts it back.
      </>
    ),
    mock: () => (
      <div className="tip-console">
        <div className="tip-console-text">
          <span className="faint">›</span> /review-pr 142
        </div>
        <div className="ctx tip-pop tip-dock-menu">
          <div className="hm-head">
            <span>Skills · Claude Code</span>
          </div>
          {["review-pr", "create-jira-ticket", "deploy-staging"].map((s, i) => (
            <div key={s} className={"dock-item" + (i === 0 ? " active" : "")}>
              <span className="dock-item-name">/{s}</span>
              {i === 2 && <span className="dock-tag">yours</span>}
            </div>
          ))}
        </div>
        <span className="console-dock tip-dock open">
          <BoltIcon size={18} />
        </span>
      </div>
    ),
  },
  {
    id: "attention",
    title: "Jump to the agent that needs you",
    body: (
      <>
        The pill at the top of the sidebar counts agents waiting for you or finished while you looked elsewhere. Click
        it — or press <kbd>{key("next-attention")}</kbd> anywhere — to go to the next one; hover it for the list.
      </>
    ),
    mock: () => (
      <div className="tip-mock-col">
        <span className="attention-pill waiting tip-inline">
          <span className="attention-dot" />2 waiting · 1 done
        </span>
        <MockTab title="Migrate billing tables" status="waiting" sub="Needs your input" />
        <MockTab title="Add rate limiter" status="done" agent="codex" sub="Added middleware and tests" />
      </div>
    ),
  },
  {
    id: "changes",
    title: "Review an agent's changes",
    body: (
      <>
        The <b>+added −removed</b> figure on a tab shows its uncommitted changes. Click it for a unified or split diff,
        comment on lines, and send the comments back to the agent as its next prompt.
      </>
    ),
    mock: () => (
      <MockTab
        title="Refactor auth middleware"
        sub="Done — 4 files changed"
        after={
          <span className="tab-changes hot">
            <span className="plus">+128</span>
            <span className="minus">−41</span>
          </span>
        }
      />
    ),
  },
  {
    id: "tear-out",
    title: "Drag a tab out for its own window",
    body: (
      <>
        Drag a tab from the sidebar past the window's edge and let go: it opens in a new window right there — one
        console per monitor. Opening that tab from another window moves it back and closes the extra window.
      </>
    ),
    mock: () => (
      <div className="tip-tear">
        <MockTab title="Dev server" agent={null} sub="npm run dev" className="dragging" />
        <span className="tip-tear-label">Release to open in a new window</span>
      </div>
    ),
  },
  {
    id: "resources",
    title: "See what's using your CPU",
    body: (
      <>
        Every tab shows its CPU and memory. Hover a tab's figure (or the total at the bottom of the sidebar) for every
        process in it — dev servers with their ports — and stop the one that's running away.
      </>
    ),
    mock: () => (
      <MockTab
        title="Storybook"
        agent={null}
        sub="npm run storybook"
        after={<span className="tab-metrics high hot">84% · 1.2 GB</span>}
      />
    ),
  },
  {
    id: "resume",
    title: "Resume any session",
    body: (
      <>
        Every agent session in a folder — the ones Quazar ran and the ones you started elsewhere — can be resumed with
        its original flags. Use the <b>history</b> button on a folder, or right-click it → <b>Resume a session…</b>.
        Right-click a tab to <b>fork</b> its session or copy its resume command.
      </>
    ),
    mock: () => (
      <div className="tip-mock-col">
        <div className="tip-folder">
          <span>quazar</span>
          <span className="icon-btn small hot">
            <HistoryIcon />
          </span>
        </div>
        <div className="ctx tip-pop">
          <div className="ctx-item active">Resume a session…</div>
          <div className="ctx-item">New group here</div>
          <div className="ctx-item">Open in VS Code</div>
        </div>
      </div>
    ),
  },
  {
    id: "organize",
    title: "Group, hide and rename tabs",
    body: (
      <>
        Drag tabs and groups to reorder them or nest them in your own groups. The <b>eye</b> button hides a tab while it
        keeps running. Double-click a tab to rename it; right-click for everything else.
      </>
    ),
    mock: () => (
      <MockTab
        title="Write release notes"
        status="working"
        sub="Reading CHANGELOG.md"
        actions={
          <>
            <span className="tab-action">
              <TagIcon />
            </span>
            <span className="tab-action hot">
              <EyeOffIcon size={12} />
            </span>
            <span className="tab-action">×</span>
          </>
        }
      />
    ),
  },
  {
    id: "palette",
    title: "Do anything from the keyboard",
    body: (
      <>
        The command palette has every command and every tab: press <kbd>{key("palette")}</kbd> and type. Also{" "}
        <kbd>{key("new-agent")}</kbd> for a new agent, <kbd>{key("new-tab")}</kbd> for a terminal,{" "}
        <kbd>{key("goto-tab")}</kbd> to switch tabs, and <kbd>{key("zoom-in")}</kbd> / <kbd>{key("zoom-out")}</kbd> to
        resize the sidebar or terminal — whichever you used last.
      </>
    ),
    mock: () => (
      <div className="tip-palette">
        <div className="picker-input">rename</div>
        <div className="picker-item active">
          <span className="picker-label">Rename tab…</span>
          <span className="picker-hint">{key("rename-tab")}</span>
        </div>
        <div className="picker-item">
          <span className="picker-label">Add tag to tab…</span>
        </div>
      </div>
    ),
    action: {
      label: "Open the palette",
      run: () => useApp.getState().openModal({ kind: "palette" }),
    },
  },
];

/** Tips not opened yet, for the dot on the tips button. */
export function unseenTips(seen: string[] | undefined) {
  return TIPS.filter((t) => !seen?.includes(t.id)).length;
}

export function Tips({ onClose }: { onClose: () => void }) {
  const seen = useApp((s) => s.config!.tipsSeen);
  const [id, setId] = useState(() => TIPS.find((t) => !seen?.includes(t.id))?.id ?? TIPS[0].id);
  const index = TIPS.findIndex((t) => t.id === id);
  const tip = TIPS[index];

  // Opening a tip marks it seen.
  useEffect(() => {
    const now = useApp.getState().config!.tipsSeen ?? [];
    if (now.includes(id)) return;
    useApp.getState().setConfig({ tipsSeen: [...now, id] });
    actions.saveConfig();
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      const step =
        e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
      if (step) {
        e.preventDefault();
        setId(TIPS[(index + step + TIPS.length) % TIPS.length].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="picker tips" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">Tips</div>
        <div className="tips-body">
          <div className="tips-list" role="tablist">
            {TIPS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={t.id === id}
                className={"tips-item" + (t.id === id ? " active" : "") + (seen?.includes(t.id) ? " seen" : " new")}
                onClick={() => setId(t.id)}
              >
                <span className="tips-new" />
                {t.title}
              </button>
            ))}
          </div>
          <div className="tips-detail">
            <div className="tip-stage" aria-hidden>
              {tip.mock()}
            </div>
            <div className="tip-title">{tip.title}</div>
            <div className="tip-text">{tip.body}</div>
          </div>
        </div>
        <div className="picker-footer">
          <span>
            {index + 1} of {TIPS.length} · ↑↓ to browse
          </span>
          <span className="tips-buttons">
            {tip.action && (
              <button className="btn small" onClick={tip.action.run}>
                {tip.action.label}
              </button>
            )}
            <button className="btn small primary" onClick={() => setId(TIPS[(index + 1) % TIPS.length].id)}>
              Next tip
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
