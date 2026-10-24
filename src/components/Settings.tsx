import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import * as actions from "../actions";
import { api } from "../api";
import { LAUNCH_OPTIONS, profileAgent } from "../launch";
import { key } from "../platform";
import { DEFAULT_RECENT_SKILLS } from "../skills";
import { useApp } from "../store";
import * as terms from "../terminals";
import { TAG_COLORS, tagCategories } from "../tags";
import type { Config, LaunchOption, Profile, TagDef } from "../types";
import { newId, tildify, untildify } from "../util";
import { ColorSwatches, deleteTag, setTags } from "./Tags";

const set = (patch: Partial<Config>) => {
  useApp.getState().setConfig(patch);
  actions.saveConfig();
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Changes the project folders and rescans them for repos. */
const setRoots = (patch: Partial<Pick<Config, "projectRoots" | "scanDepth">>) => {
  set(patch);
  void actions.rescanProjects();
};

function ProjectRoots({ roots }: { roots: string[] }) {
  const add = async () => {
    const picked = await open({
      directory: true,
      multiple: true,
      title: "Add project folders",
    });
    if (!picked) return;
    const known = new Set(roots.map(untildify));
    const added = ([] as string[]).concat(picked).filter((p) => !known.has(p));
    if (added.length) setRoots({ projectRoots: [...roots, ...added.map(tildify)] });
  };
  return (
    <div className="profile-rows">
      {roots.map((root) => (
        <div className="profile-row" key={root}>
          <span className="input mono folder" title={untildify(root)}>
            {root}
          </span>
          <button
            className="icon-btn"
            title="Remove folder"
            onClick={() => setRoots({ projectRoots: roots.filter((r) => r !== root) })}
          >
            ×
          </button>
        </div>
      ))}
      {roots.length === 0 && <span className="field-hint">No folders yet.</span>}
      <button className="link-btn" onClick={() => void add()}>
        ＋ Add folders…
      </button>
    </div>
  );
}

function PreLaunch({ commands }: { commands: string[] }) {
  const setAt = (i: number, value: string | null) =>
    set({
      preLaunch: value === null ? commands.filter((_, j) => j !== i) : commands.map((c, j) => (j === i ? value : c)),
    });
  return (
    <div className="profile-rows">
      {commands.map((command, i) => (
        <div className="profile-row" key={i}>
          <span className="step">{i + 1}</span>
          <input
            autoFocus={i === commands.length - 1 && !command}
            className="input mono"
            value={command}
            placeholder="e.g. usa"
            onChange={(e) => setAt(i, e.target.value)}
            spellCheck={false}
          />
          <button className="icon-btn" title="Remove command" onClick={() => setAt(i, null)}>
            ×
          </button>
        </div>
      ))}
      <button className="link-btn" onClick={() => set({ preLaunch: [...commands, ""] })}>
        ＋ Add command
      </button>
    </div>
  );
}

/** The flags a profile's launcher checkboxes add; empty fields use the agent's known flags. */
function ProfileOptions({ profile, onChange }: { profile: Profile; onChange: (patch: Partial<Profile>) => void }) {
  const agent = profileAgent(profile);
  const setFlag = (key: LaunchOption, value: string) => {
    const options = { ...profile.options, [key]: value };
    if (!value) delete options[key];
    onChange({ options });
  };
  return (
    <div className="profile-options">
      {LAUNCH_OPTIONS.map(({ key, label }) => (
        <label key={key} className="profile-option" title={`Flag added by the “${label}” checkbox`}>
          <span>{label}</span>
          <input
            className="input mono"
            value={profile.options?.[key] ?? ""}
            placeholder={agent?.options[key] ?? "none"}
            onChange={(e) => setFlag(key, e.target.value)}
            spellCheck={false}
          />
        </label>
      ))}
    </div>
  );
}

function Profiles({ profiles }: { profiles: Profile[] }) {
  const update = (id: string, patch: Partial<Profile>) =>
    set({
      profiles: profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  return (
    <div className="profile-rows">
      {profiles.map((p) => (
        <div className="profile" key={p.id}>
          <div className="profile-row">
            <input
              className="input name"
              value={p.name}
              placeholder="Name"
              onChange={(e) => update(p.id, { name: e.target.value })}
              spellCheck={false}
            />
            <input
              className="input mono"
              value={p.command}
              placeholder="Command (empty = plain shell)"
              onChange={(e) => update(p.id, { command: e.target.value })}
              spellCheck={false}
            />
            <button
              className="icon-btn"
              title="Remove profile"
              onClick={() => set({ profiles: profiles.filter((x) => x.id !== p.id) })}
            >
              ×
            </button>
          </div>
          {p.command.trim() && <ProfileOptions profile={p} onChange={(patch) => update(p.id, patch)} />}
        </div>
      ))}
      <button
        className="link-btn"
        onClick={() =>
          set({
            profiles: [...profiles, { id: newId("p"), name: "New profile", command: "" }],
          })
        }
      >
        ＋ Add profile
      </button>
    </div>
  );
}

/** On/off for each kind of agent notification, and a test to check macOS allows them. */
function NotificationSettings({ config }: { config: Config }) {
  const [test, setTest] = useState<"sent" | "blocked" | null>(null);
  const permission = useApp((s) => s.notifyPermission);
  const toggle = (key: "notifyDone" | "notifyWaiting") => set({ [key]: config[key] === false });
  return (
    <>
      <span className="field-hint">
        System notifications for agents in tabs you're not looking at (another tab, or another app in front).
      </span>
      {permission === "denied" && (
        <div className="settings-test">
          <span className="field-hint warn">Notifications are turned off for Quazar in macOS.</span>
          <button className="btn small" onClick={() => void api.openNotificationSettings()}>
            Open System Settings
          </button>
        </div>
      )}
      {permission === "not-determined" && (
        <div className="settings-test">
          <span className="field-hint">macOS hasn't asked yet whether Quazar may notify you.</span>
          <button className="btn small" onClick={() => void actions.checkNotifications(true)}>
            Allow notifications…
          </button>
        </div>
      )}
      {permission === "granted" && <span className="field-hint ok">✓ Allowed in macOS</span>}
      <button className="switch-row" onClick={() => toggle("notifyDone")}>
        <span>When an agent finishes</span>
        <span className={"switch" + (config.notifyDone !== false ? " on" : "")} />
      </button>
      <button className="switch-row" onClick={() => toggle("notifyWaiting")}>
        <span>When an agent needs your approval or input</span>
        <span className={"switch" + (config.notifyWaiting !== false ? " on" : "")} />
      </button>
      <div className="settings-test">
        <button
          className="btn small"
          onClick={() => void actions.testNotification().then((ok) => setTest(ok ? "sent" : "blocked"))}
        >
          Send a test notification
        </button>
        {test === "sent" && (
          <span className="field-hint">Sent — if nothing appeared, check Focus / Do Not Disturb.</span>
        )}
        {test === "blocked" && <span className="field-hint warn">macOS is blocking them — see above.</span>}
      </div>
    </>
  );
}

/** Every tag, in the user's order: rename, recategorise, recolour, delete, and drag to reorder. */
function Tags({ tags }: { tags: TagDef[] }) {
  const tabs = useApp((s) => s.tabs);
  const [colorOf, setColorOf] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const update = (id: string, patch: Partial<TagDef>) =>
    setTags(tags.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const uses = (id: string) => tabs.filter((t) => t.tags?.includes(id)).length;

  /** Where a drag at `y` would drop: the index of the first row whose middle is below it. */
  const dropIndex = (y: number) => {
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>(".tag-row") ?? []);
    const i = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });
    return i < 0 ? rows.length : i;
  };
  const onHandleDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id, to: tags.findIndex((t) => t.id === id) });
  };
  const onHandleMove = (e: React.PointerEvent) => drag && setDrag({ ...drag, to: dropIndex(e.clientY) });
  const onHandleUp = () => {
    if (!drag) return;
    const from = tags.findIndex((t) => t.id === drag.id);
    const to = drag.to > from ? drag.to - 1 : drag.to;
    setDrag(null);
    if (from < 0 || to === from) return;
    const next = tags.filter((t) => t.id !== drag.id);
    next.splice(to, 0, tags[from]);
    setTags(next);
  };

  return (
    <div className="profile-rows tag-rows" ref={list}>
      {tags.length === 0 && (
        <div className="field-hint">No tags yet. Add one here, or from a tab's tag button in the sidebar.</div>
      )}
      {tags.map((t, i) => {
        const n = uses(t.id);
        const dropCls = !drag
          ? ""
          : drag.to === i
            ? " drop-before"
            : drag.to === tags.length && i === tags.length - 1
              ? " drop-after"
              : "";
        return (
          <div className={"tag-row" + (drag?.id === t.id ? " dragging" : "") + dropCls} key={t.id}>
            <div className="profile-row">
              <span
                className="tag-handle"
                title="Drag to reorder"
                onPointerDown={(e) => onHandleDown(e, t.id)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
              >
                ⋮⋮
              </span>
              <button
                className="tag-color-btn"
                style={{ background: TAG_COLORS[t.color] }}
                title="Colour"
                onClick={() => setColorOf(colorOf === t.id ? null : t.id)}
              />
              <input
                className="input name"
                value={t.name}
                placeholder="Name"
                onChange={(e) => update(t.id, { name: e.target.value })}
                spellCheck={false}
              />
              <input
                className="input tag-category"
                list="settings-tag-categories"
                value={t.category}
                placeholder="Category"
                onChange={(e) => update(t.id, { category: e.target.value })}
                spellCheck={false}
              />
              <span className="tag-uses">{n ? `${n} tab${n === 1 ? "" : "s"}` : "unused"}</span>
              {confirm === t.id ? (
                <button
                  className="btn small danger"
                  onClick={() => {
                    setConfirm(null);
                    deleteTag(t.id);
                  }}
                  onBlur={() => setConfirm(null)}
                  autoFocus
                >
                  Delete
                </button>
              ) : (
                <button
                  className="icon-btn danger"
                  title={n ? `Delete — also removes it from ${n} tab${n === 1 ? "" : "s"}` : "Delete tag"}
                  onClick={() => (n ? setConfirm(t.id) : deleteTag(t.id))}
                >
                  ×
                </button>
              )}
            </div>
            {colorOf === t.id && (
              <div className="tag-row-colors">
                <ColorSwatches
                  value={t.color}
                  onChange={(color) => {
                    update(t.id, { color });
                    setColorOf(null);
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
      <datalist id="settings-tag-categories">
        {tagCategories(tags).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <button
        className="link-btn"
        onClick={() => {
          const id = newId("tag");
          setTags([...tags, { id, name: "New tag", category: "", color: "blue" }]);
          setColorOf(id);
        }}
      >
        ＋ Add tag
      </button>
    </div>
  );
}

const SECTIONS = ["Agents", "Tags", "Notifications", "Appearance", "Projects"] as const;
type Section = (typeof SECTIONS)[number];
/** Reopening Settings returns to the last section. */
let lastSection: Section = "Agents";

export function Settings({ onClose, initial }: { onClose: () => void; initial?: string }) {
  const config = useApp((s) => s.config)!;
  const [section, setSection] = useState<Section>(() =>
    SECTIONS.includes(initial as Section) ? (lastSection = initial as Section) : lastSection,
  );
  const show = (s: Section) => setSection((lastSection = s));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setFont = (patch: Partial<Pick<Config, "fontSize" | "fontFamily">>) => {
    set(patch);
    const { fontSize, fontFamily } = useApp.getState().config!;
    terms.setFont(fontSize, fontFamily);
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="picker settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          Settings
          <span className="settings-version" title="Quazar version and when this build was made">
            Quazar {actions.versionText()}
          </span>
        </div>
        <div className="settings-tabs" role="tablist">
          {SECTIONS.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={s === section}
              className={"settings-tab" + (s === section ? " active" : "")}
              onClick={() => show(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="settings-body">
          {section === "Agents" && (
            <>
              <Field
                label="Run before agents"
                hint="Run one by one in the tab's shell before every agent start and resume: “first && second && claude …”."
              >
                <PreLaunch commands={config.preLaunch} />
              </Field>
              <Field
                label="Profiles"
                hint={`Shown in the New agent launcher (${key("new-agent")}). Each agent's checkbox flags default to the agent's own (greyed); type a flag to override, e.g. for an agent Quazar doesn't know.`}
              >
                <Profiles profiles={config.profiles} />
              </Field>
              <button
                className="switch-row"
                onClick={() => set({ consoleButton: config.consoleButton === false })}
                title="A small button at the console's bottom right: hover it for your recent skills"
              >
                <span>Quick-actions button in the console</span>
                <span className={"switch" + (config.consoleButton !== false ? " on" : "")} />
              </button>
              {config.consoleButton !== false && (
                <Field
                  label="Skills in its menu"
                  hint="The ones you ran last (typed as /name), then your own skills, newest first."
                >
                  <input
                    className="input depth"
                    type="number"
                    min={1}
                    max={20}
                    value={config.recentSkills ?? DEFAULT_RECENT_SKILLS}
                    onChange={(e) => {
                      const recentSkills = Number(e.target.value);
                      if (recentSkills >= 1 && recentSkills <= 20) set({ recentSkills });
                    }}
                  />
                </Field>
              )}
              <button className="btn small" onClick={() => useApp.getState().openModal({ kind: "hooks" })}>
                Agent hooks…
              </button>
            </>
          )}

          {section === "Tags" && (
            <Field
              label="Tags"
              hint="Shown before a tab's name, in this order. Clicking a tag on a tab swaps it for another; tags of the same category are listed first."
            >
              <Tags tags={config.tags ?? []} />
            </Field>
          )}
          {section === "Notifications" && <NotificationSettings config={config} />}

          {section === "Appearance" && (
            <>
              <div className="field-row">
                <Field label="Sidebar side">
                  <select
                    className="input"
                    value={config.sidebarSide}
                    onChange={(e) => set({ sidebarSide: e.target.value as Config["sidebarSide"] })}
                  >
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </Field>
                <Field label="Terminal font size">
                  <input
                    className="input"
                    type="number"
                    min={9}
                    max={28}
                    value={config.fontSize}
                    onChange={(e) => {
                      const fontSize = Number(e.target.value);
                      if (fontSize >= 9 && fontSize <= 28) setFont({ fontSize });
                    }}
                  />
                </Field>
              </div>
              <Field label="Terminal font">
                <input
                  className="input mono"
                  value={config.fontFamily}
                  onChange={(e) => setFont({ fontFamily: e.target.value })}
                  spellCheck={false}
                />
              </Field>
              <button
                className="switch-row"
                onClick={() => set({ headerLabels: !(config.headerLabels ?? true) })}
                title="Off: the console header's buttons show only their icons (hover for what they do)"
              >
                <span>Show button labels in the console header</span>
                <span className={"switch" + ((config.headerLabels ?? true) ? " on" : "")} />
              </button>
              <button className="switch-row" onClick={actions.toggleAutoGroup}>
                <span>Group tabs by folder</span>
                <span className={"switch" + (config.autoGroup ? " on" : "")} />
              </button>
            </>
          )}

          {section === "Projects" && (
            <>
              <Field label="Project folders" hint="Searched for git repos to offer in the folder picker.">
                <ProjectRoots roots={config.projectRoots} />
              </Field>
              <Field label="Search depth" hint="How many folder levels below each project folder to look for repos.">
                <input
                  className="input depth"
                  type="number"
                  min={1}
                  max={6}
                  value={config.scanDepth}
                  onChange={(e) => {
                    const scanDepth = Number(e.target.value);
                    if (scanDepth >= 1 && scanDepth <= 6) setRoots({ scanDepth });
                  }}
                />
              </Field>
            </>
          )}
        </div>
        <div className="picker-footer">
          <button className="link-btn" onClick={() => void actions.openConfigFile()}>
            Open config.json
          </button>
          <button className="btn small" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
