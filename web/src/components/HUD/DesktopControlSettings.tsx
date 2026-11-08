/**
 * Settings → Barehands Desktop Control (opt-in, off by default).
 */
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/session";
import {
  requestDesktopOverlay,
  sendDesktopControlAction,
} from "../../lib/hands/desktopBridge";
import { useStore } from "../../lib/store";

type Mode = "hud" | "precision" | "spatial";
type Viz = "skeleton" | "minimal" | "hidden";

export default function DesktopControlSettings() {
  const gestureEnabled = useStore((s) => s.gestureEnabled);
  const setGestureEnabled = useStore((s) => s.setGestureEnabled);
  const enabled = useStore((s) => s.desktopControlEnabled);
  const setEnabled = useStore((s) => s.setDesktopControlEnabled);
  const mode = useStore((s) => s.desktopControlMode);
  const setMode = useStore((s) => s.setDesktopControlMode);
  const overlay = useStore((s) => s.desktopOverlayEnabled);
  const setOverlay = useStore((s) => s.setDesktopOverlayEnabled);
  const viz = useStore((s) => s.desktopVizMode);
  const setViz = useStore((s) => s.setDesktopVizMode);
  const paused = useStore((s) => s.desktopPaused);
  const setPaused = useStore((s) => s.setDesktopPaused);
  const gesture = useStore((s) => s.desktopGesture);
  const calibrating = useStore((s) => s.desktopCalibrating);
  const setCalibrating = useStore((s) => s.setDesktopCalibrating);

  const [sensitivity, setSensitivity] = useState(1);
  const [smoothing, setSmoothing] = useState(0.35);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiFetch("/api/desktop-control/status")
      .then((r) => r.json())
      .then((j) => {
        if (j?.settings) {
          setSensitivity(Number(j.settings.sensitivity ?? 1));
          setSmoothing(Number(j.settings.smoothing ?? 0.35));
        }
        if (typeof j?.enabled === "boolean") setEnabled(j.enabled);
        if (j?.mode) setMode(j.mode);
      })
      .catch(() => undefined);
  }, [setEnabled, setMode]);

  const apply = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await apiFetch("/api/desktop-control/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch }),
      });
      const j = await r.json();
      setStatus(j?.enabled ? `mode=${j.mode}` : "disabled");
      if (window.jarvis?.send) {
        window.jarvis.send("jarvis:desktop-overlay-meta", {
          mode: j?.mode,
          viz_mode: viz,
          overlay_opacity: 0.85,
          paused: j?.paused,
          gesture: j?.gesture,
        });
      }
    } catch (e: any) {
      setStatus(e?.message || "update failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (v: boolean) => {
    if (v && !gestureEnabled) setGestureEnabled(true);
    setEnabled(v);
    sendDesktopControlAction("enable", { enabled: v });
    await apply({ enabled: v });
    if (v && overlay) requestDesktopOverlay(true);
    if (!v) requestDesktopOverlay(false);
  };

  const changeMode = async (m: Mode) => {
    setMode(m);
    sendDesktopControlAction("mode", { mode: m });
    await apply({ mode: m });
  };

  const runCalibration = async () => {
    setCalibrating(true);
    // Comfortable default active region — interactive wizard can refine later.
    await apply({
      calibration: { x0: 0.18, y0: 0.12, x1: 0.82, y1: 0.88 },
    });
    setStatus("calibration region set — move hand in view to test");
    setTimeout(() => setCalibrating(false), 1200);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-jarvis-ice/45 leading-relaxed">
        System-wide Windows control via the same Hands webcam pipeline. Opt-in,
        local-only, and off by default. Emergency stop: Ctrl+Shift+Alt+Esc.
      </p>

      <Toggle
        label="Enable desktop control"
        hint={status || (enabled ? "injection armed" : "disabled")}
        value={enabled}
        onChange={(v) => void toggleEnabled(v)}
        disabled={busy}
      />

      <div className="grid grid-cols-3 gap-1.5">
        {([
          ["hud", "HUD"],
          ["precision", "Precision"],
          ["spatial", "Spatial"],
        ] as [Mode, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={!enabled || busy}
            onClick={() => void changeMode(id)}
            className={`rounded-md px-2 py-2 text-mono text-[9px] tracking-[0.16em] uppercase transition-colors disabled:opacity-40 ${
              mode === id ? "text-jarvis-ice" : "text-jarvis-ice/50 hover:text-jarvis-ice/80"
            }`}
            style={{
              background:
                mode === id ? "rgba(125,211,252,0.16)" : "rgba(8,14,26,0.4)",
              boxShadow:
                mode === id
                  ? "inset 0 0 0 1px rgba(125,211,252,0.45)"
                  : "inset 0 0 0 1px rgba(125,211,252,0.12)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <Toggle
        label="Floating overlay"
        hint="Click-through skeleton across the desktop"
        value={overlay}
        onChange={(v) => {
          setOverlay(v);
          if (enabled && v) requestDesktopOverlay(true);
          else requestDesktopOverlay(false);
          void apply({ overlay_enabled: v });
        }}
      />

      <div className="grid grid-cols-3 gap-1.5">
        {([
          ["skeleton", "Skeleton"],
          ["minimal", "Cursor"],
          ["hidden", "Hidden"],
        ] as [Viz, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setViz(id);
              void apply({ viz_mode: id });
              window.jarvis?.send?.("jarvis:desktop-overlay-meta", { viz_mode: id });
            }}
            className={`rounded-md px-2 py-1.5 text-mono text-[9px] tracking-[0.14em] uppercase ${
              viz === id ? "text-jarvis-ice" : "text-jarvis-ice/45"
            }`}
            style={{
              boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.16)",
              background: viz === id ? "rgba(125,211,252,0.12)" : "transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <Slider
        label={`Sensitivity ${sensitivity.toFixed(2)}`}
        min={0.4}
        max={2.2}
        step={0.05}
        value={sensitivity}
        onChange={setSensitivity}
        onCommit={(v) => void apply({ sensitivity: v })}
      />
      <Slider
        label={`Smoothing ${smoothing.toFixed(2)}`}
        min={0}
        max={0.85}
        step={0.05}
        value={smoothing}
        onChange={setSmoothing}
        onCommit={(v) => void apply({ smoothing: v })}
      />

      <div className="flex gap-1.5">
        <Action
          label={paused ? "Resume" : "Pause"}
          onClick={() => {
            const next = !paused;
            setPaused(next);
            sendDesktopControlAction("pause", { paused: next });
          }}
        />
        <Action
          label={calibrating ? "Calibrating…" : "Quick calibrate"}
          onClick={() => void runCalibration()}
        />
        <Action
          label="E-Stop"
          danger
          onClick={() => {
            setPaused(true);
            sendDesktopControlAction("emergency_stop");
          }}
        />
      </div>

      <p className="text-[10px] text-jarvis-ice/35 leading-relaxed">
        Live gesture: <span className="text-jarvis-cyan/70">{gesture || "—"}</span>
        {" · "}
        Shortcuts: Ctrl+Shift+Alt+M mode · P pause · Esc emergency
      </p>
    </div>
  );
}

function Toggle({
  label, hint, value, onChange, disabled,
}: {
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left disabled:opacity-40"
      style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.14)", background: "rgba(8,14,26,0.35)" }}
    >
      <span>
        <span className="block text-[12px] text-jarvis-ice/85">{label}</span>
        {hint && <span className="block text-[10px] text-jarvis-ice/40 mt-0.5">{hint}</span>}
      </span>
      <span
        className="w-9 h-5 rounded-full relative shrink-0"
        style={{
          background: value ? "rgba(34,211,238,0.45)" : "rgba(255,255,255,0.08)",
          boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.25)",
        }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-jarvis-ice/90 transition-all"
          style={{ left: value ? "18px" : "2px" }}
        />
      </span>
    </button>
  );
}

function Slider({
  label, min, max, step, value, onChange, onCommit,
}: {
  label: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void; onCommit: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="text-[10px] text-mono tracking-[0.16em] uppercase text-jarvis-cyan/45 mb-1">
        {label}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="w-full accent-cyan-300"
      />
    </label>
  );
}

function Action({
  label, onClick, danger,
}: {
  label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md px-2 py-2 text-mono text-[9px] tracking-[0.14em] uppercase ${
        danger ? "text-rose-200/90" : "text-jarvis-ice/75"
      }`}
      style={{
        boxShadow: danger
          ? "inset 0 0 0 1px rgba(251,113,133,0.35)"
          : "inset 0 0 0 1px rgba(125,211,252,0.2)",
        background: danger ? "rgba(251,113,133,0.1)" : "rgba(8,14,26,0.4)",
      }}
    >
      {label}
    </button>
  );
}
