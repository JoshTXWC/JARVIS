/**
 * SYSTEM DIAGNOSTICS + SUBSYSTEMS — combined liquid panel.
 * Primary rings on top; extended radials below a divider; collapse toggle.
 */
import { useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import { getStats } from "../../lib/api";
import Ring from "./Ring";

const COLLAPSE_KEY = "jarvis.diag.subsCollapsed";

interface Gauge {
  key: string;
  label: string;
  pct: number;
  status: "ok" | "warn" | "crit" | "off";
  sub: string;
}

const R = 15.5;
const C = 2 * Math.PI * R;

const TONE = {
  ok:   { stroke: "rgba(125,211,252,0.95)", glow: "rgba(125,211,252,0.35)", text: "text-jarvis-ok" },
  warn: { stroke: "rgba(251,191,36,0.95)",  glow: "rgba(251,191,36,0.35)",  text: "text-jarvis-warn" },
  crit: { stroke: "rgba(251,113,133,0.95)", glow: "rgba(251,113,133,0.40)", text: "text-jarvis-danger" },
  off:  { stroke: "rgba(186,230,253,0.28)", glow: "transparent",            text: "text-jarvis-ice/40" },
} as const;

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function DiagPanel() {
  const stats = useStore((s) => s.stats);
  const setStats = useStore((s) => s.setStats);
  const health = useStore((s) => s.health);
  const tools = useStore((s) => s.tools);
  const connected = useStore((s) => s.connected);
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const s = await getStats();
        if (live) setStats(s);
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => { live = false; clearInterval(id); };
  }, [setStats]);

  const toggle = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
  };

  if (!stats) {
    return (
      <div className="holo-panel p-3 text-center text-mono text-xs text-jarvis-cyan/50 h-full grid place-items-center">
        acquiring telemetry…
      </div>
    );
  }

  const gpuAvailable = !!stats.gpu?.available;
  const gpuLoad = stats.gpu?.load_percent ?? 0;
  const gauges = buildGauges(stats, health, tools, connected);

  return (
    <div className="holo-panel flex flex-col h-full overflow-hidden">
      <div className="panel-header flex items-center justify-between px-3.5 py-2 shrink-0">
        <span className="text-display text-[10px] tracking-[0.35em] text-shimmer font-medium">
          SYSTEM DIAGNOSTICS
        </span>
        <span className="glass-chip">LIVE</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Primary rings */}
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-4 gap-1 justify-items-center">
            <Ring value={stats.cpu} label="CPU" sub={`${stats.cpu_count}c`} size={58} />
            <Ring value={stats.ram.percent} label="RAM" sub={`${stats.ram.used_gb.toFixed(0)}g`} size={58} />
            <Ring
              value={stats.disk.percent}
              label="DISK"
              sub={`${(stats.disk.total_gb - stats.disk.used_gb).toFixed(0)}g`}
              size={58}
            />
            <Ring
              value={gpuAvailable ? gpuLoad : 0}
              label="GPU"
              sub={gpuAvailable ? `${(stats.gpu?.mem_used_gb ?? 0).toFixed(0)}g` : "n/a"}
              size={58}
            />
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-mono text-[9px]">
            <Cell k="NET ↑" v={`${stats.net.sent_mb.toFixed(1)} MB`} />
            <Cell k="NET ↓" v={`${stats.net.recv_mb.toFixed(1)} MB`} />
            <Cell
              k={stats.battery ? (stats.battery.plugged ? "POWER" : "BAT") : "HOST"}
              v={
                stats.battery
                  ? `${stats.battery.percent.toFixed(0)}%`
                  : stats.os.node
              }
            />
          </div>
        </div>

        {/* Divider + collapse control */}
        <div className="px-3">
          <div className="glass-divider" />
          <button
            type="button"
            onClick={toggle}
            data-reticle
            title={collapsed ? "Expand subsystems" : "Collapse subsystems"}
            className="w-full flex items-center justify-between gap-2 py-2 px-1 rounded-lg text-left hover:bg-jarvis-cyan/[0.04] transition-colors"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-display text-[9px] tracking-[0.35em] text-jarvis-cyan/70">
                SUBSYSTEMS
              </span>
              <span className="glass-chip !py-0 !px-1.5 text-[9px]">{gauges.length}</span>
            </span>
            <span className="text-jarvis-cyan/55 text-[10px] text-mono tracking-wider flex items-center gap-1">
              {collapsed ? "EXPAND" : "COLLAPSE"}
              <Chevron open={!collapsed} />
            </span>
          </button>
          {!collapsed && <div className="glass-divider" />}
        </div>

        {/* Extended radials */}
        {!collapsed && (
          <div className="px-2.5 pb-3 pt-2">
            <div className="grid grid-cols-4 gap-x-1 gap-y-2">
              {gauges.map((g) => (
                <Radial key={g.key} gauge={g} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function buildGauges(
  stats: NonNullable<ReturnType<typeof useStore.getState>["stats"]>,
  health: ReturnType<typeof useStore.getState>["health"],
  tools: ReturnType<typeof useStore.getState>["tools"],
  connected: boolean,
): Gauge[] {
  // Extended strip only — CPU/RAM/DISK/GPU already live in the primary rings.
  const rows: Gauge[] = [];
  if (stats.battery) {
    const bp = stats.battery.percent;
    rows.push({
      key: "pwr",
      label: "PWR",
      pct: bp,
      status: bp < 20 ? "crit" : bp < 40 ? "warn" : "ok",
      sub: stats.battery.plugged ? "AC" : "BAT",
    });
  } else {
    rows.push({ key: "pwr", label: "PWR", pct: 100, status: "ok", sub: "AC" });
  }
  rows.push({
    key: "lnk",
    label: "LINK",
    pct: connected ? 100 : 0,
    status: connected ? "ok" : "crit",
    sub: connected ? "UP" : "DN",
  });
  rows.push({
    key: "ai",
    label: "AI",
    pct: health ? 100 : 0,
    status: health ? "ok" : "off",
    sub: health ? "ON" : "OFF",
  });
  const running = tools.filter((t) => t.status === "running").length;
  rows.push({
    key: "tools",
    label: "BUS",
    pct: Math.min(100, 30 + running * 18),
    status: running > 3 ? "warn" : "ok",
    sub: `${running}a`,
  });
  return rows;
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div
      className="rounded-lg px-2 py-1.5 min-w-0"
      style={{
        background: "rgba(8,14,26,0.35)",
        boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.10)",
      }}
    >
      <div className="text-jarvis-cyan/40 tracking-wider truncate">{k}</div>
      <div className="text-jarvis-cyan/90 truncate tabular-nums">{v}</div>
    </div>
  );
}

function Radial({ gauge }: { gauge: Gauge }) {
  const tone = TONE[gauge.status];
  const pct = Math.max(0, Math.min(100, gauge.pct));
  const dash = (pct / 100) * C;

  return (
    <div
      className="flex flex-col items-center gap-0.5 min-w-0"
      title={`${gauge.label} · ${gauge.sub}`}
      data-reticle
    >
      <div className="relative w-[52px] h-[52px]">
        <svg viewBox="0 0 40 40" className="w-full h-full -rotate-90">
          <circle cx="20" cy="20" r={R} fill="none" stroke="rgba(186,230,253,0.08)" strokeWidth="3" />
          <circle
            cx="20"
            cy="20"
            r={R}
            fill="none"
            stroke={tone.stroke}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${C}`}
            style={{
              filter: tone.glow !== "transparent" ? `drop-shadow(0 0 4px ${tone.glow})` : undefined,
              transition: "stroke-dasharray 0.4s ease",
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className={`text-mono text-[11px] tabular-nums leading-none font-medium ${tone.text}`}>
            {pct.toFixed(0)}
          </span>
          <span className="text-mono text-[7px] text-jarvis-ice/35 leading-none mt-0.5">%</span>
        </div>
      </div>
      <span className="text-mono text-[8px] tracking-[0.18em] text-jarvis-ice/70 truncate max-w-full">
        {gauge.label}
      </span>
      <span className="text-mono text-[7px] tracking-wider text-jarvis-ice/35 truncate max-w-full uppercase">
        {gauge.sub}
      </span>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
