// Tags on tabs: the badge shown before a tab's name (click to swap it, × to remove it) and the modal that
// creates a tag or adds an existing one.
import { useState } from "react";
import { createPortal } from "react-dom";
import { saveConfig } from "../actions";
import { findTag, replacementGroups, TAG_COLORS, tagCategories } from "../tags";
import { useApp } from "../store";
import type { Tab, TagColor, TagDef } from "../types";
import { newId } from "../util";
import { useHoverPopover, windowRect } from "./hover";
import { TagIcon } from "./icons";

/** Stable empty list for selectors: a fresh `[]` each time would re-render forever. */
const NO_TAGS: TagDef[] = [];

/** Changes a tab's tag ids. Not `updateTab`: tagging isn't activity, so the tab's time stays put. */
export function setTabTags(tabId: string, change: (tags: string[]) => string[]) {
  useApp.setState((s) => ({
    tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, tags: change(t.tags ?? []) } : t)),
  }));
}

export function setTags(tags: TagDef[]) {
  useApp.getState().setConfig({ tags });
  saveConfig();
}

/** Deletes a tag and takes it off every tab. */
export function deleteTag(id: string) {
  const { config } = useApp.getState();
  setTags((config!.tags ?? []).filter((d) => d.id !== id));
  useApp.setState((s) => ({
    tabs: s.tabs.map((t) => (t.tags?.includes(id) ? { ...t, tags: t.tags.filter((x) => x !== id) } : t)),
  }));
}

/** Colours for a badge or swatch: text and border in the colour, a faint fill of it behind. */
export function tagStyle(color: TagColor): React.CSSProperties {
  const c = TAG_COLORS[color] ?? TAG_COLORS.gray;
  return { color: c, borderColor: c + "aa", background: c + "1f" };
}

