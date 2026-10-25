import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import * as actions from "../actions";
import { api } from "../api";
import { bytes, cpuShare, isIdle, load, memoryShare, percent, TAB_SCALE, total } from "../metrics";
import { agentInfo, useApp } from "../store";
import { useHoverPopover, windowRect } from "./hover";
import { AgentIcon, StopIcon } from "./icons";
import type { Metrics, ProcessInfo, ResourceUse, TabUsage } from "../types";

const WIDTH = 380;

/** Footer of the sidebar: CPU and memory of everything Quazar runs; hover for the per-tab list. */
export function MetricsBar() {
  const metrics = useApp((s) => s.metrics);
  // Opens upwards from the top of the bar.
  const hover = useHoverPopover<Anchor, HTMLDivElement>((bar) => {
    const r = windowRect(bar);
    return { left: r.left + 8, bottom: window.innerHeight - r.top + 4 };
  });
  const { anchor } = hover;
  if (!metrics) return null;
  const sum = total(metrics);
  return (
    <>
      <div
        ref={hover.trigger}
        className={"metrics-bar " + load(sum, metrics)}
        onMouseEnter={hover.onMouseEnter}
        onMouseLeave={hover.onMouseLeave}
      >
        <span className="metrics-item">
          <span className="metrics-label">CPU</span> {percent(cpuShare(sum, metrics))}
        </span>
        <span className="metrics-item">
          <span className="metrics-label">MEM</span> {bytes(sum.memory)}
          <span className="metrics-share">{percent(memoryShare(sum, metrics))}</span>
        </span>
      </div>
      {/* Portaled: the sidebar is zoomed, which would skew a fixed-position popover inside it. */}
      {anchor &&
        createPortal(
          <MetricsPanel metrics={metrics} anchor={anchor} panelRef={hover.panel} onClose={hover.close} />,
          document.body,
        )}
    </>
  );
}

interface Anchor {
  left: number;
  bottom: number;
}

function MetricsPanel({
  metrics,
  anchor,
  panelRef: ref,
  onClose,
}: {
  metrics: Metrics;
  anchor: Anchor;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const tabs = useApp((s) => s.tabs);
  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Sidebar order, not by use: readings change every few seconds, and rows moving under the
  // pointer would put a different tab under the Stop button.
  const shown = actions.visualOrder().map((t) => t.id);
  const rank = (id: string) => {
    const at = shown.indexOf(id);
    return at >= 0 ? at : shown.length + tabs.findIndex((t) => t.id === id);
  };
  const rows = metrics.tabs
    .map((use) => ({ use, tab: tabs.find((t) => t.id === use.tabId) }))
    .filter((r) => r.tab)
    .sort((a, b) => rank(a.use.tabId) - rank(b.use.tabId));
  // Idle shells are folded into one row so they don't crowd out the tabs actually using something.
  const busy = rows.filter((r) => !isIdle(r.use, metrics));
  const idle = rows.filter((r) => isIdle(r.use, metrics));
  const idleUse = idle.reduce((sum, r) => ({ cpu: sum.cpu + r.use.cpu, memory: sum.memory + r.use.memory }), {
    cpu: 0,
    memory: 0,
  });
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));
  return (
    <div ref={ref} className="ctx metrics-panel" style={{ left, bottom: anchor.bottom, width: WIDTH }}>
      <div className="hm-head">
        <span>Resource use</span>
        <span className="metrics-note">
          {metrics.cores} cores · {bytes(metrics.totalMemory)}
        </span>
      </div>
      {rows.length === 0 && <div className="hm-empty">No shells running.</div>}
      {busy.map(({ use, tab }) => (
        <div key={use.tabId} className="hm-row clickable" onClick={() => actions.revealTab(tab!.id)}>
          <div className="hm-text">
            <div className="hm-title">
              {tab!.title}
              {tab!.agent && (
                <AgentIcon
                  agent={tab!.agent}
                  color={agentInfo(tab!.agent)?.color}
                  label={agentInfo(tab!.agent)?.label}
                />
              )}
            </div>
            <div className="hm-sub">
              {use.top ? `${use.top} · ` : ""}
              {use.processes} process{use.processes === 1 ? "" : "es"}
            </div>
          </div>
          <UseCells use={use} metrics={metrics} />
          <button
            className="icon-btn small danger metrics-stop"
            title={
              tab!.sessionId
                ? "Stop · ends everything in this tab; open it again to resume the session"
                : "Stop · ends everything in this tab (the tab stays)"
            }
            onClick={(e) => {
              e.stopPropagation();
              void actions.stopTab(tab!.id);
            }}
          >
            <StopIcon />
          </button>
        </div>
      ))}
      {idle.length > 0 && (
        <div className="hm-row" title={idle.map((r) => r.tab!.title).join("\n")}>
          <div className="hm-text">
            <div className="hm-title">
              Idle · {idle.length} tab{idle.length === 1 ? "" : "s"}
            </div>
            <div className="hm-sub">{idle.map((r) => r.tab!.title).join(", ")}</div>
          </div>
          <UseCells use={idleUse} metrics={metrics} />
          <span className="metrics-stop" />
        </div>
      )}
      <div className="hm-row">
        <div className="hm-text">
          <div className="hm-title">Quazar</div>
          <div className="hm-sub">the app itself</div>
        </div>
        <UseCells use={metrics.app} metrics={metrics} />
        <span className="metrics-stop" />
      </div>
      <div className="hm-hint">CPU is a share of all cores. Stopped agents resume when reopened.</div>
    </div>
  );
}

