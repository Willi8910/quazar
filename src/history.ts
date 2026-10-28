// Back/forward through the tabs you've opened, like an editor's navigation history. Kept per window
// and not saved: it's a list of tab ids, updated only when the active tab changes.

const LIMIT = 50;

export interface History {
  back: string[];
  forward: string[];
}

export const emptyHistory = (): History => ({ back: [], forward: [] });

/** Leaving `from` for another tab (not by back/forward): `from` goes on the back list, forward is cleared. */
export function visit(h: History, from: string): History {
  if (h.back[h.back.length - 1] === from) return { back: h.back, forward: [] };
  return { back: [...h.back, from].slice(-LIMIT), forward: [] };
}

/**
 * One step back or forward from `current`, skipping tabs that are gone (closed, moved to another window,
 * hidden). Null when there's nowhere to go.
 */
export function step(
  h: History,
  current: string | null,
  dir: "back" | "forward",
  usable: (id: string) => boolean,
): { history: History; target: string } | null {
  const from = [...(dir === "back" ? h.back : h.forward)];
  const to = [...(dir === "back" ? h.forward : h.back)];
  while (from.length) {
    const id = from.pop()!;
    if (id === current || !usable(id)) continue;
    if (current) to.push(current);
    return { history: dir === "back" ? { back: from, forward: to } : { back: to, forward: from }, target: id };
  }
  return null;
}
