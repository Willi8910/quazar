import { useEffect, useMemo, useRef, useState } from "react";
import * as actions from "../actions";
import { api } from "../api";
import { parseDiff, Side, splitRows, UnifiedRow } from "../diff";
import { commentKey, ReviewComment, reviewPrompt } from "../review";
import { useApp } from "../store";
import * as terms from "../terminals";
import type { FileChange } from "../types";
import { basename, newId, tildify } from "../util";

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Where the dialog was last moved/resized to, kept while the app runs. */
let lastFrame: Frame | null = null;
const MIN_W = 520;
const MIN_H = 300;
/**
 * The top of the window belongs to macOS (the title bar with the traffic lights) and swallows clicks,
 * so the dialog's title bar stays below it.
 */
const TOP = 56;

function initialFrame(): Frame {
  const w = Math.min(1600, window.innerWidth * 0.96);
  const h = window.innerHeight - TOP - 24;
  return { x: (window.innerWidth - w) / 2, y: TOP, w, h };
}

/** Keeps the title bar reachable and the size within the window. */
function clamp(f: Frame): Frame {
  const w = Math.min(Math.max(f.w, MIN_W), window.innerWidth);
  const h = Math.min(Math.max(f.h, MIN_H), window.innerHeight - TOP);
  return {
    w,
    h,
    x: Math.min(Math.max(f.x, 80 - w), window.innerWidth - 80),
    y: Math.min(Math.max(f.y, TOP), window.innerHeight - 40),
  };
}

type Edge = "move" | "e" | "w" | "s" | "se" | "sw";

/** A line to comment on. */
type LineRef = Pick<ReviewComment, "side" | "line" | "code">;

/** Comments not sent yet, per tab: closing the dialog keeps them. */
const unsent = new Map<string, ReviewComment[]>();

/** What the diff rows need for commenting. */
interface Review {
  /** Click on a line: comment on it. */
  pick: (ref: LineRef) => void;
  /** Comments (and the open comment box) under a line. */
  thread: (ref: LineRef) => React.ReactNode;
}

