// A unified diff (`git diff`) turned into rows for the unified and side-by-side (split) views.

export type LineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: LineKind;
  /** Line number in the old file (context and deleted lines). */
  old: number | null;
  /** Line number in the new file (context and added lines). */
  new: number | null;
  text: string;
}

export type UnifiedRow = { hunk: string } | DiffLine;

/** One side of a split row; null where that side has no line. */
export interface Side {
  kind: LineKind;
  no: number;
  text: string;
}
export type SplitRow = { hunk: string } | { left: Side | null; right: Side | null };

/** The lines of each hunk, numbered; the file header before the first hunk is left out. */
export function parseDiff(text: string): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of text.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      rows.push({ hunk: line });
    } else if (!inHunk || line.startsWith("\\")) {
      // File header, or "\ No newline at end of file".
    } else if (line.startsWith("+")) rows.push({ kind: "add", old: null, new: newNo++, text: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ kind: "del", old: oldNo++, new: null, text: line.slice(1) });
    else if (line.startsWith(" ")) rows.push({ kind: "context", old: oldNo++, new: newNo++, text: line.slice(1) });
  }
  return rows;
}

/** Side by side: context on both sides; each run of deletions paired line by line with the additions after it. */
export function splitRows(rows: UnifiedRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let dels: Side[] = [];
  let adds: Side[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = [];
    adds = [];
  };
  for (const row of rows) {
    if ("hunk" in row) {
      flush();
      out.push(row);
    } else if (row.kind === "del") {
      // Deletions after additions start a new pair block.
      if (adds.length) flush();
      dels.push({ kind: "del", no: row.old!, text: row.text });
    } else if (row.kind === "add") adds.push({ kind: "add", no: row.new!, text: row.text });
    else {
      flush();
      out.push({
        left: { kind: "context", no: row.old!, text: row.text },
        right: { kind: "context", no: row.new!, text: row.text },
      });
    }
  }
  flush();
  return out;
}
