import { useEffect } from "react";
import * as actions from "../actions";
import { sidebarTree, useApp } from "../store";
import { flatten, pathTo, pathToTab, subtreeTabs } from "../tree";
import { tildify, timeAgoLong } from "../util";
import { EyeIcon, TrashIcon } from "./icons";

const WIDTH = 300;

/** Where the popover opens: below the eye toggle, its right edge lined up with the toggle's. */
export interface ManagerAnchor {
  right: number;
  top: number;
}

/**
 * Popover listing hidden groups and tabs, opened by hovering the eye toggle: when each was last
 * used, and buttons to unhide or delete them.
 */
export function HiddenManager({
  anchor,
  panelRef: ref,
  onClose,
}: {
  anchor: ManagerAnchor;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const tabs = useApp((s) => s.tabs);
  const showHidden = useApp((s) => !!s.config!.showHiddenTabs);
  const hiddenSections = useApp((s) => s.hiddenSections);

  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, ref]);

  const tree = sidebarTree(true);
  const groups = flatten(tree).filter((n) => hiddenSections.includes(n.key));
  const hiddenTabs = tabs.filter((t) => t.hidden);
  /** "Parent / Child" names of the nodes above `key`, or holding tab `tabId`. */
  const where = (path: { name: string }[] | null) => path?.map((n) => n.name).join(" / ");
  const sectionName = (tabId: string) => where(pathToTab(tree, tabId));
  const empty = groups.length === 0 && hiddenTabs.length === 0;

  const left = Math.max(8, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - 8));
  /** Most recent use of any tab in the group. */
  const lastUsed = (ts: { updatedAt: number }[]) => Math.max(0, ...ts.map((t) => t.updatedAt));
  return (
    <div ref={ref} className="ctx hidden-manager" style={{ left, top: anchor.top, width: WIDTH }}>
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
      {groups.map((s) => {
        const inside = subtreeTabs(s);
        const used = lastUsed(inside);
        return (
          <div className="hm-row" key={s.key}>
            <div className="hm-text">
              <div className="hm-title">{s.name}</div>
              <div className="hm-sub">
                {[
                  where(pathTo(tree, s.key)?.slice(0, -1) ?? null),
                  `${inside.length} tab${inside.length === 1 ? "" : "s"}`,
                  used ? `used ${timeAgoLong(used)}` : null,
                ]
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
            {s.group && (
              <button
                className="icon-btn hm-delete"
                title="Delete group (its tabs move up a level and keep running)"
                onClick={() => actions.deleteGroup(s.group!.id, true)}
              >
                <TrashIcon size={12} />
              </button>
            )}
          </div>
        );
      })}
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
              <div className="hm-sub">
                {[`used ${timeAgoLong(t.updatedAt)}`, section, tildify(t.cwd)].filter(Boolean).join(" · ")}
              </div>
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
            <button
              className="icon-btn hm-delete"
              title="Delete tab (closes it and stops what runs in it)"
              onClick={(e) => {
                e.stopPropagation();
                actions.deleteTab(t.id);
              }}
            >
              <TrashIcon size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
