// The sidebar as a tree: custom groups (which can nest, also inside a folder group) and folder groups.
import type { Group, Tab } from "./types";
import { basename } from "./util";

/** Folder group key for a repo/folder; inside a custom group it's scoped as `<groupId>/auto:<root>`. */
export const folderKey = (root: string, groupId?: string) => (groupId ? `${groupId}/` : "") + "auto:" + root;
/**
 * Splits a node key: a group id, a folder group `auto:<root>`, or a folder inside a group `<groupId>/auto:<root>`.
 */
export function parseKey(key: string): { group: string | null; root: string | null } {
  const at = key.indexOf("auto:");
  if (at < 0) return { group: key, root: null };
  return { group: at ? key.slice(0, at - 1) : null, root: key === UNGROUPED ? null : key.slice(at + "auto:".length) };
}
/** The single top-level "Tabs" node when tabs aren't grouped by folder. */
export const UNGROUPED = "auto:all";
/** `Tab.groupId` for a tab kept out of custom groups. */
export const NO_GROUP = "none";

export interface Node {
  /** Group id, or a folder key (see {@link folderKey}). */
  key: string;
  name: string;
  kind: "group" | "folder";
  group: Group | null;
  /** The repo/folder a folder node stands for. */
  folder: string | null;
  /** Tabs directly in this node. */
  tabs: Tab[];
  /** Nested nodes, shown before the node's own tabs. */
  children: Node[];
  depth: number;
}

function inFolder(path: string, folder: string) {
  return path === folder || path.startsWith(folder.replace(/\/$/, "") + "/");
}

const rootOf = (tab: Tab) => tab.repoRoot ?? tab.cwd;

/**
 * Builds the sidebar tree.
 * - A tab belongs to its explicit group, else to the deepest group whose folders contain it (unless "none"),
 *   else to its folder group (`autoGroup`) or the single "Tabs" node.
 * - A group sits in its `parent`: a group, a folder group, or a folder inside a group. Missing parents and
 *   cycles put it at the top level.
 * - With `autoGroup`, a group's own tabs are split by folder when they (and groups placed in its folders) span
 *   2+ folders — unless the group is already inside a folder group.
 * - Siblings follow `order` (user drag order), then groups before folders, folders by name.
 */
