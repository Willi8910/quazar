// Keeps the windows' stores in step. Each window broadcasts its own changes; tabs go one by one so that
// two windows changing different tabs at once don't undo each other. What a window shows (active tab,
// dialogs, focus) stays its own.
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { persisted, useApp } from "./store";
import type { Config, Metrics, PersistedState, Tab } from "./types";

type State = ReturnType<typeof useApp.getState>;

/** Shared as whole values. */
const VALUES = [
  "groups",
  "collapsedAuto",
  "hiddenSections",
  "sectionOrder",
  "sessionLog",
  "config",
  "windows",
  "metrics",
] as const;
/** Shared entry by entry. */
const RECORDS = ["live", "usage", "skillUsage", "showing"] as const;

export interface TabsDelta {
  upsert: Tab[];
  remove: string[];
  /** Tab ids in order, when the order changed. */
  order: string[] | null;
}

export interface SyncMessage {
  from: string;
  tabs?: TabsDelta;
  values?: Partial<Pick<State, (typeof VALUES)[number]>>;
  records?: Partial<Pick<State, (typeof RECORDS)[number]>>;
}

/** What changed between two tab lists, or null when nothing did. */
export function diffTabs(prev: Tab[], next: Tab[]): TabsDelta | null {
  const before = new Map(prev.map((t) => [t.id, t]));
  const ids = new Set(next.map((t) => t.id));
  const upsert = next.filter((t) => before.get(t.id) !== t);
  const remove = prev.filter((t) => !ids.has(t.id)).map((t) => t.id);
  const sameOrder = prev.length === next.length && prev.every((t, i) => t.id === next[i].id);
  if (!upsert.length && !remove.length && sameOrder) return null;
  return { upsert, remove, order: sameOrder ? null : next.map((t) => t.id) };
}

/** Applies another window's tab changes. Tabs it didn't know about keep their place at the end. */
export function applyTabs(tabs: Tab[], delta: TabsDelta): Tab[] {
  const removed = new Set(delta.remove);
  const updated = new Map(delta.upsert.map((t) => [t.id, t]));
  const out = tabs.filter((t) => !removed.has(t.id)).map((t) => updated.get(t.id) ?? t);
  const known = new Set(out.map((t) => t.id));
  out.push(...delta.upsert.filter((t) => !known.has(t.id) && !removed.has(t.id)));
  if (!delta.order) return out;
  const rank = new Map(delta.order.map((id, i) => [id, i]));
  const at = (t: Tab) => rank.get(t.id) ?? delta.order!.length;
  return out
    .map((t, i) => ({ t, i }))
    .sort((a, b) => at(a.t) - at(b.t) || a.i - b.i)
    .map(({ t }) => t);
}

/** The changes from `prev` to `s` worth telling the other windows about. */
export function changes(s: State, prev: State): Omit<SyncMessage, "from"> | null {
  const msg: Omit<SyncMessage, "from"> = {};
  const tabs = s.tabs === prev.tabs ? null : diffTabs(prev.tabs, s.tabs);
  if (tabs) msg.tabs = tabs;
  for (const key of VALUES) {
    // Only the main window measures resource use.
    if (key === "metrics" && s.me !== "main") continue;
    if (s[key] !== prev[key]) (msg.values ??= {})[key] = s[key] as never;
  }
  for (const key of RECORDS) {
    if (s[key] === prev[key]) continue;
    const changed = Object.entries(s[key]).filter(([k, v]) => (prev[key] as Record<string, unknown>)[k] !== v);
    if (changed.length) (msg.records ??= {})[key] = Object.fromEntries(changed) as never;
  }
  return msg.tabs || msg.values || msg.records ? msg : null;
}

/** Another window's changes applied to this window's state. */
export function merged(s: State, msg: SyncMessage): Partial<State> {
  const patch: Partial<State> = { ...msg.values };
  if (msg.tabs) patch.tabs = applyTabs(s.tabs, msg.tabs);
  for (const key of RECORDS) if (msg.records?.[key]) patch[key] = { ...s[key], ...msg.records[key] } as never;
  return patch;
}

/** What a newly opened window starts from: the main window's current state. */
interface Snapshot {
  state: PersistedState;
  config: Config;
  live: Record<string, boolean>;
  metrics: Metrics | null;
  showing: Record<string, string | null>;
}

let applying = false;

/**
 * Listens for an event sent to this window only. (A plain `listen` also hears events sent to the
 * other windows.)
 */
export function listenHere<T>(event: string, handler: (payload: T) => void) {
  return listen<T>(event, (e) => handler(e.payload), { target: useApp.getState().me });
}

/** Starts sharing this window's changes and taking the others'. `onRemote` runs after each remote change. */
export async function startSync(onRemote: () => void) {
  const me = useApp.getState().me;
  // Tell the others which tab this window shows.
  useApp.setState({ showing: { ...useApp.getState().showing, [me]: useApp.getState().activeId } });
  useApp.subscribe((s, prev) => {
    if (s.activeId !== prev.activeId) useApp.setState({ showing: { ...s.showing, [me]: s.activeId } });
  });
  useApp.subscribe((s, prev) => {
    if (applying) return;
    const msg = changes(s, prev);
    if (msg) void emit("sync", { from: me, ...msg });
  });
  await listen<SyncMessage>("sync", (e) => {
    if (e.payload.from === me) return;
    applying = true;
    try {
      useApp.setState(merged(useApp.getState(), e.payload));
    } finally {
      applying = false;
    }
    onRemote();
  });
  if (me === "main")
    await listenHere<string>("sync-request", (label) => {
      const { config, live, metrics, showing } = useApp.getState();
      const snapshot: Snapshot = { state: persisted(), config: config!, live, metrics, showing };
      void emitTo(label, "sync-snapshot", snapshot);
    });
}

/** Asks the main window for its state (for a window other than the main one). */
export async function requestSnapshot(): Promise<Snapshot> {
  const me = useApp.getState().me;
  return new Promise((resolve) => {
    let retry: number | undefined;
    void listenHere<Snapshot>("sync-snapshot", (snapshot) => {
      window.clearInterval(retry);
      resolve(snapshot);
    }).then(() => {
      const ask = () => void emitTo("main", "sync-request", me);
      ask();
      // The main window may still be starting up.
      retry = window.setInterval(ask, 1000);
    });
  });
}
