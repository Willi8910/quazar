// Turning the backend's process readings into what the sidebar shows: shares of the whole
// machine, readable sizes and a load level.
import type { Metrics, ResourceUse } from "./types";

export type Load = "ok" | "warn" | "high";

/** CPU as a share of the whole machine (all cores), in percent. */
export const cpuShare = (use: ResourceUse, m: Metrics) => use.cpu / Math.max(1, m.cores);

/** Memory as a share of physical memory, in percent. */
export const memoryShare = (use: ResourceUse, m: Metrics) => (m.totalMemory ? (use.memory / m.totalMemory) * 100 : 0);

/** Everything Quazar runs: all tabs plus the app itself. */
export function total(m: Metrics): ResourceUse {
  return m.tabs.reduce((sum, t) => ({ cpu: sum.cpu + t.cpu, memory: sum.memory + t.memory }), { ...m.app });
}

/**
 * How heavy `use` is. The overall total turns amber at a quarter of the CPU or 15% of memory
 * and red at half the CPU or 30% of memory; one tab at half of those.
 */
export function load(use: ResourceUse, m: Metrics, scale = 1): Load {
  const cpu = cpuShare(use, m) / scale;
  const mem = memoryShare(use, m) / scale;
  if (cpu >= 50 || mem >= 30) return "high";
  if (cpu >= 25 || mem >= 15) return "warn";
  return "ok";
}

export const TAB_SCALE = 0.5;

export function percent(value: number): string {
  return value < 10 ? `${value.toFixed(1)}%` : `${Math.round(value)}%`;
}

export function bytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(value / 1024 ** 2)} MB`;
}