export function ColorSwatches({ value, onChange }: { value: TagColor; onChange: (c: TagColor) => void }) {
  return (
    <div className="tag-swatches" role="radiogroup" aria-label="Colour">
      {(Object.keys(TAG_COLORS) as TagColor[]).map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          className={"tag-swatch" + (c === value ? " on" : "")}
          style={{ background: TAG_COLORS[c] }}
          title={c}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

/** A tag before a tab's name. Click swaps it for another tag; hover shows × to take it off. */
export function TagBadge({ tab, tag }: { tab: Tab; tag: TagDef }) {
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <>
      <span
        className="tag-badge"
        style={tagStyle(tag.color)}
        title={tag.category ? `${tag.name} · ${tag.category}` : tag.name}
        onPointerDown={stop}
        onDoubleClick={stop}
        onClick={(e) => {
          stop(e);
          const r = windowRect(e.currentTarget);
          setMenu(menu ? null : { left: r.left, top: r.bottom + 4 });
        }}
      >
        <span className="tag-badge-name">{tag.name}</span>
        <button
          className="tag-badge-x"
          aria-label={`Remove ${tag.name}`}
          title="Remove tag"
          onClick={(e) => {
            stop(e);
            setTabTags(tab.id, (tags) => tags.filter((id) => id !== tag.id));
          }}
        >
          ×
        </button>
      </span>
      {menu && <SwapMenu tab={tab} tag={tag} at={menu} close={() => setMenu(null)} />}
    </>
  );
}

/** Where the tag list opens: under the button, right-aligned to it, or above it near the window's bottom. */
function placeList(button: HTMLElement) {
  const r = windowRect(button);
  const right = window.innerWidth - r.right;
  const below = r.bottom < window.innerHeight * 0.6;
  return below
    ? { right, top: r.bottom + 4, maxHeight: window.innerHeight - r.bottom - 16 }
    : { right, bottom: window.innerHeight - r.top + 4, maxHeight: r.top - 16 };
}

/** The tab's tag button: hover lists the tags to add one in a click; click opens the create modal. */
export function TagButton({ tab }: { tab: Tab }) {
  const defs = useApp((s) => s.config!.tags ?? NO_TAGS);
  const { anchor, trigger, panel, onMouseEnter, onMouseLeave, close } = useHoverPopover(placeList);
  const openModal = () => {
    close();
    useApp.getState().openModal({ kind: "tag", tabId: tab.id });
  };
  const onTab = tab.tags ?? [];
  return (
    <>
      <button
        ref={trigger as React.RefObject<HTMLButtonElement>}
        className="tab-action"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={(e) => {
          e.stopPropagation();
          openModal();
        }}
        title={anchor ? undefined : "Add tag"}
      >
        <TagIcon />
      </button>
      {anchor &&
        createPortal(
          <div
            ref={panel}
            className="ctx tag-pop"
            style={anchor}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hm-head">
              <span>Add a tag</span>
            </div>
            {defs.length === 0 && <div className="hm-empty">No tags yet.</div>}
            {defs.map((d) => {
              const on = onTab.includes(d.id);
              return (
                <div
                  key={d.id}
                  className={"ctx-item tag-pop-item" + (on ? " on" : "")}
                  title={on ? "Already on this tab — click to remove it" : undefined}
                  onClick={() => setTabTags(tab.id, (tags) => (on ? tags.filter((x) => x !== d.id) : [...tags, d.id]))}
                >
                  <span className="tag-pop-check">{on ? "✓" : ""}</span>
                  <span className="tag-badge static" style={tagStyle(d.color)}>
                    <span className="tag-badge-name">{d.name}</span>
                  </span>
                  {d.category && <span className="tag-pop-cat">{d.category}</span>}
                </div>
              );
            })}
            <hr className="tag-pop-line" />
            <div className="ctx-item" onClick={openModal}>
              New tag…
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Other tags to put in this one's place: same category on top, the rest below a line. */
function SwapMenu({
  tab,
  tag,
  at,
  close,
}: {
  tab: Tab;
  tag: TagDef;
  at: { left: number; top: number };
  close: () => void;
}) {
  const defs = useApp((s) => s.config!.tags ?? NO_TAGS);
  const { same, other } = replacementGroups(tag, defs, tab.tags);
  const swap = (id: string) => {
    setTabTags(tab.id, (tags) => tags.map((x) => (x === tag.id ? id : x)));
    close();
  };
  const item = (d: TagDef) => (
    <div key={d.id} className="ctx-item tag-pop-item" onClick={() => swap(d.id)}>
      <span className="tag-badge static" style={tagStyle(d.color)}>
        <span className="tag-badge-name">{d.name}</span>
      </span>
      {d.category && <span className="tag-pop-cat">{d.category}</span>}
    </div>
  );
  return createPortal(
    <div className="overlay clear" onMouseDown={close}>
      <div className="ctx tag-pop" style={at} onMouseDown={(e) => e.stopPropagation()}>
        <div className="hm-head">
          <span>Replace {tag.name}</span>
        </div>
        {same.map(item)}
        {same.length > 0 && other.length > 0 && <hr className="tag-pop-line" />}
        {other.map(item)}
        {same.length + other.length === 0 && <div className="hm-empty">No other tags yet.</div>}
        <hr className="tag-pop-line" />
        <div
          className="ctx-item"
          onClick={() => {
            close();
            useApp.getState().openModal({ kind: "tag", tabId: tab.id });
          }}
        >
          New tag…
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The first colour no tag uses yet, so new tags tell apart by default. */
function nextColor(defs: TagDef[]): TagColor {
  const used = new Set(defs.map((d) => d.color));
  return (Object.keys(TAG_COLORS) as TagColor[]).find((c) => !used.has(c)) ?? "blue";
}

/** Creates a tag and puts it on the tab, or puts an existing one on it. */
export function TagModal({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const defs = useApp((s) => s.config!.tags ?? NO_TAGS);
  const tab = useApp((s) => s.tabs.find((t) => t.id === tabId));
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState<TagColor>(() => nextColor(defs));
  if (!tab) return null;

  const existing = findTag(defs, name);
  const onTab = tab.tags ?? [];
  const query = name.trim().toLowerCase();
  const suggestions = defs.filter((d) => !onTab.includes(d.id) && d.name.toLowerCase().includes(query));

  const add = (tag: TagDef) => {
    if (!onTab.includes(tag.id)) setTabTags(tabId, (tags) => [...tags, tag.id]);
    onClose();
  };
  const submit = () => {
    if (existing) return add(existing);
    if (!query) return;
    const tag: TagDef = { id: newId("tag"), name: name.trim(), category: category.trim(), color };
    setTags([...defs, tag]);
    add(tag);
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="picker tag-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter") submit();
        }}
      >
        <div className="picker-title">Tag “{tab.title}”</div>
        <div className="tag-form">
          <label className="tag-field">
            <span>Name</span>
            <input
              autoFocus
              className="input"
              value={name}
              placeholder="e.g. In review"
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
            />
          </label>
          {suggestions.length > 0 && (
            <div className="tag-suggestions">
              {suggestions.map((d) => (
                <button
                  key={d.id}
                  className="tag-badge static clickable"
                  style={tagStyle(d.color)}
                  title={d.category ? `Add ${d.name} · ${d.category}` : `Add ${d.name}`}
                  onClick={() => add(d)}
                >
                  <span className="tag-badge-name">{d.name}</span>
                </button>
              ))}
            </div>
          )}
          <label className="tag-field">
            <span>Category</span>
            <input
              className="input"
              list="tag-categories"
              value={existing ? existing.category : category}
              disabled={!!existing}
              placeholder="e.g. Status (optional)"
              onChange={(e) => setCategory(e.target.value)}
              spellCheck={false}
            />
            <datalist id="tag-categories">
              {tagCategories(defs).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <div className="tag-field">
            <span>Colour</span>
            <ColorSwatches value={existing ? existing.color : color} onChange={existing ? () => {} : setColor} />
          </div>
          <div className="tag-field">
            <span>Preview</span>
            <div className="tag-preview">
              <span className="tag-badge static" style={tagStyle(existing ? existing.color : color)}>
                <span className="tag-badge-name">{existing?.name ?? (name.trim() || "Tag name")}</span>
              </span>
            </div>
          </div>
        </div>
        <div className="picker-footer">
          <span>
            {existing
              ? `“${existing.name}” already exists — it will be added to this tab.`
              : "Enter adds it · Esc cancels"}
          </span>
          <button className="btn primary" disabled={!query} onClick={submit}>
            {existing ? "Add tag" : "Create tag"}
          </button>
        </div>
      </div>
    </div>
  );
}
