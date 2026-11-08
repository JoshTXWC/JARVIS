/**
 * SYSTEM STATUS — resource metrics, subsystem rows, overall health.
 */
import { useEffect } from "react";
import { useStore } from "../../lib/store";
import { getStats } from "../../lib/api";

type Tone = "ok" | "warn" | "crit" | "off";

interface Metric {
  key: string;
  label: string;
  pct: number;
  tone: Tone;
}

interface Subsystem {
  key: string;
  label: string;
  status: string;
  tone: Tone;
}

const TONE_TEXT: Record<Tone, string> = {
  ok:   "text-jarvis-ok",
  warn: "text-jarvis-warn",
  crit: "text-jarvis-danger",
  off:  "text-jarvis-ice/40",
};

const TONE_GLOW: Record<Tone, string> = {
  ok:   "0 0 10px rgba(74,222,128,0.55)",
  warn: "0 0 10px rgba(251,191,36,0.55)",
  crit: "0 0 10px rgba(251,113,133,0.55)",
  off:  "none",
};

const TONE_DOT: Record<Tone, string> = {
  ok:   "bg-jarvis-ok shadow-[0_0_8px_rgba(74,222,128,0.7)]",
  warn: "bg-jarvis-warn shadow-[0_0_8px_rgba(251,191,36,0.7)]",
  crit: "bg-jarvis-danger shadow-[0_0_8px_rgba(251,113,133,0.7)]",
  off:  "bg-jarvis-ice/30",
};

function sev(pct: number): Tone {
  if (pct >= 90) return "crit";
  if (pct >= 70) return "warn";
  return "ok";
}

