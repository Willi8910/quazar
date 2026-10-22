import { useEffect, useRef } from "react";
import * as actions from "../actions";
import { sidebarTree, useApp } from "../store";
import { flatten, pathTo, pathToTab, subtreeTabs } from "../tree";
import { tildify } from "../util";
import { EyeIcon } from "./icons";

const WIDTH = 300;

/** Popover listing hidden groups and tabs, opened by hovering the eye toggle. */
export function HiddenManager({
  anchor,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: {
  anchor: DOMRect;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const tabs = useApp((s) => s.tabs);
  const showHidden = useApp((s) => !!s.config!.showHiddenTabs);
  const hiddenSections = useApp((s) => s.hiddenSections);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const tree = sidebarTree(true);
  const groups = flatten(tree).filter((n) => hiddenSections.includes(n.key));
  const hiddenTabs = tabs.filter((t) => t.hidden);
  /** "Parent / Child" names of the nodes above `key`, or holding tab `tabId`. */
  const where = (path: { name: string }[] | null) => path?.map((n) => n.name).join(" / ");
  const sectionName = (tabId: string) => where(pathToTab(tree, tabId));
  const empty = groups.length === 0 && hiddenTabs.length === 0;

  const left = Math.max(8, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - 8));
  return (
    <div
      ref={ref}
      className="ctx hidden-manager"
      style={{ left, top: anchor.bottom + 4, width: WIDTH }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="hm-head">
        <span>Hidden</span>
        {!empty && (
          <button className="link-btn" onClick={actions.unhideAll}>
            Unhide all
          </button>
        )}
      </div>
      <div className="hm-hint">
        {showHidden
          ? "Shown dimmed in the sidebar · click the eye to hide them"
          : "Click the eye to show them in the sidebar"}
      </div>
      {empty && <div className="hm-empty">Nothing is hidden. Hide groups and tabs with their eye buttons.</div>}
      {groups.length > 0 && <div className="hm-label">Groups</div>}
      {groups.map((s) => (
        <div className="hm-row" key={s.key}>
          <div className="hm-text">
            <div className="hm-title">{s.name}</div>
            <div className="hm-sub">
              {[where(pathTo(tree, s.key)?.slice(0, -1) ?? null), `${subtreeTabs(s).length} tabs`]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <button
            className="icon-btn hm-unhide"
            title="Unhide group"
            onClick={() => actions.setSectionHidden(s.key, false)}
          >
            <EyeIcon size={12} />
          </button>
        </div>
      ))}
      {hiddenTabs.length > 0 && <div className="hm-label">Tabs</div>}
      {hiddenTabs.map((t) => {
        const section = sectionName(t.id);
        return (
          <div
            className="hm-row clickable"
            key={t.id}
            title="Unhide and open"
            onClick={() => {
              actions.revealTab(t.id);
              onClose();
            }}
          >
            <div className="hm-text">
              <div className="hm-title">{t.title}</div>
              <div className="hm-sub">{section ? `${section} · ${tildify(t.cwd)}` : tildify(t.cwd)}</div>
            </div>
            <button
              className="icon-btn hm-unhide"
              title="Unhide tab"
              onClick={(e) => {
                e.stopPropagation();
                actions.setTabHidden(t.id, false);
              }}
            >
              <EyeIcon size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
