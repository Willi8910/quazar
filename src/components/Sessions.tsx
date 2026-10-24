import { useEffect, useMemo, useRef, useState } from "react";
import * as actions from "../actions";
import { api } from "../api";
import { sessionRows, SessionRow } from "../sessions";
import { agentInfo, useApp } from "../store";
import type { PastSession } from "../types";
import { basename, fuzzyScore, timeAgo, tildify } from "../util";
import { AgentIcon } from "./icons";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Every agent session run in `folder`; picking one resumes it (or shows its open tab). */
export function Sessions({
  folder,
  groupId,
  onClose,
}: {
  folder: string;
  groupId: string | null;
  onClose: () => void;
}) {
  const tabs = useApp((s) => s.tabs);
  const log = useApp((s) => s.sessionLog);
  const [past, setPast] = useState<PastSession[] | null>(null);
  const [query, setQuery] = useState("");
  const [agent, setAgent] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listSessions(folder).then(setPast, () => setPast([]));
  }, [folder]);

  const rows = useMemo(() => sessionRows(folder, past ?? [], tabs, log), [folder, past, tabs, log]);
  const agents = [...new Set(rows.map((r) => r.agent))];
  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!agent || r.agent === agent) &&
          fuzzyScore(query, [r.title, r.firstPrompt, r.lastPrompt, r.branch, r.worktree].join(" ")) !== null,
      ),
    [rows, agent, query],
  );

  useEffect(() => setIndex(0), [query, agent]);
  useEffect(() => {
    listRef.current?.querySelector(".session.active")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const pick = (row: SessionRow | undefined) => {
    if (!row) return;
    onClose();
    void actions.resumeSession(row, groupId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) setIndex((i) => Math.min(i + 1, shown.length - 1));
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) setIndex((i) => Math.max(i - 1, 0));
    else if (e.key === "Enter") pick(shown[index]);
    else if (e.key === "Tab" && agents.length > 1) {
      const all = [null, ...agents];
      setAgent(all[(all.indexOf(agent) + (e.shiftKey ? all.length - 1 : 1)) % all.length]);
    } else return;
    e.preventDefault();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="picker sessions" onMouseDown={(e) => e.stopPropagation()}>
        <div className="picker-title">
          Sessions in <b>{basename(folder)}</b> <span className="sessions-path">{tildify(folder)}</span>
        </div>
        <input
          autoFocus
          className="picker-input"
          placeholder="Search titles, prompts, branches…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        {agents.length > 1 && (
          <div className="profiles">
            {[null, ...agents].map((a) => (
              <button key={a ?? "all"} className={"chip" + (a === agent ? " on" : "")} onClick={() => setAgent(a)}>
                {a ? (agentInfo(a)?.label ?? a) : "All"} ({rows.filter((r) => !a || r.agent === a).length})
              </button>
            ))}
            <span className="profiles-hint">Tab to switch</span>
          </div>
        )}
        <div className="picker-list" ref={listRef}>
          {past === null && rows.length === 0 && <div className="picker-empty">Reading session history…</div>}
          {past !== null && shown.length === 0 && (
            <div className="picker-empty">{rows.length ? "No matches" : "No agent sessions in this folder yet"}</div>
          )}
          {shown.map((row, i) => (
            <SessionItem
              key={row.key}
              row={row}
              folder={folder}
              active={i === index}
              onHover={() => setIndex(i)}
              onPick={() => pick(row)}
            />
          ))}
        </div>
        <div className="picker-footer muted">
          <span>
            Enter resumes in a new tab · open sessions switch to their tab
            {past === null && rows.length > 0 && " · reading history…"}
          </span>
        </div>
      </div>
    </div>
  );
}

function SessionItem({
  row,
  folder,
  active,
  onHover,
  onPick,
}: {
  row: SessionRow;
  folder: string;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const info = agentInfo(row.agent);
  const hidden = row.tab ? actions.isTabHidden(row.tab.id) : false;
  const running = row.tab?.agentRunning;
  const where = row.cwd === folder ? null : row.cwd.startsWith(folder + "/") ? row.cwd.slice(folder.length + 1) : null;
  const mode = row.record
    ? row.record.launchArgv.slice(1).join(" ") || null
    : row.bypass
      ? "bypass permissions"
      : row.plan
        ? "plan mode"
        : null;
  return (
    <div className={"session" + (active ? " active" : "")} onMouseMove={onHover} onClick={onPick}>
      <div className="session-line">
        <AgentIcon agent={row.agent} color={info?.color} label={info?.label} />
        <span className="session-title">{row.title}</span>
        {row.tab && (
          <span className={"session-state" + (hidden ? " hidden" : running ? " running" : "")}>
            {hidden ? "hidden tab" : running ? `running · ${row.tab.status}` : "open tab"}
          </span>
        )}
        <span className="session-time" title={new Date(row.updated).toLocaleString()}>
          {timeAgo(row.updated)}
        </span>
      </div>
      <div className="session-meta">
        {row.branch && <span className="branch-tag">⎇ {row.branch}</span>}
        {row.worktree && <span className="session-chip">worktree {basename(row.worktree)}</span>}
        {where && <span className="session-chip">{where}</span>}
        {mode && (
          <span className="session-chip" title={row.record ? "Resumes with the flags it was launched with" : ""}>
            {mode}
          </span>
        )}
        {row.model && <span>{row.model}</span>}
        {row.started && <span>started {dateFormat.format(row.started)}</span>}
      </div>
      {row.lastPrompt && row.lastPrompt !== row.title && <div className="session-text">› {row.lastPrompt}</div>}
      {row.lastReply && <div className="session-text reply">{row.lastReply}</div>}
    </div>
  );
}
