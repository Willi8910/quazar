import { describe, expect, it } from "vitest";
import { applyTabs, changes, diffTabs, merged } from "./sync";
import type { useApp } from "./store";
import type { Tab } from "./types";

type State = ReturnType<typeof useApp.getState>;

const tab = (id: string, title = id) => ({ id, title }) as Tab;
// Shared values, so states differ only where a test says so.
const base = { me: "main", tabs: [], groups: [], live: {}, usage: {}, metrics: null };
const state = (patch: Partial<State>) => ({ ...base, ...patch }) as unknown as State;

describe("tab sync", () => {
  it("sends only the tabs that changed", () => {
    const a = tab("a");
    const before = [a, tab("b")];
    const after = [a, tab("b", "renamed")];
    expect(diffTabs(before, after)).toEqual({ upsert: [after[1]], remove: [], order: null });
    expect(diffTabs(before, before)).toBeNull();
  });

  it("keeps another window's change to a different tab", () => {
    // This window renamed "a" meanwhile; the other window changed "b".
    const here = [tab("a", "mine"), tab("b")];
    const out = applyTabs(here, { upsert: [tab("b", "theirs")], remove: [], order: null });
    expect(out.map((t) => t.title)).toEqual(["mine", "theirs"]);
  });

  it("adds, removes and reorders", () => {
    const here = [tab("a"), tab("b"), tab("c")];
    const out = applyTabs(here, { upsert: [tab("d")], remove: ["b"], order: ["d", "c", "a"] });
    expect(out.map((t) => t.id)).toEqual(["d", "c", "a"]);
  });

  it("keeps tabs the order doesn't know at the end", () => {
    const out = applyTabs([tab("a"), tab("x"), tab("b")], { upsert: [], remove: [], order: ["b", "a"] });
    expect(out.map((t) => t.id)).toEqual(["b", "a", "x"]);
  });
});

describe("state sync", () => {
  it("shares records entry by entry and leaves window-local state alone", () => {
    const prev = state({ live: { a: true }, activeId: "a" } as Partial<State>);
    const next = state({ live: { a: true, b: true }, activeId: "b" } as Partial<State>);
    const msg = changes(next, prev)!;
    expect(msg).toEqual({ records: { live: { b: true } } });

    const other = state({ live: { c: true }, activeId: "c" } as Partial<State>);
    expect(merged(other, { from: "w-1", ...msg })).toEqual({ live: { c: true, b: true } });
  });

  it("only the main window shares resource readings", () => {
    const metrics = { tabs: [], app: { cpu: 1, memory: 1 }, cores: 8, totalMemory: 1 };
    expect(changes(state({ metrics }), state({}))).toEqual({ values: { metrics } });
    expect(changes(state({ me: "w-1", metrics }), state({ me: "w-1" }))).toBeNull();
  });
});
