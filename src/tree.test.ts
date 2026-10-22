import { describe, expect, it } from "vitest";
import { buildTree, flatten, moveNode, Node, NO_GROUP, pathToTab, subtreeTabs, withoutHidden } from "./tree";
import type { Group, Tab } from "./types";

const tab = (id: string, cwd: string, extra: Partial<Tab> = {}): Tab =>
  ({ id, cwd, repoRoot: cwd, title: id, groupId: null, ...extra }) as Tab;
const group = (id: string, extra: Partial<Group> = {}): Group => ({
  id,
  name: id.toUpperCase(),
  folders: [],
  collapsed: false,
  ...extra,
});

/** Compact picture of a tree: "key[tab,tab](child,child)". */
const shape = (nodes: Node[]): string[] =>
  nodes.map((n) => {
    const tabs = n.tabs.length ? `[${n.tabs.map((t) => t.id).join(",")}]` : "";
    const kids = n.children.length ? `(${shape(n.children).join(" ")})` : "";
    return n.key + tabs + kids;
  });

describe("buildTree", () => {
  it("puts ungrouped tabs in folder groups and keeps empty custom groups", () => {
    const tree = buildTree([tab("a", "/r/api"), tab("b", "/r/web"), tab("c", "/r/api")], [group("g1")]);
    expect(shape(tree)).toEqual(["g1", "auto:/r/api[a,c]", "auto:/r/web[b]"]);
  });

  it("nests groups in groups and in folder groups", () => {
    const groups = [group("g1"), group("g2", { parent: "g1" }), group("g3", { parent: "auto:/r/api" })];
    const tabs = [tab("a", "/r/api", { groupId: "g2" }), tab("b", "/r/api", { groupId: "g3" }), tab("c", "/r/api")];
    expect(shape(buildTree(tabs, groups))).toEqual(["g1(g2[a])", "auto:/r/api[c](g3[b])"]);
  });

  it("splits a group's tabs by folder only when they span 2+ folders", () => {
    const tabs = [tab("a", "/r/api", { groupId: "g1" }), tab("b", "/r/web", { groupId: "g1" })];
    expect(shape(buildTree(tabs, [group("g1")]))).toEqual(["g1(g1/auto:/r/api[a] g1/auto:/r/web[b])"]);
    expect(shape(buildTree(tabs.slice(0, 1), [group("g1")]))).toEqual(["g1[a]"]);
  });

  it("doesn't split by folder under a folder group, or with folder grouping off", () => {
    const groups = [group("g1", { parent: "auto:/r/api" })];
    const tabs = [tab("a", "/r/api", { groupId: "g1" }), tab("b", "/r/web", { groupId: "g1" })];
    expect(shape(buildTree(tabs, groups))).toEqual(["auto:/r/api(g1[a,b])"]);
    expect(shape(buildTree([...tabs, tab("c", "/x")], groups, false))).toEqual(["g1[a,b]", "auto:all[c]"]);
  });

  it("puts a group inside a folder of a group, which counts as a folder for splitting", () => {
    const groups = [group("gh"), group("g2", { parent: "gh/auto:/r/api" })];
    const tabs = [tab("a", "/r/api", { groupId: "gh" }), tab("b", "/r/web", { groupId: "gh" })];
    expect(shape(buildTree(tabs, groups))).toEqual(["gh(gh/auto:/r/api[a](g2) gh/auto:/r/web[b])"]);
    // A group placed in a folder makes that folder show even without tabs from it.
    const one = [tab("b", "/r/web", { groupId: "gh" })];
    expect(shape(buildTree(one, groups))).toEqual(["gh(gh/auto:/r/api(g2) gh/auto:/r/web[b])"]);
    // Without folder grouping it sits in the group itself.
    expect(shape(buildTree(tabs, groups, false))).toEqual(["gh[a,b](g2)"]);
  });

  it("matches folder rules to the deepest group and honours 'none'", () => {
    const groups = [group("g1", { folders: ["/r"] }), group("g2", { parent: "g1", folders: ["/r/api"] })];
    const tabs = [tab("a", "/r/api"), tab("b", "/r/web"), tab("c", "/r/api", { groupId: NO_GROUP })];
    expect(shape(buildTree(tabs, groups))).toEqual(["g1[b](g2[a])", "auto:/r/api[c]"]);
  });

  it("lists quick terminals under Terminals, ignoring folder rules, unless put in a group", () => {
    const groups = [group("g1", { folders: ["/home"] })];
    const tabs = [tab("a", "/home", { loose: true }), tab("b", "/home", { loose: true, groupId: "g1" })];
    const tree = buildTree([...tabs, tab("c", "/r/api")], groups);
    expect(shape(tree)).toEqual(["g1[b]", "auto:/r/api[c]", "auto:all[a]"]);
    expect(tree.find((n) => n.key === "auto:all")!.name).toBe("Terminals");
  });

  it("treats missing parents and cycles as top level", () => {
    const groups = [group("g1", { parent: "g2" }), group("g2", { parent: "g1" }), group("g3", { parent: "nope" })];
    expect(shape(buildTree([], groups))).toEqual(["g1", "g2", "g3"]);
  });

  it("follows the saved order among siblings", () => {
    const tree = buildTree([tab("a", "/r/api"), tab("b", "/r/web")], [group("g1")], true, ["auto:/r/web", "g1"]);
    expect(shape(tree)).toEqual(["auto:/r/web[b]", "g1", "auto:/r/api[a]"]);
  });
});