export function buildTree(tabs: Tab[], groups: Group[], autoGroup = true, order: string[] = []): Node[] {
  const byId = new Map(groups.map((g) => [g.id, g]));

  /** Parent key that actually applies to `g`, or null for top level. */
  const parentOf = (g: Group): string | null => {
    const p = g.parent;
    if (!p) return null;
    const { group, root } = parseKey(p);
    if (!group) return autoGroup && root ? p : null;
    const seen = new Set([g.id]);
    for (let cur: string | null = group; cur;) {
      const parent = byId.get(cur);
      if (!parent || seen.has(cur)) return null;
      seen.add(cur);
      cur = parent.parent ? parseKey(parent.parent).group : null;
    }
    // Without folder grouping, a folder inside a group is just the group.
    return autoGroup || !root ? p : group;
  };
  /** Parent keys from `g` up to the top. */
  const chain = (g: Group): string[] => {
    const out: string[] = [];
    for (let p = parentOf(g); p;) {
      out.push(p);
      const { group } = parseKey(p);
      p = group ? parentOf(byId.get(group)!) : null;
    }
    return out;
  };
  const underFolder = (g: Group) => chain(g).some((p) => parseKey(p).root);

  const groupNodes = new Map<string, Node>();
  for (const g of groups) {
    groupNodes.set(g.id, {
      key: g.id,
      name: g.name,
      kind: "group",
      group: g,
      folder: null,
      tabs: [],
      children: [],
      depth: 0,
    });
  }
  const folderNode = (key: string, folder: string | null, tabs: Tab[] = []): Node => ({
    key,
    name: folder ? basename(folder) : autoGroup ? "Terminals" : "Tabs",
    kind: "folder",
    group: null,
    folder,
    tabs,
    children: [],
    depth: 0,
  });
  const folderNodes = new Map<string, Node>();
  const topFolder = (key: string): Node => {
    if (!folderNodes.has(key)) folderNodes.set(key, folderNode(key, parseKey(key).root));
    return folderNodes.get(key)!;
  };

  const deepestFirst = [...groups].sort((a, b) => chain(b).length - chain(a).length);
  for (const tab of tabs) {
    const explicit = tab.groupId && tab.groupId !== NO_GROUP ? groupNodes.get(tab.groupId) : undefined;
    const byFolder =
      tab.groupId === NO_GROUP || tab.loose
        ? undefined
        : deepestFirst.find((g) => g.folders.some((f) => inFolder(rootOf(tab), f) || inFolder(tab.cwd, f)));
    const owner = explicit ?? (byFolder && groupNodes.get(byFolder.id));
    if (owner) owner.tabs.push(tab);
    else topFolder(autoGroup && !tab.loose ? folderKey(rootOf(tab)) : UNGROUPED).tabs.push(tab);
  }

  // Split a group's tabs by folder when they (and groups placed in its folders) span 2+ folders.
  const scoped = new Map<string, Node>();
  if (autoGroup) {
    for (const g of groups) {
      if (underFolder(g)) continue;
      const node = groupNodes.get(g.id)!;
      const nestedRoots = groups
        .map(parentOf)
        .map((p) => (p ? parseKey(p) : null))
        .filter((k) => k?.group === g.id && k.root)
        .map((k) => k!.root!);
      const roots = Array.from(new Set([...node.tabs.map(rootOf), ...nestedRoots]));
      if (roots.length < 2) continue;
      for (const root of roots) {
        const sub = folderNode(
          folderKey(root, g.id),
          root,
          node.tabs.filter((t) => rootOf(t) === root),
        );
        scoped.set(sub.key, sub);
        node.children.push(sub);
      }
      node.tabs = [];
    }
  }

  const top: Node[] = [];
  for (const g of groups) {
    const node = groupNodes.get(g.id)!;
    const p = parentOf(g);
    const { group, root } = p ? parseKey(p) : { group: null, root: null };
    if (!p) top.push(node);
    else if (!group) topFolder(p).children.push(node);
    // A folder inside a group that isn't split (only one folder) is the group itself.
    else (root && scoped.get(p) ? scoped.get(p)! : groupNodes.get(group)!).children.push(node);
  }
  top.push(...folderNodes.values());

  const groupIndex = new Map(groups.map((g, i) => [g.id, i]));
  const sort = (nodes: Node[], depth: number): Node[] => {
    const defaults = [...nodes].sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === "group"
          ? -1
          : 1
        : a.kind === "group"
          ? groupIndex.get(a.key)! - groupIndex.get(b.key)!
          : a.name.localeCompare(b.name),
    );
    const rank = (n: Node, i: number) => {
      const at = order.indexOf(n.key);
      return at >= 0 ? at : order.length + i;
    };
    return defaults
      .map((n, i) => ({ n, r: rank(n, i) }))
      .sort((a, b) => a.r - b.r)
      .map(({ n }) => {
        n.depth = depth;
        n.children = sort(n.children, depth + 1);
        return n;
      });
  };
  return sort(top, 0);
}

/** Whether a node is collapsed: groups keep it themselves, folder nodes are listed in `collapsedFolders`. */
export function isCollapsed(node: Node, collapsedFolders: string[]): boolean {
  return node.group ? node.group.collapsed : collapsedFolders.includes(node.key);
}

/** Tabs in display order, skipping collapsed nodes. */
export function visibleTabs(nodes: Node[], collapsedFolders: string[]): Tab[] {
  return nodes.flatMap((n) =>
    isCollapsed(n, collapsedFolders) ? [] : [...visibleTabs(n.children, collapsedFolders), ...n.tabs],
  );
}

