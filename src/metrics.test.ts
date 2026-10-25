import { describe, expect, it } from "vitest";
import { bytes, cpuShare, isIdle, load, percent, TAB_SCALE, total } from "./metrics";
import type { Metrics } from "./types";

const GB = 1024 ** 3;
const m: Metrics = {
  cores: 10,
  totalMemory: 16 * GB,
  app: { cpu: 5, memory: GB / 2 },
  tabs: [
    { tabId: "a", cpu: 100, memory: GB, processes: 3, top: "claude" },
    { tabId: "b", cpu: 0, memory: GB / 4, processes: 1, top: null },
  ],
};

describe("metrics", () => {
  it("totals the tabs and the app as shares of the machine", () => {
    const t = total(m);
    expect(t).toEqual({ cpu: 105, memory: 1.75 * GB });
    expect(cpuShare(t, m)).toBeCloseTo(10.5);
  });

  it("grades load for the total and, more strictly, for one tab", () => {
    expect(load({ cpu: 100, memory: GB }, m)).toBe("ok");
    expect(load({ cpu: 300, memory: GB }, m)).toBe("warn");
    expect(load({ cpu: 100, memory: 5 * GB }, m)).toBe("high");
    expect(load({ cpu: 300, memory: GB }, m, TAB_SCALE)).toBe("high");
  });

  it("counts a tab as idle only when it's small and quiet", () => {
    const MB = 1024 ** 2;
    expect(isIdle({ cpu: 0, memory: 2 * MB }, m)).toBe(true);
    expect(isIdle({ cpu: 0, memory: 6 * MB }, m)).toBe(false);
    expect(isIdle({ cpu: 20, memory: 2 * MB }, m)).toBe(false);
  });

  it("formats values", () => {
    expect([percent(3.14), percent(42.6), bytes(1.5 * GB), bytes(300 * 1024 ** 2)]).toEqual([
      "3.1%",
      "43%",
      "1.5 GB",
      "300 MB",
    ]);
  });
});
