/**
 * Settings → Security: permission mode, session status, audit, kill switch.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../lib/session";
import { wsClient } from "../../lib/ws";

type SecEvent = {
  ts: number;
  action: string;
  tool: string;
  permission: string;
  preview: string;
  reason: string;
  mode: string;
};

type SecStatus = {
  mode: string;
  auth_required: boolean;
  session_ok: boolean;
  pending_grants: { tool: string; permission: string; preview: string; expires_at: number }[];
  recent_events: SecEvent[];
  privileged_tools: { name: string; permission: string }[];
  tool_count: number;
};

const MODES = ["confirm", "safe", "auto", "bypass"] as const;

export default function SecurityPanel() {
  const [status, setStatus] = useState<SecStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch("/api/security/status");
      if (!r.ok) throw new Error(`${r.status}`);
      setStatus(await r.json());
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const setMode = async (mode: string) => {
    setBusy(true);
    try {
      const r = await apiFetch("/api/security/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!r.ok) throw new Error(await r.text());
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const kill = async () => {
    if (!confirm("Emergency stop: cancel running agent and revoke all pending approvals?")) return;
    setBusy(true);
    try {
      wsClient.killSwitch();
      await apiFetch("/api/security/kill", { method: "POST" });
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const mode = status?.mode || "—";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-mono text-[9px] tracking-[0.28em] uppercase text-jarvis-cyan/45">
            Security
          </div>
          <p className="text-[11px] text-jarvis-ice/45 mt-1 leading-relaxed">
            Permissions, session auth, and emergency stop. Model text never grants approvals.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void kill()}
          className="text-mono text-[10px] tracking-[0.16em] uppercase px-3 py-2 rounded-md text-red-300/90 hover:text-red-200 transition-colors"
          style={{
            boxShadow: "inset 0 0 0 1px rgba(248,113,113,0.35)",
            background: "rgba(127,29,29,0.25)",
          }}
        >
          Stop / revoke
        </button>
      </div>

      {err && (
        <div className="text-[11px] text-red-300/80 px-2 py-1.5 rounded" style={{ background: "rgba(127,29,29,0.2)" }}>
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Mode" value={mode} />
        <Stat
          label="Session"
          value={status?.session_ok ? "authenticated" : "missing"}
          warn={!status?.session_ok}
        />
        <Stat label="Pending grants" value={String(status?.pending_grants?.length ?? 0)} />
        <Stat label="Privileged tools" value={String(status?.privileged_tools?.length ?? 0)} />
      </div>

      <div>
        <div className="text-mono text-[9px] tracking-[0.22em] uppercase text-jarvis-ice/40 mb-2">
          Permission mode
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              disabled={busy || mode === m}
              onClick={() => void setMode(m)}
              className={`text-mono text-[10px] tracking-[0.14em] uppercase px-2.5 py-1.5 rounded-md transition-colors ${
                mode === m
                  ? "text-jarvis-ice bg-jarvis-cyan/20"
                  : "text-jarvis-ice/50 hover:text-jarvis-ice hover:bg-jarvis-cyan/10"
              }`}
              style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.18)" }}
              title={
                m === "bypass"
                  ? "Advanced: still cannot clear hard denials; DANGEROUS still asks"
                  : m
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {!!status?.pending_grants?.length && (
        <div>
          <div className="text-mono text-[9px] tracking-[0.22em] uppercase text-amber-300/60 mb-2">
            Awaiting approval
          </div>
          <ul className="space-y-1.5 max-h-28 overflow-y-auto">
            {status.pending_grants.map((g, i) => (
              <li key={i} className="text-[11px] text-jarvis-ice/70 px-2 py-1.5 rounded"
                style={{ background: "rgba(8,14,26,0.45)", boxShadow: "inset 0 0 0 1px rgba(251,191,36,0.2)" }}>
                <span className="text-amber-200/80">{g.tool}</span>
                <span className="text-jarvis-ice/35 mx-1">·</span>
                <span className="text-jarvis-ice/45">{g.permission}</span>
                <div className="text-jarvis-ice/40 truncate mt-0.5">{g.preview}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="text-mono text-[9px] tracking-[0.22em] uppercase text-jarvis-ice/40 mb-2">
          Recent security events
        </div>
        <ul className="space-y-1 max-h-40 overflow-y-auto">
          {(status?.recent_events || []).slice(0, 24).map((e, i) => (
            <li key={`${e.ts}-${i}`} className="text-[10px] text-jarvis-ice/55 flex gap-2 px-1">
              <span className={`shrink-0 w-16 ${actionColor(e.action)}`}>{e.action}</span>
              <span className="text-jarvis-cyan/60 shrink-0 max-w-[7rem] truncate">{e.tool || "—"}</span>
              <span className="truncate text-jarvis-ice/35">{e.reason || e.preview}</span>
            </li>
          ))}
          {!status?.recent_events?.length && (
            <li className="text-[11px] text-jarvis-ice/30 px-1">No events yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div
      className="px-2.5 py-2 rounded-md"
      style={{ background: "rgba(8,14,26,0.4)", boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.12)" }}
    >
      <div className="text-mono text-[8px] tracking-[0.2em] uppercase text-jarvis-ice/35">{label}</div>
      <div className={`text-[12px] mt-0.5 truncate ${warn ? "text-amber-300/90" : "text-jarvis-ice/85"}`}>
        {value}
      </div>
    </div>
  );
}

function actionColor(action: string) {
  if (action === "deny" || action === "hard_deny") return "text-red-300/80";
  if (action === "ask" || action === "revoke") return "text-amber-300/80";
  if (action === "allow" || action === "grant") return "text-emerald-300/70";
  return "text-jarvis-ice/45";
}
