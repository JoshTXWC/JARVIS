/**
 * SUBSYSTEMS — compact radial health gauges.
 */
import { useStore } from "../../lib/store";

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

export default function Subsystems() {
  const stats = useStore((s) => s.stats);
  const health = useStore((s) => s.health);
  const tools = useStore((s) => s.tools);
  const connected = useStore((s) => s.connected);

  const sev = (pct: number): Gauge["status"] =>
    pct >= 90 ? "crit" : pct >= 75 ? "warn" : "ok";

  const rows: Gauge[] = [];
  if (stats) {
    rows.push({
      key: "cpu",
      label: "CPU",
      pct: stats.cpu,
      status: sev(stats.cpu),
      sub: `${stats.cpu_count}c`,
    });
    rows.push({
      key: "ram",
      label: "RAM",
      pct: stats.ram.percent,
      status: sev(stats.ram.percent),
      sub: `${stats.ram.used_gb.toFixed(0)}G`,
    });
    rows.push({
      key: "dsk",
      label: "DISK",
      pct: stats.disk.percent,
      status: sev(stats.disk.percent),
      sub: `${(stats.disk.total_gb - stats.disk.used_gb).toFixed(0)}G`,
    });
    if (stats.gpu?.available) {
      const load = stats.gpu.load_percent ?? 0;
      const vendor = (stats.gpu.vendor || "").toLowerCase();
      const tag =
        typeof stats.gpu.temp_c === "number"
          ? `${stats.gpu.temp_c.toFixed(0)}°`
          : vendor === "amd"
            ? "AMD"
            : vendor === "intel"
              ? "INT"
              : "on";
      rows.push({
        key: "gpu",
        label: "GPU",
        pct: load,
        status: sev(load),
        sub: tag,
      });
    }
    if (stats.battery) {
      const bp = stats.battery.percent;
      rows.push({
        key: "pwr",
        label: "PWR",
        pct: bp,
        status: bp < 20 ? "crit" : bp < 40 ? "warn" : "ok",
        sub: stats.battery.plugged ? "AC" : "BAT",
      });
    }
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

  return (
    <div className="holo-panel flex flex-col overflow-hidden h-full">
      <div className="panel-header flex items-center justify-between px-3 py-1.5 shrink-0">
        <span className="text-display text-[9px] tracking-[0.4em] text-shimmer font-medium">
          SUBSYSTEMS
        </span>
        <span className="glass-chip !py-0 !px-1.5 text-[9px]">{rows.length}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-2.5 pt-1">
        <div className="grid grid-cols-4 gap-x-1 gap-y-2">
          {rows.map((r) => (
            <Radial key={r.key} gauge={r} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Radial({ gauge }: { gauge: Gauge }) {
  const tone = TONE[gauge.status];
  const pct = Math.max(0, Math.min(100, gauge.pct));
  const dash = (pct / 100) * C;

  return (
    <div className="flex flex-col items-center gap-0.5 min-w-0" title={`${gauge.label} · ${gauge.sub}`}>
      <div className="relative w-[52px] h-[52px]">
        <svg viewBox="0 0 40 40" className="w-full h-full -rotate-90">
          {/* Track */}
          <circle
            cx="20"
            cy="20"
            r={R}
            fill="none"
            stroke="rgba(186,230,253,0.08)"
            strokeWidth="3"
          />
          {/* Value arc */}
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