/** A tab's uncommitted changes: the files on the left, the picked file's diff on the right. */
export function Changes({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const tab = useApp((s) => s.tabs.find((t) => t.id === tabId));
  const view = useApp((s) => s.config!.diffView ?? "unified");
  const path = tab ? actions.changesPath(tab) : null;
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [diff, setDiff] = useState<string | null>(null);
  const [frame, setFrame] = useState<Frame>(() => clamp(lastFrame ?? initialFrame()));
  const [comments, setCommentsState] = useState<ReviewComment[]>(() => unsent.get(tabId) ?? []);
  const [draft, setDraft] = useState<(LineRef & { file: string; text: string }) | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const setComments = (next: ReviewComment[]) => {
    unsent.set(tabId, next);
    setCommentsState(next);
  };

  const load = () => {
    if (!path) return;
    api.gitChanges(path).then(
      (list) => {
        setFiles(list);
        setIndex((i) => Math.min(i, Math.max(list.length - 1, 0)));
      },
      (e) => setError(String(e)),
    );
    void actions.refreshChanges(tabId, true);
  };
  useEffect(load, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const file = files?.[index];
  useEffect(() => {
    setDiff(null);
    if (!path || !file) return;
    let current = true;
    api.gitFileDiff(path, file.path, file.status === "?").then(
      (text) => current && setDiff(text),
      (e) => current && setDiff(String(e)),
    );
    listRef.current?.querySelector(".change.active")?.scrollIntoView({ block: "nearest" });
    return () => {
      current = false;
    };
  }, [path, file?.path, file?.added, file?.removed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing a comment: its own keys.
      if ((e.target as HTMLElement).closest?.("textarea")) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, (files?.length ?? 1) - 1));
      else if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files, onClose]);

  /** Drags the title bar (move) or an edge (resize). */
  const drag = (edge: Edge) => (e: React.PointerEvent) => {
    if (e.button !== 0 || (edge === "move" && (e.target as HTMLElement).closest("button"))) return;
    e.preventDefault();
    const start = { px: e.clientX, py: e.clientY, ...frame };
    const onMove = (m: PointerEvent) => {
      const dx = m.clientX - start.px;
      const dy = m.clientY - start.py;
      const next = { x: start.x, y: start.y, w: start.w, h: start.h };
      if (edge === "move") Object.assign(next, { x: start.x + dx, y: start.y + dy });
      if (edge === "e" || edge === "se") next.w = start.w + dx;
      // The left edge moves; the right one stays put.
      if (edge === "w" || edge === "sw") {
        next.w = Math.max(start.w - dx, MIN_W);
        next.x = start.x + start.w - next.w;
      }
      if (edge === "s" || edge === "se" || edge === "sw") next.h = start.h + dy;
      setFrame((lastFrame = clamp(next)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("dragging-frame");
    };
    document.body.classList.add("dragging-frame");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const setView = (diffView: "unified" | "split") => {
    useApp.getState().setConfig({ diffView });
    actions.saveConfig();
  };

  const addDraft = () => {
    if (!draft?.text.trim()) return setDraft(null);
    const { file, side, line, code, text } = draft;
    setComments([
      ...comments.filter((c) => commentKey(c) !== commentKey(draft)),
      { id: newId("c"), file, side, line, code, text },
    ]);
    setDraft(null);
  };

  const review: Review | null = file
    ? {
        pick: (ref) => {
          const existing = comments.find((c) => commentKey(c) === commentKey({ ...ref, file: file.path }));
          setDraft({ ...ref, file: file.path, text: existing?.text ?? "" });
        },
        thread: (ref) => {
          const key = commentKey({ ...ref, file: file.path });
          const saved = comments.find((c) => commentKey(c) === key);
          if (draft && commentKey(draft) === key)
            return (
              <div className="diff-comment editing">
                <textarea
                  autoFocus
                  className="input"
                  rows={2}
                  placeholder="Comment for the agent… (Enter to add, Shift+Enter for a new line, Esc to cancel)"
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      addDraft();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setDraft(null);
                    }
                  }}
                />
                <div className="diff-comment-actions">
                  <button className="link-btn" onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                  <button className="btn small primary" onClick={addDraft}>
                    {saved ? "Update" : "Add comment"}
                  </button>
                </div>
              </div>
            );
          if (!saved) return null;
          return (
            <div className="diff-comment">
              <span className="diff-comment-text" onClick={() => setDraft({ ...saved, text: saved.text })}>
                {saved.text}
              </span>
              <button
                className="icon-btn"
                title="Remove comment"
                onClick={() => setComments(comments.filter((c) => c.id !== saved.id))}
              >
                ×
              </button>
            </div>
          );
        },
      }
    : null;

  /** Pastes the comments into the agent's prompt (not submitted, so they can be checked first). */
  const send = () => {
    if (!tab?.agentRunning) {
      useApp.getState().showToast("Start or resume the agent first — the comments are kept");
      return;
    }
    void api.write(tabId, `\x1b[200~${reviewPrompt(comments)}\x1b[201~`);
    setComments([]);
    onClose();
    useApp.getState().activate(tabId);
    terms.focus(tabId);
    useApp.getState().showToast("Comments pasted into the agent — press Enter to send");
  };

  const counts = new Map<string, number>();
  for (const c of comments) counts.set(c.file, (counts.get(c.file) ?? 0) + 1);

  if (!tab) return null;
  return (
    <div className="overlay changes-overlay" onMouseDown={onClose}>
      <div
        className="picker changes"
        style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="picker-title changes-title" onPointerDown={drag("move")}>
          <span className="changes-heading">
            Changes in <b>{path ? basename(path) : tab.title}</b>{" "}
            {path && <span className="sessions-path">{tildify(path)}</span>}
          </span>
          <div className="segmented" role="radiogroup" aria-label="Diff view">
            {(["unified", "split"] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={view === v}
                className={view === v ? "on" : ""}
                onClick={() => setView(v)}
              >
                {v === "unified" ? "Unified" : "Split"}
              </button>
            ))}
          </div>
        </div>
        <div className="changes-body">
          <div className="changes-files" ref={listRef}>
            {error && <div className="hm-empty">{error}</div>}
            {files?.length === 0 && <div className="hm-empty">No uncommitted changes.</div>}
            {files?.map((f, i) => (
              <button
                key={f.path}
                className={"change" + (i === index ? " active" : "")}
                onClick={() => setIndex(i)}
                title={f.path}
              >
                <span className={"change-status s-" + (f.status === "?" ? "new" : f.status)}>
                  {f.status === "?" ? "U" : f.status}
                </span>
                <span className="change-name">
                  {basename(f.path)}
                  <span className="change-dir">
                    {f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}
                  </span>
                </span>
                <span className="change-count">
                  {counts.get(f.path) && (
                    <span className="change-comments" title="Your comments on this file">
                      💬{counts.get(f.path)}
                    </span>
                  )}
                  {f.added > 0 && <span className="plus">+{f.added}</span>}
                  {f.removed > 0 && <span className="minus">−{f.removed}</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="diff">
            {file &&
              (diff === null ? (
                <div className="diff-note">Loading…</div>
              ) : (
                <DiffView text={diff} view={view} review={review} />
              ))}
          </div>
        </div>
        <div className="picker-footer">
          <button className="link-btn" onClick={() => void actions.openInVSCode(tabId)}>
            Open in VS Code
          </button>
          <button className="link-btn" onClick={load}>
            Refresh
          </button>
          <span className="changes-hint">
            {comments.length ? "" : "Click a line to comment; send your comments to the agent as its next prompt."}
          </span>
          {comments.length > 0 && (
            <button
              className="btn small primary"
              onClick={send}
              title="Pasted into the agent's prompt; you press Enter"
            >
              Send {comments.length} comment{comments.length === 1 ? "" : "s"} to agent
            </button>
          )}
          <button className="btn small" onClick={onClose}>
            Done
          </button>
        </div>
        {(["e", "w", "s", "se", "sw"] as const).map((edge) => (
          <div key={edge} className={"frame-edge " + edge} onPointerDown={drag(edge)} />
        ))}
      </div>
    </div>
  );
}

/** The diff as GitHub shows it: one column (unified) or old and new side by side (split), with line numbers. */
function DiffView({ text, view, review }: { text: string; view: "unified" | "split"; review: Review | null }) {
  const rows = useMemo(() => parseDiff(text), [text]);
  if (!rows.length) return <div className="diff-note">{text.trim() || "Binary file or no textual changes."}</div>;
  return view === "split" ? <SplitTable rows={rows} review={review} /> : <UnifiedTable rows={rows} review={review} />;
}

const sign = { add: "+", del: "-", context: " " };

function UnifiedTable({ rows, review }: { rows: UnifiedRow[]; review: Review | null }) {
  return (
    <div className="diff-grid unified">
      {rows.map((row, i) => {
        if ("hunk" in row)
          return (
            <div key={i} className="diff-hunk">
              {row.hunk}
            </div>
          );
        // Removed lines are referred to by their old line number, the rest by the new one.
        const ref: LineRef =
          row.kind === "del"
            ? { side: "old", line: row.old!, code: row.text }
            : { side: "new", line: row.new!, code: row.text };
        return (
          <div key={i}>
            <div className={"diff-row clickable " + row.kind} onClick={() => review?.pick(ref)}>
              <span className="ln">{row.old}</span>
              <span className="ln">{row.new}</span>
              <span className="code">
                {sign[row.kind]}
                {row.text}
              </span>
            </div>
            {review?.thread(ref)}
          </div>
        );
      })}
    </div>
  );
}

function SplitTable({ rows, review }: { rows: UnifiedRow[]; review: Review | null }) {
  const split = useMemo(() => splitRows(rows), [rows]);
  const refOf = (side: Side, which: "old" | "new"): LineRef => ({ side: which, line: side.no, code: side.text });
  const cells = (side: Side | null, ref: LineRef | null, key: string) =>
    side && ref
      ? [
          <span key={key + "n"} className={"ln clickable " + side.kind} onClick={() => review?.pick(ref)}>
            {side.no}
          </span>,
          <span key={key + "c"} className={"code clickable " + side.kind} onClick={() => review?.pick(ref)}>
            {sign[side.kind]}
            {side.text}
          </span>,
        ]
      : [<span key={key + "n"} className="ln blank" />, <span key={key + "c"} className="code blank" />];
  return (
    <div className="diff-grid split">
      {split.map((row, i) => {
        if ("hunk" in row)
          return (
            <div key={i} className="diff-hunk">
              {row.hunk}
            </div>
          );
        // A context line is the same line on both sides: either side comments on it as the new line.
        const rightRef = row.right && refOf(row.right, "new");
        const leftRef = row.left && (row.left.kind === "context" ? rightRef : refOf(row.left, "old"));
        const left = row.left?.kind === "del" && leftRef ? review?.thread(leftRef) : null;
        const right = rightRef ? review?.thread(rightRef) : null;
        return (
          <div key={i}>
            <div className="diff-row">
              {cells(row.left, leftRef, "l")}
              {cells(row.right, rightRef, "r")}
            </div>
            {(left || right) && (
              <div className="diff-row threads">
                <div>{left}</div>
                <div>{right}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