function UseCells({ use, metrics }: { use: ResourceUse; metrics: Metrics }) {
  return (
    <span className={"metrics-cells " + load(use, metrics, TAB_SCALE)}>
      <span>{percent(cpuShare(use, metrics))}</span>
      <span>{bytes(use.memory)}</span>
    </span>
  );
}

/** A tab's CPU and memory, shown in its row on hover. */
export function TabMetrics({ tabId }: { tabId: string }) {
  const metrics = useApp((s) => s.metrics);
  const use: TabUsage | undefined = metrics?.tabs.find((t) => t.tabId === tabId);
  if (!metrics || !use) return null;
  return (
    <span className={"tab-metrics " + load(use, metrics, TAB_SCALE)}>
      {percent(cpuShare(use, metrics))} · {bytes(use.memory)}
    </span>
  );
}

const DETAIL_WIDTH = 560;

/** The active tab's CPU and memory in the console header; hover for every process in it. */
export function TabResources({ tabId, labels }: { tabId: string; labels: boolean }) {
  const metrics = useApp((s) => s.metrics);
  const use = metrics?.tabs.find((t) => t.tabId === tabId);
  // Opens below, right-aligned with the figure (it sits at the right of the header).
  const hover = useHoverPopover<{ right: number; top: number }, HTMLButtonElement>((el) => {
    const r = el.getBoundingClientRect();
    return { right: window.innerWidth - r.right, top: r.bottom + 6 };
  });
  if (!metrics || !use) return null;
  return (
    <>
      <button
        ref={hover.trigger}
        className={"topbar-btn tab-resources " + load(use, metrics, TAB_SCALE)}
        onMouseEnter={hover.onMouseEnter}
        onMouseLeave={hover.onMouseLeave}
        aria-label="CPU and memory of this tab"
        title={labels ? undefined : "CPU · memory of this tab"}
      >
        {labels && <span className="metrics-label">CPU</span>} {percent(cpuShare(use, metrics))}
        {labels ? <span className="metrics-label">MEM</span> : " · "}
        {bytes(use.memory)}
      </button>
      {hover.anchor &&
        createPortal(
          <ProcessPanel tabId={tabId} metrics={metrics} anchor={hover.anchor} panelRef={hover.panel} />,
          document.body,
        )}
    </>
  );
}

/** Every process in the tab as a tree, re-read every 2 s while open. */
function ProcessPanel({
  tabId,
  metrics,
  anchor,
  panelRef,
}: {
  tabId: string;
  metrics: Metrics;
  anchor: { right: number; top: number };
  panelRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [procs, setProcs] = useState<ProcessInfo[] | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api.tabProcesses(tabId).then(
        (list) => alive && setProcs(list),
        () => {},
      );
    void read();
    const timer = window.setInterval(read, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [tabId]);

  const stop = async (p: ProcessInfo) => {
    try {
      await api.stopProcess(tabId, p.pid);
      useApp.getState().showToast(`Stopped ${p.name} (${p.pid})`);
      setProcs((list) => list?.filter((x) => x.pid !== p.pid) ?? null);
    } catch (e) {
      useApp.getState().showToast(String(e));
    }
  };

  const servers = procs?.flatMap((p) => p.ports) ?? [];
  return (
    <div
      ref={panelRef}
      className="ctx metrics-panel process-panel"
      style={{ right: Math.max(8, anchor.right), top: anchor.top, width: DETAIL_WIDTH }}
    >
      <div className="hm-head">
        <span>Processes in this tab</span>
        <span className="metrics-note">
          {procs ? `${procs.length} running` : "Reading…"}
          {servers.length > 0 && ` · listening on ${servers.map((p) => ":" + p).join(" ")}`}
        </span>
      </div>
      <div className="process-list">
        {procs?.map((p) => (
          <div key={p.pid} className="hm-row process-row" title={p.command}>
            <div className="hm-text" style={{ paddingLeft: Math.min(p.depth, 6) * 14 }}>
              <div className="hm-title">
                {p.depth > 0 && <span className="process-branch">└</span>}
                {p.name}
                {p.ports.map((port) => (
                  <span key={port} className="port-tag" title={`Listening on port ${port}`}>
                    :{port}
                  </span>
                ))}
                <span className="process-pid">{p.pid}</span>
              </div>
              <div className="hm-sub process-command">{p.command}</div>
            </div>
            <UseCells use={p} metrics={metrics} />
            {p.depth > 0 ? (
              <button
                className="icon-btn small danger metrics-stop"
                title={`Stop ${p.name} (sends it SIGTERM); the rest of the tab keeps running`}
                onClick={() => void stop(p)}
              >
                <StopIcon />
              </button>
            ) : (
              <span className="metrics-stop" title="The tab's shell — stop the whole tab from the resources panel" />
            )}
          </div>
        ))}
      </div>
      <div className="hm-hint">CPU is a share of all cores. Hover a process for its full command.</div>
    </div>
  );
}
