import { describe, expect, it } from "vitest";
import { emptyHistory, step, visit } from "./history";

const all = () => true;

describe("tab history", () => {
  it("goes back and forward through visited tabs", () => {
    // a → b → c
    let h = visit(visit(emptyHistory(), "a"), "b");
    const back = step(h, "c", "back", all)!;
    expect(back.target).toBe("b");
    h = back.history;
    const back2 = step(h, "b", "back", all)!;
    expect(back2.target).toBe("a");
    const fwd = step(back2.history, "a", "forward", all)!;
    expect(fwd.target).toBe("b");
    expect(step(fwd.history, "b", "forward", all)!.target).toBe("c");
  });

  it("clears forward when a tab is opened another way", () => {
    const h = step(visit(emptyHistory(), "a"), "b", "back", all)!.history;
    expect(h.forward).toEqual(["b"]);
    expect(visit(h, "a").forward).toEqual([]);
  });

  it("skips tabs that are gone and stops at the ends", () => {
    const h = visit(visit(emptyHistory(), "a"), "closed");
    expect(step(h, "c", "back", (id) => id !== "closed")!.target).toBe("a");
    expect(step(emptyHistory(), "a", "back", all)).toBeNull();
    expect(step(h, "c", "forward", all)).toBeNull();
  });

  it("doesn't repeat a tab and keeps at most 50", () => {
    expect(visit(visit(emptyHistory(), "a"), "a").back).toEqual(["a"]);
    let h = emptyHistory();
    for (let i = 0; i < 60; i++) h = visit(h, `t${i}`);
    expect(h.back).toHaveLength(50);
    expect(h.back[0]).toBe("t10");
  });
});
