/**
 * System Health tile — static radial gauges for live resources.
 */
import { useEffect, useMemo } from "react";
import { getStats } from "../../lib/api";
import { useStore } from "../../lib/store";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "crit";

type Gauge = {
  key: string;
  label: string;
  pct: number;
  sub: string;
  tone: Tone;
};

const TONE: Record<Tone, { stroke: string; text: string }> = {
  ok: { stroke: "#34d399", text: "text-emerald-300" },
  warn: { stroke: "#fbbf24", text: "text-amber-300" },
  crit: { stroke: "#f87171", text: "text-red-300" },
};

const RADIAL_SIZE = 112;
const STROKE = 10;

function sev(pct: number): Tone {
  if (pct >= 90) return "crit";
  if (pct >= 75) return "warn";
  return "ok";
}

export default function SystemHealth() {
  const stats = useStore((s) => s.stats);
  const setStats = useStore((s) => s.setStats);

  useEffect(() => {
    let live = true;
    let id = 0;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const s = await getStats();
        if (live) setStats(s);
      } catch {
        /* ignore */
      }
    };
    tick();
    id = window.setInterval(tick, 2500);
    const onVis = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [setStats]);

  const gauges = useMemo(() => {
    const rows: Gauge[] = [];
    if (!stats) return rows;
    rows.push({
      key: "cpu",
      label: "CPU",
      pct: stats.cpu,
      sub: `${stats.cpu_count} cores`,
      tone: sev(stats.cpu),
    });
    rows.push({
      key: "ram",
      label: "RAM",
      pct: stats.ram.percent,
      sub: `${stats.ram.used_gb.toFixed(1)} / ${stats.ram.total_gb.toFixed(0)} GB`,
      tone: sev(stats.ram.percent),
    });
    rows.push({
      key: "disk",
      label: "DISK",
      pct: stats.disk.percent,
      sub: `${stats.disk.used_gb.toFixed(0)} / ${stats.disk.total_gb.toFixed(0)} GB`,
      tone: sev(stats.disk.percent),
    });
    if (stats.gpu?.available) {
      const load = stats.gpu.load_percent ?? 0;
      rows.push({
        key: "gpu",
        label: "GPU",
        pct: load,
        sub:
          typeof stats.gpu.temp_c === "number"
            ? `${stats.gpu.temp_c.toFixed(0)}°C · ${stats.gpu.name || "GPU"}`
            : stats.gpu.name || "GPU",
        tone: sev(load),
      });
    }
    return rows;
  }, [stats]);

  return (
    <div className="h-full min-h-0 flex flex-col px-3 py-3 gap-3">

      {!stats ? (
        <div className="flex-1 grid place-items-center text-xs text-muted-foreground">
          Acquiring telemetry…
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 place-items-center content-start py-1">
            {gauges.map((g) => (
              <RadialGauge key={g.key} gauge={g} />
            ))}
          </div>
          {stats.net && (
            <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-muted-foreground flex items-center justify-between gap-2">
              <span>Network</span>
              <span className="font-mono tabular-nums text-foreground/80">
                ↑ {stats.net.sent_mb.toFixed(1)} MB · ↓ {stats.net.recv_mb.toFixed(1)} MB
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RadialGauge({ gauge }: { gauge: Gauge }) {
  const tone = TONE[gauge.tone];
  const pct = Math.max(0, Math.min(100, gauge.pct));
  const size = RADIAL_SIZE;
  const r = (size - STROKE) / 2 - 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;

  return (
    <div className="flex flex-col items-center gap-1.5 min-w-0" title={`${gauge.label}: ${pct.toFixed(0)}%`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgba(148,163,184,0.14)"
            strokeWidth={STROKE}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={tone.stroke}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            style={{
              transition: "stroke-dasharray 0.6s ease, stroke 0.4s ease",
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className={cn("text-xl font-semibold tabular-nums leading-none", tone.text)}>
            {pct.toFixed(0)}
            <span className="text-[10px] text-muted-foreground ml-0.5">%</span>
          </span>
          <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {gauge.label}
          </span>
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground/80 truncate max-w-[9rem] text-center">
        {gauge.sub}
      </span>
    </div>
  );
}
