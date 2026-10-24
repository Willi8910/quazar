// The console's floating button: hover it for quick actions on the tab. Each section of its menu is
// one entry in `SECTIONS`; skills are the first.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { runSkill, saveConfig } from "../actions";
import { api } from "../api";
import { DEFAULT_RECENT_SKILLS, pickSkills, SkillEntry } from "../skills";
import { agentInfo, useApp } from "../store";
import type { Skill, Tab } from "../types";
import { useHoverPopover } from "./hover";
import { BoltIcon } from "./icons";

interface SectionProps {
  tab: Tab;
  /** Closes the menu (after an action). */
  close: () => void;
}

/** The menu's sections, top to bottom. */
const SECTIONS: ((props: SectionProps) => React.ReactNode)[] = [SkillsSection];

/** Where the menu opens: toward the side of the window with more room. */
interface Placement {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

function placeMenu(button: HTMLElement): Placement {
  const r = button.getBoundingClientRect();
  const [vw, vh] = [window.innerWidth, window.innerHeight];
  const x = r.left + r.width / 2 < vw / 2 ? { left: r.left } : { right: vw - r.right };
  const y = r.top + r.height / 2 < vh / 2 ? { top: r.bottom + 6 } : { bottom: vh - r.top + 6 };
  const maxHeight = Math.max(160, ("top" in y ? vh - r.bottom : r.top) - 18);
  return { ...x, ...y, maxHeight };
}

/** Keeps the button this far (px) inside the console's edges. */
const EDGE = 24;

export function ConsoleDock() {
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.activeId));
  const enabled = useApp((s) => s.config!.consoleButton !== false);
  const saved = useApp((s) => s.config!.consoleButtonAt);
  const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const { anchor, trigger, panel, onMouseEnter, onMouseLeave, close } = useHoverPopover(placeMenu, {
    closeDelay: 120,
  });
  if (!tab || !enabled) return null;

  // Dragging moves the button anywhere in the console; its centre is kept as fractions, so it stays put
  // relative to the console when the window is resized.
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
    if (!d.moved) close();
    d.moved = true;
    const area = e.currentTarget.parentElement!.getBoundingClientRect();
    const clamp = (v: number, size: number) => Math.min(Math.max(v, EDGE), size - EDGE) / size;
    setDragAt({ x: clamp(e.clientX - area.left, area.width), y: clamp(e.clientY - area.top, area.height) });
  };
  const onPointerUp = () => {
    const moved = drag.current?.moved;
    drag.current = null;
    if (!moved || !dragAt) return;
    useApp.getState().setConfig({ consoleButtonAt: dragAt });
    saveConfig();
    setDragAt(null);
  };

  const at = dragAt ?? saved;
  const style = at && {
    left: `${at.x * 100}%`,
    top: `${at.y * 100}%`,
    right: "auto",
    bottom: "auto",
    transform: "translate(-50%, -50%)",
  };
  return (
    <>
      <button
        ref={trigger as React.RefObject<HTMLButtonElement>}
        className={"console-dock" + (anchor ? " open" : "") + (dragAt ? " dragging" : "")}
        style={style || undefined}
        onMouseEnter={() => !drag.current && onMouseEnter()}
        onMouseLeave={onMouseLeave}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => {
          // Back to the default corner.
          useApp.getState().setConfig({ consoleButtonAt: undefined });
          saveConfig();
        }}
        aria-label="Quick actions"
        title={anchor ? undefined : "Drag to move · double-click to put back"}
      >
        <BoltIcon size={18} />
      </button>
      {anchor &&
        createPortal(
          <div ref={panel} className="ctx console-dock-menu" style={anchor}>
            {SECTIONS.map((Section, i) => (
              <Section key={i} tab={tab} close={close} />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Recently run skills, topped up with the user's own; click runs one in the tab's agent. */
function SkillsSection({ tab, close }: SectionProps) {
  const agent = tab.agent ?? "claude";
  const usage = useApp((s) => s.skillUsage);
  const count = useApp((s) => s.config!.recentSkills ?? DEFAULT_RECENT_SKILLS);
  const [available, setAvailable] = useState<Skill[] | null>(null);
  const cwd = tab.agentCwd ?? tab.cwd;

  // Read when the menu opens, not before.
  useEffect(() => {
    let current = true;
    api.listSkills(agent, cwd).then(
      (skills) => current && setAvailable(skills),
      () => current && setAvailable([]),
    );
    return () => {
      current = false;
    };
  }, [agent, cwd]);

  const skills = available && pickSkills(agent, usage, available, count);
  const ready = tab.agentRunning;
  const run = (skill: SkillEntry, submit: boolean) => {
    if (!ready) return;
    runSkill(tab.id, skill.name, submit);
    close();
  };
  return (
    <div className="dock-section">
      <div className="hm-head">
        <span>Skills · {agentInfo(agent)?.label ?? agent}</span>
        {!ready && <span className="metrics-note">start the agent to run one</span>}
      </div>
      {skills === null && <div className="hm-empty">Loading…</div>}
      {skills?.length === 0 && (
        <div className="hm-empty">
          No skills yet. Skills you run by typing <code>/name</code> show up here, and so do the ones you make.
        </div>
      )}
      {skills?.map((skill) => (
        <button
          key={skill.name}
          className="dock-item"
          disabled={!ready}
          title={skill.description || undefined}
          onClick={(e) => run(skill, !e.shiftKey)}
        >
          <span className="dock-item-name">/{skill.name}</span>
          {skill.scope === "project" && <span className="dock-tag">project</span>}
          {!skill.recent && <span className="dock-tag">yours</span>}
          {skill.description && <span className="dock-item-desc">{skill.description}</span>}
        </button>
      ))}
      {!!skills?.length && <div className="dock-hint">Click runs it · Shift-click types it so you can add details</div>}
    </div>
  );
}