export default function DiagPanel() {
  const stats = useStore((s) => s.stats);
  const setStats = useStore((s) => s.setStats);
  const health = useStore((s) => s.health);
  const tools = useStore((s) => s.tools);
  const connected = useStore((s) => s.connected);

  useEffect(() => {
    let live = true;
    let id = 0;
    const tick = async () => {
      if (document.hidden) return; // idle tab — don't hammer /api/stats (GPU counters)
      try {
        const s = await getStats();
        if (live) setStats(s);
      } catch { /* ignore */ }
    };
    const arm = () => {
      if (id) window.clearInterval(id);
      id = window.setInterval(tick, 4000);
    };
    tick();
    arm();
    const onVis = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      if (id) window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [setStats]);

  if (!stats) {
    return (
      <div className="holo-panel px-3 py-6 text-center text-mono text-xs text-jarvis-cyan/50">
        acquiring telemetry…
      </div>
    );
  }

  const gpuAvailable = !!stats.gpu?.available;
  const gpuLoad = stats.gpu?.load_percent ?? 0;

  const metrics: Metric[] = [
    { key: "cpu",  label: "CPU",  pct: stats.cpu,          tone: sev(stats.cpu) },
    { key: "ram",  label: "RAM",  pct: stats.ram.percent,  tone: sev(stats.ram.percent) },
    { key: "disk", label: "DISK", pct: stats.disk.percent, tone: sev(stats.disk.percent) },
    {
      key: "gpu",
      label: "GPU",
      pct: gpuAvailable ? gpuLoad : 0,
      tone: gpuAvailable ? sev(gpuLoad) : "off",
    },
  ];

  const running = tools.filter((t) => t.status === "running").length;
  const battery = stats.battery;
  const battPct = battery?.percent ?? 100;

  let powerStatus = "Stable";
  let powerTone: Tone = "ok";
  if (battery && !battery.plugged) {
    if (battPct < 20) { powerStatus = "Critical"; powerTone = "crit"; }
    else if (battPct < 40) { powerStatus = "Low"; powerTone = "warn"; }
    else { powerStatus = "Stable"; powerTone = "ok"; }
  }

  let linkStatus = "Online";
  let linkTone: Tone = "ok";
  if (!connected) { linkStatus = "Down"; linkTone = "crit"; }
  else if (!health) { linkStatus = "Degraded"; linkTone = "warn"; }

  let busStatus = "Online";
  let busTone: Tone = "ok";
  if (running > 3) { busStatus = "Busy"; busTone = "warn"; }
  else if (running > 0) { busStatus = "Active"; busTone = "ok"; }

  const subsystems: Subsystem[] = [
    {
      key: "ai",
      label: "AI",
      status: health ? "Good" : "Offline",
      tone: health ? "ok" : "off",
    },
    { key: "link", label: "LINK", status: linkStatus, tone: linkTone },
    { key: "bus", label: "BUS", status: busStatus, tone: busTone },
    { key: "power", label: "POWER", status: powerStatus, tone: powerTone },
  ];

  const tones = [...metrics.map((m) => m.tone), ...subsystems.map((s) => s.tone)];
  const overall: Tone = tones.includes("crit")
    ? "crit"
    : tones.includes("warn")
      ? "warn"
      : tones.includes("off")
        ? "warn"
        : "ok";
  const overallLabel =
    overall === "ok" ? "Good" : overall === "warn" ? "Degraded" : "Critical";

  return (
    <div className="holo-panel flex flex-col w-full overflow-hidden">
      {/* Header */}
      <div className="relative z-[2] flex items-center gap-2 px-3 pt-3 pb-2 shrink-0">
        <PulseIcon />
        <span className="text-[15px] font-semibold tracking-wide text-white/95">
          System Status
        </span>
      </div>

      <div className="relative z-[2] px-3 pb-3 flex flex-col">
        {/* Resource metrics */}
        <div className="space-y-2 py-0.5">
          {metrics.map((m) => (
            <div key={m.key} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0"> 
                <span className="text-[13px] font-medium tracking-[0.06em] text-white/90 uppercase">
                  {m.label}
                </span>
              </div>
              <span
                className={`text-[13px] font-semibold tabular-nums ${TONE_TEXT[m.tone]}`}
                style={{ textShadow: TONE_GLOW[m.tone] }}
              >
                {gpuAvailable || m.key !== "gpu" ? `${Math.round(m.pct)}%` : "n/a"}
              </span>
            </div>
          ))}
        </div>

        <Divider />

        {/* Subsystems — always expanded */}
        <div className="space-y-2 py-0.5">
          {subsystems.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">             
                <span className="text-[13px] font-medium tracking-[0.06em] text-white/90 uppercase">
                  {s.label}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[13px] font-semibold tabular-nums ${TONE_TEXT[s.tone]}`}
                  style={{ textShadow: TONE_GLOW[s.tone] }}
                >
                  {s.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        <Divider />

        {/* Overall health */}
        <div className="flex items-center gap-2.5 pt-0.5">
          <HealthBadge tone={overall} />
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-white/90 leading-tight">
              System Health
            </div>
            <div
              className={`text-[18px] font-bold leading-tight ${TONE_TEXT[overall]}`}
              style={{ textShadow: TONE_GLOW[overall] }}
            >
              {overallLabel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div
      className="my-2.5 h-px w-full shrink-0"
      style={{
        background:
          "linear-gradient(90deg, transparent, rgba(186,230,253,0.22) 20%, rgba(186,230,253,0.22) 80%, transparent)",
      }}
    />
  );
}

function Diamond() {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rotate-45 shrink-0"
      style={{
        background: "rgba(125,211,252,0.95)",
        boxShadow: "0 0 6px rgba(125,211,252,0.7)",
      }}
    />
  );
}

function Chevron() {
  return (
    <svg width="8" height="10" viewBox="0 0 8 10" className="text-jarvis-cyan/55 shrink-0" aria-hidden>
      <path d="M2 1.5L5.5 5L2 8.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" className="text-jarvis-cyan shrink-0" aria-hidden
      style={{ filter: "drop-shadow(0 0 4px rgba(125,211,252,0.7))" }}>
      <path
        d="M1 7h3l1.5-3.5L8 11l2-7 1.5 3.5H17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HealthBadge({ tone }: { tone: Tone }) {
  const stroke =
    tone === "ok" ? "#4ade80" : tone === "warn" ? "#fbbf24" : "#fb7185";
  return (
    <div
      className="relative w-9 h-9 rounded-full grid place-items-center shrink-0"
      style={{
        background: "rgba(125,211,252,0.08)",
        boxShadow: `0 0 0 1.5px rgba(125,211,252,0.45), 0 0 16px rgba(125,211,252,0.25)`,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden
        style={{ filter: `drop-shadow(0 0 4px ${stroke})` }}>
        <path
          d="M12 3l7 3v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3z"
          stroke="rgba(125,211,252,0.95)"
          strokeWidth="1.6"
          fill="rgba(125,211,252,0.06)"
        />
        {tone === "crit" ? (
          <path d="M12 8v5M12 15.5v.5" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
        ) : (
          <path d="M8.5 12.2l2.2 2.3 4.8-5" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </div>
  );
}
