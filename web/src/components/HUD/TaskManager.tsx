/**
 * Task Manager — pause / resume / cancel durable agent tasks.
 */
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/session";
import { wsClient } from "../../lib/ws";
import { useStore } from "../../lib/store";

type TaskRec = {
  id: string;
  state: string;
  goal: string;
  error?: string;
  hops?: number;
  updated_at?: number;
};

type Status = {
  current: TaskRec | null;
  paused: boolean;
  cancel_requested: boolean;
  recent: TaskRec[];
};

export default function TaskManager() {
  const [status, setStatus] = useState<Status | null>(null);
  const dockPanel = useStore((s) => s.dockPanel);

  const refresh = async () => {
    try {
      const r = await apiFetch("/api/tasks/status");
      if (r.ok) setStatus(await r.json());
    } catch { /* noop */ }
  };

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 2500);
    const unsub = wsClient.subscribe((m) => {
      if (m.type === "task_status") {
        setStatus({
          current: m.current ?? null,
          paused: !!m.paused,
          cancel_requested: !!m.cancel_requested,
          recent: m.recent || [],
        });
      }
    });
    return () => {
      window.clearInterval(t);
      unsub();
    };
  }, []);

  const cur = status?.current;

  return (
    <div className="holo-panel flex flex-col h-full overflow-hidden relative">
      <header className="relative shrink-0 px-4 pt-4 pb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-mono text-[9px] tracking-[0.32em] uppercase text-jarvis-cyan/45">
            Lifecycle
          </div>
          <h2 className="text-display text-[16px] tracking-[0.2em] text-jarvis-ice/90 mt-0.5">
            TASKS
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dockPanel("tasks")}
          className="text-mono text-[10px] tracking-[0.18em] uppercase px-2 py-1 rounded-md text-jarvis-ice/45 hover:text-jarvis-ice"
          style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.18)" }}
        >
          Close
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-3">
        <div
          className="rounded-md px-3 py-3"
          style={{ background: "rgba(8,14,26,0.45)", boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.14)" }}
        >
          <div className="text-mono text-[9px] tracking-[0.2em] uppercase text-jarvis-ice/40 mb-1">
            Current
          </div>
          {cur ? (
            <>
              <div className="text-[12px] text-jarvis-ice/85 line-clamp-2">{cur.goal || "(no goal)"}</div>
              <div className="mt-2 flex flex-wrap gap-2 text-mono text-[10px] tracking-[0.12em] uppercase">
                <span className={stateColor(cur.state)}>{cur.state}</span>
                <span className="text-jarvis-ice/35">hops {cur.hops ?? 0}</span>
                {status?.paused && <span className="text-amber-300/80">paused</span>}
              </div>
            </>
          ) : (
            <div className="text-[12px] text-jarvis-ice/35">Idle — no active task.</div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            <Ctl
              label="Pause"
              disabled={!cur || status?.paused}
              onClick={() => { wsClient.pause(); void refresh(); }}
            />
            <Ctl
              label="Resume"
              disabled={!status?.paused}
              onClick={() => { wsClient.resume(); void refresh(); }}
            />
            <Ctl
              label="Cancel"
              danger
              disabled={!cur}
              onClick={() => { wsClient.cancel(); void refresh(); }}
            />
          </div>
        </div>

        <div>
          <div className="text-mono text-[9px] tracking-[0.2em] uppercase text-jarvis-ice/40 mb-2">
            Recent
          </div>
          <ul className="space-y-1.5">
            {(status?.recent || []).slice().reverse().slice(0, 12).map((t) => (
              <li
                key={t.id}
                className="text-[11px] px-2 py-1.5 rounded"
                style={{ background: "rgba(8,14,26,0.35)", boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.1)" }}
              >
                <div className="flex justify-between gap-2">
                  <span className={stateColor(t.state)}>{t.state}</span>
                  <span className="text-jarvis-ice/30 text-mono text-[9px]">{t.id}</span>
                </div>
                <div className="text-jarvis-ice/55 truncate mt-0.5">{t.goal || "—"}</div>
                {t.error && <div className="text-red-300/70 truncate text-[10px] mt-0.5">{t.error}</div>}
              </li>
            ))}
            {!status?.recent?.length && (
              <li className="text-[11px] text-jarvis-ice/30">No completed tasks yet.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Ctl({
  label, onClick, disabled, danger,
}: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`text-mono text-[10px] tracking-[0.14em] uppercase px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-35 ${
        danger ? "text-red-300/85 hover:text-red-200" : "text-jarvis-ice/60 hover:text-jarvis-ice"
      }`}
      style={{
        boxShadow: danger
          ? "inset 0 0 0 1px rgba(248,113,113,0.3)"
          : "inset 0 0 0 1px rgba(125,211,252,0.2)",
      }}
    >
      {label}
    </button>
  );
}

function stateColor(s: string) {
  if (s === "failed" || s === "cancelled") return "text-red-300/80";
  if (s === "paused" || s === "waiting_for_approval") return "text-amber-300/85";
  if (s === "completed") return "text-emerald-300/80";
  if (s === "running" || s === "planning") return "text-jarvis-cyan/80";
  return "text-jarvis-ice/50";
}
