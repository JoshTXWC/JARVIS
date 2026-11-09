/**
 * Settings → Hands / Desktop — big interactive controls, minimal copy.
 */
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/session";
import {
  requestDesktopOverlay,
  sendDesktopControlAction,
  setDesktopInjectArmed,
} from "../../lib/hands/desktopBridge";
import { useStore } from "../../lib/store";
import TrackingPrecisionPanel from "./TrackingPrecisionPanel";

type Mode = "hud" | "precision" | "spatial";
type Viz = "skeleton" | "minimal" | "hidden";

export default function DesktopControlSettings() {
  const gestureEnabled = useStore((s) => s.gestureEnabled);
  const setGestureEnabled = useStore((s) => s.setGestureEnabled);
  const gestureStatus = useStore((s) => s.gestureStatus);
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

  const [sensitivity, setSensitivity] = useState(1);
  const [smoothing, setSmoothing] = useState(0.35);
  const [busy, setBusy] = useState(false);
  const inElectron = typeof window !== "undefined" && !!window.jarvis?.send;

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
      window.jarvis?.send?.("jarvis:desktop-overlay-meta", {
        mode: j?.mode ?? mode,
        viz_mode: viz,
        paused: j?.paused ?? paused,
        gesture: j?.gesture ?? gesture,
      });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const armDesktop = async (v: boolean) => {
    if (v) {
      if (!gestureEnabled) setGestureEnabled(true);
      setOverlay(true);
      setMode("precision");
      setPaused(false);
      setEnabled(true);
      setDesktopInjectArmed(true);
      sendDesktopControlAction("enable", { enabled: true });
      sendDesktopControlAction("mode", { mode: "precision" });
      await apply({
        enabled: true,
        overlay_enabled: true,
        mode: "precision",
        viz_mode: "skeleton",
      });
      requestDesktopOverlay(true);
      window.jarvis?.send?.("jarvis:desktop-overlay-meta", {
        mode: "precision",
        viz_mode: "skeleton",
        paused: false,
        gesture: "armed",
      });
      return;
    }
    setEnabled(false);
    setDesktopInjectArmed(false);
    sendDesktopControlAction("enable", { enabled: false });
    await apply({ enabled: false });
    requestDesktopOverlay(false);
  };

  const changeMode = async (m: Mode) => {
    setMode(m);
    sendDesktopControlAction("mode", { mode: m });
    await apply({ mode: m });
  };

  const live = gestureEnabled
    ? gesture || gestureStatus || "tracking"
    : "hands off";

  return (
    <div className="space-y-4">
      {/* Status strip */}
      <div className="grid grid-cols-3 gap-2">
        <StatusPill
          label="Bridge"
          value={inElectron ? "Electron" : "Browser"}
          ok={inElectron}
        />
        <StatusPill label="Hands" value={gestureEnabled ? "On" : "Off"} ok={gestureEnabled} />
        <StatusPill label="Track" value={String(live).slice(0, 14)} ok={!!gesture && gesture !== "lost" && gesture !== "seeking"} />
      </div>

      {!inElectron && (
        <div
          className="rounded-xl px-3 py-3 text-[12px] text-amber-100/90"
          style={{ background: "rgba(251,191,36,0.12)", boxShadow: "inset 0 0 0 1px rgba(251,191,36,0.35)" }}
        >
          Use <span className="text-mono">run-app.bat</span> for desktop overlay.
        </div>
      )}

      {/* Primary actions */}
      <div className="grid grid-cols-2 gap-2">
        <BigToggle
          label="Hands"
          active={gestureEnabled}
          onClick={() => setGestureEnabled(!gestureEnabled)}
        />
        <BigToggle
          label="Desktop"
          active={enabled}
          onClick={() => void armDesktop(!enabled)}
          disabled={busy || !inElectron}
        />
      </div>

      {/* Mode — HUD tiles vs combined desktop Control (mouse + windows) */}
      <div>
        <div className="text-mono text-[9px] tracking-[0.28em] uppercase text-jarvis-cyan/45 mb-2">
          Mode
        </div>
        <div className="grid grid-cols-2 gap-2">
          <SegBtn
            label="HUD"
            active={mode === "hud"}
            disabled={!enabled || busy}
            onClick={() => void changeMode("hud")}
          />
          <SegBtn
            label="Control"
            active={mode === "precision" || mode === "spatial"}
            disabled={!enabled || busy}
            onClick={() => void changeMode("precision")}
          />
        </div>
        <p className="mt-2 text-[11px] text-jarvis-ice/45 leading-snug">
          Index tip cursor · approach locks · short pinch=click · hold+move=drag · 2×pinch=right · fist=window · 2 fing=scroll
        </p>
      </div>

      {/* Overlay viz */}
      <div>
        <div className="text-mono text-[9px] tracking-[0.28em] uppercase text-jarvis-cyan/45 mb-2">
          Overlay
        </div>
        <div className="grid grid-cols-4 gap-2">
          <SegBtn
            label={overlay ? "Show" : "Hide"}
            active={overlay}
            onClick={() => {
              const next = !overlay;
              setOverlay(next);
              if (next) requestDesktopOverlay(true);
              else requestDesktopOverlay(false);
              void apply({ overlay_enabled: next });
            }}
          />
          {([
            ["skeleton", "Full"],
            ["minimal", "Dot"],
            ["hidden", "Off"],
          ] as [Viz, string][]).map(([id, label]) => (
            <SegBtn
              key={id}
              label={label}
              active={viz === id}
              onClick={() => {
                setViz(id);
                void apply({ viz_mode: id });
                window.jarvis?.send?.("jarvis:desktop-overlay-meta", { viz_mode: id });
              }}
            />
          ))}
        </div>
      </div>

      {/* Legacy backend feel (WS path) — primary tuning is Tracking & Precision */}
      <div className="space-y-3">
        <SliderRow
          label="Backend sensitivity"
          value={sensitivity}
          min={0.4}
          max={2.2}
          step={0.05}
          onChange={setSensitivity}
          onCommit={(v) => void apply({ sensitivity: v })}
        />
        <SliderRow
          label="Backend smooth"
          value={smoothing}
          min={0}
          max={0.85}
          step={0.05}
          onChange={setSmoothing}
          onCommit={(v) => void apply({ smoothing: v })}
        />
      </div>

      <TrackingPrecisionPanel />

      <div className="grid grid-cols-2 gap-2">
        <SegBtn
          label={paused ? "Resume" : "Pause"}
          active={paused}
          onClick={() => {
            const next = !paused;
            setPaused(next);
            sendDesktopControlAction("pause", { paused: next });
          }}
        />
        <SegBtn
          label="E-Stop"
          danger
          active={false}
          onClick={() => {
            setPaused(true);
            sendDesktopControlAction("emergency_stop");
          }}
        />
      </div>
    </div>
  );
}

