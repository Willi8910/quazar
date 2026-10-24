import { isWindows } from "./platform";

let home = "";
export function setHome(dir: string) {
  home = dir.replace(/\/$/, "");
}

export function tildify(path: string): string {
  if (home && (path === home || path.startsWith(home + "/"))) return "~" + path.slice(home.length);
  return path;
}

export function untildify(path: string): string {
  if (path === "~" || path.startsWith("~/")) return home + path.slice(1);
  return path;
}

export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed || "/";
}

export function shellQuote(word: string, windows = isWindows): string {
  if (/^[\w@%+=:,./-]+$/.test(word)) return word;
  // PowerShell escapes a quote inside single quotes by doubling it.
  return windows ? `'${word.replace(/'/g, "''")}'` : `'${word.replace(/'/g, `'\\''`)}'`;
}

export function newId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Subsequence fuzzy match; higher is better, null when `query` doesn't match. */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const nameStart = t.lastIndexOf("/") + 1;
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    score += found === prev + 1 ? 3 : 1;
    if (found >= nameStart) score += 2;
    if (found === 0 || "/-_. ".includes(t[found - 1])) score += 2;
    prev = found;
    ti = found + 1;
  }
  return score - t.length * 0.01;
}

/** One-line digest of an agent reply for the sidebar. */
export function digest(text: string | null | undefined, max = 160): string {
  if (!text) return "";
  const lines = text.split("\n").filter((l) => l.trim());
  const clean = (l: string) =>
    l
      .replace(/^[#>*\-\s]+/, "")
      .replace(/[*`_]/g, "")
      .trim();
  const prose = lines.find((l) => !/^\s*#/.test(l) && clean(l));
  const line = clean(prose ?? lines[0] ?? "");
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function describeTool(name: string, input: any): string {
  const arg =
    input?.file_path ?? input?.path ?? input?.command ?? input?.pattern ?? input?.url ?? input?.description ?? "";
  const short = typeof arg === "string" ? (arg.includes("/") && !arg.includes(" ") ? basename(arg) : arg) : "";
  const text = short ? `${name} ${short}` : name;
  return text.length > 80 ? text.slice(0, 79) + "…" : text;
}

/** "just now", "5 minutes ago", "1 week ago", "3 months ago" … */
export function timeAgoLong(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  const units: [number, string][] = [
    [365 * 86400, "year"],
    [30 * 86400, "month"],
    [7 * 86400, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    const n = Math.floor(s / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
