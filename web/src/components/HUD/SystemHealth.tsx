/**
 * System Health tile — animated radial gauges for live resources.
 */
import { useEffect, useMemo } from "react";
import { getStats } from "../../lib/api";
import { useStore } from "../../lib/store";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "crit" | "off";

type Gauge = {
  key: string;
  label: string;
  pct: number;
  sub: string;
  tone: Tone;
};

const TONE: Record<Tone, { stroke: string; glow: string; text: string }> = {
  ok: { stroke: "#22d3ee", glow: "rgba(34,211,238,0.45)", text: "text-cyan-300" },
  warn: { stroke: "#fbbf24", glow: "rgba(251,191,36,0.45)", text: "text-amber-300" },
  crit: { stroke: "#fb7185", glow: "rgba(251,113,133,0.5)", text: "text-rose-300" },
  off: { stroke: "rgba(148,163,184,0.35)", glow: "transparent", text: "text-slate-400" },
};

function sev(pct: number): Tone {
  if (pct >= 90) return "crit";
  if (pct >= 75) return "warn";
  return "ok";
}

export default function SystemHealth() {
  const stats = useStore((s) => s.stats);
  const setStats = useStore((s) => s.setStats);
  const connected = useStore((s) => s.connected);
  const health = useStore((s) => s.health);

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
    if (stats) {
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
      if (stats.battery) {
        rows.push({
          key: "batt",
          label: "PWR",
          pct: stats.battery.percent,
          sub: stats.battery.plugged ? "AC power" : "Battery",
          tone:
            stats.battery.percent < 20
              ? "crit"
              : stats.battery.percent < 40
                ? "warn"
                : "ok",
        });
      }
    }
    rows.push({
      key: "link",
      label: "LINK",
      pct: connected ? 100 : 0,
      sub: connected ? "Online" : "Offline",
      tone: connected ? "ok" : "crit",
    });
    rows.push({
      key: "ai",
      label: "AI",
      pct: health?.model?.configured ? 100 : health ? 70 : 0,
      sub: health?.model?.model || (health ? "Ready" : "Offline"),
      tone: health?.model?.configured ? "ok" : health ? "warn" : "off",
    });
    return rows;
  }, [stats, connected, health]);

  return (
    <div className="h-full min-h-0 flex flex-col px-3 py-3 gap-3">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Telemetry</p>
          <p className="text-sm font-semibold text-foreground">
            {stats?.os?.node?.split(".")[0] || "Local system"}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
            connected
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              connected ? "bg-emerald-400 animate-pulse" : "bg-rose-400",
            )}
          />
          {connected ? "Live" : "Down"}
        </span>
      </div>

      {!stats ? (
        <div className="flex-1 grid place-items-center text-xs text-muted-foreground">
          Acquiring telemetry…
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 place-items-center content-start py-1">
            {gauges.map((g) => (
              <AnimatedRadial key={g.key} gauge={g} size={g.key === "cpu" || g.key === "ram" ? 118 : 100} />
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

function AnimatedRadial({ gauge, size = 110 }: { gauge: Gauge; size?: number }) {
  const tone = TONE[gauge.tone];
  const pct = Math.max(0, Math.min(100, gauge.pct));
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;

  return (
    <div className="flex flex-col items-center gap-1.5 min-w-0" title={`${gauge.label}: ${pct.toFixed(0)}%`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id={`g-${gauge.key}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={tone.stroke} stopOpacity="1" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.85" />
            </linearGradient>
          </defs>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgba(148,163,184,0.12)"
            strokeWidth="6"
          />
          {/* Soft sweep halo */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={tone.stroke}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(10, c * 0.12)} ${c}`}
            className="opacity-30"
            style={{
              transformOrigin: `${size / 2}px ${size / 2}px`,
              animation: "spin_slow 8s linear infinite",
            }}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#g-${gauge.key})`}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            style={{
              filter: tone.glow !== "transparent" ? `drop-shadow(0 0 8px ${tone.glow})` : undefined,
              transition: "stroke-dasharray 0.7s cubic-bezier(0.22,1,0.36,1)",
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