/** Every node, parents before children. */
export function flatten(nodes: Node[]): Node[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

/** Tabs under `node`, in display order (nested nodes first). */
export function subtreeTabs(node: Node): Tab[] {
  return [...node.children.flatMap(subtreeTabs), ...node.tabs];
}

/** Nodes from the top down to the one with `key`. */
export function pathTo(nodes: Node[], key: string): Node[] | null {
  for (const n of nodes) {
    if (n.key === key) return [n];
    const sub = pathTo(n.children, key);
    if (sub) return [n, ...sub];
  }
  return null;
}

/** Nodes from the top down to the one holding tab `tabId` directly. */
export function pathToTab(nodes: Node[], tabId: string): Node[] | null {
  for (const n of nodes) {
    if (n.tabs.some((t) => t.id === tabId)) return [n];
    const sub = pathToTab(n.children, tabId);
    if (sub) return [n, ...sub];
  }
  return null;
}

/** The custom group a tab dropped into the last node of `path` belongs to, or "none". */
export function ownerGroupId(path: Node[]): string {
  return [...path].reverse().find((n) => n.kind === "group")?.key ?? NO_GROUP;
}

/** Leaves out nodes in `hidden` and hidden tabs; folder nodes left empty disappear, groups stay. */
export function withoutHidden(nodes: Node[], hidden: string[]): Node[] {
  return nodes
    .filter((n) => !hidden.includes(n.key))
    .map((n) => ({ ...n, tabs: n.tabs.filter((t) => !t.hidden), children: withoutHidden(n.children, hidden) }))
    .filter((n) => n.kind === "group" || n.tabs.length > 0 || n.children.length > 0);
}

/** "Parent / Child" name of a group, for pickers. */
export function groupPath(group: Group, groups: Group[]): string {
  const names = [group.name];
  const seen = new Set([group.id]);
  for (let p = group.parent; p && !seen.has(p);) {
    seen.add(p);
    const { group: gid, root } = parseKey(p);
    if (root) names.unshift(basename(root));
    if (!gid) break;
    const parent = groups.find((g) => g.id === gid);
    if (!parent) break;
    names.unshift(parent.name);
    p = parent.parent;
  }
  return names.join(" / ");
}

export type MovePosition = "before" | "after" | "inside";

export interface MoveResult {
  groups: Group[];
  tabs: Tab[];
  sectionOrder: string[];
}

/**
 * Moves node `key` next to (`before`/`after`) or into (`inside`) node `target`. A group gets a new parent; a
 * folder node takes its tabs (and, at the top level, its nested groups) into the destination group, or out to
 * the top level. Returns null for moves that make no sense (into itself, folder into folder).
 */
export function moveNode(
  tree: Node[],
  state: { groups: Group[]; tabs: Tab[]; sectionOrder: string[] },
  key: string,
  target: string,
  position: MovePosition,
): MoveResult | null {
  const src = pathTo(tree, key);
  const dst = pathTo(tree, target);
  if (!src || !dst || dst.some((n) => n.key === key)) return null;
  const node = src[src.length - 1];

  // The node that will contain it: a group, a top-level folder, or null for the top level.
  const container = position === "inside" ? [...dst] : dst.slice(0, -1);
  // Groups can sit in a folder inside a group; a folder can't, so it goes to that group instead.
  if (node.kind === "folder") {
    while (container.length > 1 && container[container.length - 1].kind === "folder") container.pop();
  }
  const into = container[container.length - 1] ?? null;
  /** The group the node ends up in, or "none" at the top level / in a top-level folder. */
  const owner = ownerGroupId(container);
  // The "Tabs" node (no folder grouping) is the top level.
  const intoKey = into && into.key !== UNGROUPED ? into.key : null;

  if (node.kind === "folder" && into?.kind === "folder") return null;

  let { groups, tabs } = state;
  let resultKey = key;
  if (node.kind === "group") {
    groups = groups.map((g) => (g.id === key ? { ...g, parent: intoKey } : g));
  } else if (src.length > 1 || owner !== NO_GROUP) {
    // A folder changing place (not just reordered at the top level) takes its tabs along.
    const moved = new Set(node.tabs.map((t) => t.id));
    tabs = tabs.map((t) => (moved.has(t.id) ? { ...t, groupId: owner } : t));
    const inGroup = owner === NO_GROUP ? undefined : owner;
    if (node.folder) resultKey = folderKey(node.folder, inGroup);
    // Groups inside the folder go along, into the same folder at its new place.
    const nested = new Set(node.children.filter((c) => c.kind === "group").map((c) => c.key));
    const parent = node.folder ? resultKey : (inGroup ?? null);
    groups = groups.map((g) => (nested.has(g.id) ? { ...g, parent } : g));
  }

  const keys = flatten(tree)
    .map((n) => n.key)
    .filter((k) => k !== key && k !== resultKey);
  const at = keys.indexOf(target);
  if (position === "inside" || at < 0) keys.push(resultKey);
  else keys.splice(position === "before" ? at : at + 1, 0, resultKey);
  return { groups, tabs, sectionOrder: keys };
}