function StatusPill({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div
      className="rounded-xl px-2.5 py-2.5 min-w-0"
      style={{
        background: "rgba(8,14,26,0.55)",
        boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.14)",
      }}
    >
      <div className="text-[8px] text-mono tracking-[0.22em] uppercase text-jarvis-cyan/40">{label}</div>
      <div className={`mt-1 text-[12px] text-mono truncate ${ok ? "text-emerald-200/90" : "text-jarvis-ice/55"}`}>
        {value}
      </div>
    </div>
  );
}

function BigToggle({
  label, active, onClick, disabled,
}: {
  label: string; active: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-2xl px-3 py-5 text-left transition-all disabled:opacity-40"
      style={{
        background: active
          ? "linear-gradient(160deg, rgba(34,211,238,0.28), rgba(8,14,26,0.55))"
          : "rgba(8,14,26,0.45)",
        boxShadow: active
          ? "inset 0 0 0 1px rgba(125,211,252,0.55), 0 0 24px rgba(34,211,238,0.12)"
          : "inset 0 0 0 1px rgba(125,211,252,0.14)",
      }}
    >
      <div className="text-mono text-[10px] tracking-[0.28em] uppercase text-jarvis-cyan/50">{label}</div>
      <div className={`mt-2 text-[20px] text-display tracking-[0.12em] ${active ? "text-jarvis-ice" : "text-jarvis-ice/40"}`}>
        {active ? "ON" : "OFF"}
      </div>
    </button>
  );
}

function SegBtn({
  label, active, onClick, disabled, danger,
}: {
  label: string; active: boolean; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-xl px-2 py-3 text-mono text-[10px] tracking-[0.16em] uppercase transition-all disabled:opacity-35"
      style={{
        background: danger
          ? "rgba(251,113,133,0.14)"
          : active
            ? "rgba(125,211,252,0.2)"
            : "rgba(8,14,26,0.4)",
        boxShadow: danger
          ? "inset 0 0 0 1px rgba(251,113,133,0.4)"
          : active
            ? "inset 0 0 0 1px rgba(125,211,252,0.5)"
            : "inset 0 0 0 1px rgba(125,211,252,0.12)",
        color: danger ? "rgba(254,205,211,0.95)" : active ? "rgba(224,242,254,0.95)" : "rgba(186,230,253,0.45)",
      }}
    >
      {label}
    </button>
  );
}

function SliderRow({
  label, value, min, max, step, onChange, onCommit,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; onCommit: (v: number) => void;
}) {
  return (
    <label className="block rounded-xl px-3 py-3" style={{ background: "rgba(8,14,26,0.35)", boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.1)" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-mono text-[9px] tracking-[0.22em] uppercase text-jarvis-cyan/45">{label}</span>
        <span className="text-mono text-[11px] text-jarvis-ice/80">{value.toFixed(2)}</span>
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
        className="w-full accent-cyan-300 h-2"
      />
    </label>
  );
}