describe("tree helpers", () => {
  const groups = [group("g1"), group("g2", { parent: "g1" })];
  const tabs = [tab("a", "/r/api", { groupId: "g1" }), tab("b", "/r/api", { groupId: "g2", hidden: true })];
  const tree = buildTree(tabs, groups);

  it("lists subtree tabs with nested nodes first and finds a tab's path", () => {
    expect(subtreeTabs(tree[0]).map((t) => t.id)).toEqual(["b", "a"]);
    expect(pathToTab(tree, "b")!.map((n) => n.key)).toEqual(["g1", "g2"]);
  });

  it("drops hidden nodes and tabs but keeps groups", () => {
    expect(shape(withoutHidden(tree, []))).toEqual(["g1[a](g2)"]);
    expect(shape(withoutHidden(tree, ["g2"]))).toEqual(["g1[a]"]);
    expect(shape(withoutHidden(buildTree([tab("c", "/x", { hidden: true })], []), []))).toEqual([]);
  });
});

describe("moveNode", () => {
  const groups = [group("g1"), group("g2")];
  const tabs = [tab("a", "/r/api"), tab("b", "/r/web", { groupId: "g2" })];
  const state = { groups, tabs, sectionOrder: [] };
  const tree = buildTree(tabs, groups);
  const rebuilt = (r: ReturnType<typeof moveNode>) => shape(buildTree(r!.tabs, r!.groups, true, r!.sectionOrder));

  it("nests a group inside another and reorders siblings", () => {
    expect(rebuilt(moveNode(tree, state, "g2", "g1", "inside"))).toEqual(["g1(g2[b])", "auto:/r/api[a]"]);
    expect(rebuilt(moveNode(tree, state, "g2", "g1", "before"))).toEqual(["g2[b]", "g1", "auto:/r/api[a]"]);
  });

  it("nests a group inside a folder group", () => {
    expect(rebuilt(moveNode(tree, state, "g1", "auto:/r/api", "inside"))).toEqual(["g2[b]", "auto:/r/api[a](g1)"]);
  });

  it("moves a folder group's tabs into a group and back out", () => {
    const into = moveNode(tree, state, "auto:/r/api", "g1", "inside")!;
    expect(rebuilt(into)).toEqual(["g1[a]", "g2[b]"]);
    const intoTree = buildTree(into.tabs, into.groups, true, into.sectionOrder);
    // g1 only has one folder, so it isn't split; drag the group's tab back out via a fresh folder move.
    const g2 = moveNode(intoTree, into, "g1", "g2", "inside")!;
    expect(rebuilt(g2)).toEqual(["g2[b](g1[a])"]);
  });

  it("moves a group into a folder inside a group", () => {
    const g = [group("gh"), group("g2")];
    const t = [tab("a", "/r/api", { groupId: "gh" }), tab("b", "/r/web", { groupId: "gh" })];
    const r = moveNode(buildTree(t, g), { groups: g, tabs: t, sectionOrder: [] }, "g2", "gh/auto:/r/api", "inside")!;
    expect(r.groups.find((x) => x.id === "g2")!.parent).toBe("gh/auto:/r/api");
    expect(rebuilt(r)).toEqual(["gh(gh/auto:/r/api[a](g2) gh/auto:/r/web[b])"]);
  });

  it("refuses moving into itself and folder into folder", () => {
    const nested = buildTree(tabs, [group("g1"), group("g2", { parent: "g1" })]);
    expect(moveNode(nested, state, "g1", "g2", "inside")).toBeNull();
    expect(moveNode(tree, state, "auto:/r/api", "auto:/r/web", "inside")).toBeNull();
  });

  it("only reorders when a top-level folder moves among top-level nodes", () => {
    const r = moveNode(tree, state, "auto:/r/api", "g1", "before")!;
    expect(r.tabs).toBe(tabs);
    expect(flatten(buildTree(r.tabs, r.groups, true, r.sectionOrder))[0].key).toBe("auto:/r/api");
  });
});
