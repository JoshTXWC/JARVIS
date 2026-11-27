/**
 * Settings → Tracking & Precision
 * Webcam, calibration, One Euro smoothing, pinch, diagnostics, presets.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { TrackingDiagnostics } from "../../lib/hands/diagnostics";
import { listVideoInputs } from "../../lib/hands/handsPipeline";
import {
  applyPreset,
  DEFAULT_TRACKING,
  loadTrackingSettings,
  saveTrackingSettings,
  type TrackingPreset,
  type TrackingQualitySettings,
} from "../../lib/hands/trackingSettings";
import CalibrationWizard from "./CalibrationWizard";

function publish(s: TrackingQualitySettings) {
  saveTrackingSettings(s);
  window.dispatchEvent(new CustomEvent("jarvis:tracking-settings", { detail: s }));
}

export default function TrackingPrecisionPanel() {
  const [s, setS] = useState<TrackingQualitySettings>(() => loadTrackingSettings());
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [diag, setDiag] = useState<TrackingDiagnostics | null>(null);
  const [wiz, setWiz] = useState(false);

  useEffect(() => {
    void listVideoInputs().then(setDevices);
    const onDiag = (e: Event) => setDiag((e as CustomEvent).detail);
    window.addEventListener("jarvis:hands-diagnostics", onDiag);
    return () => window.removeEventListener("jarvis:hands-diagnostics", onDiag);
  }, []);

  const patch = (partial: Partial<TrackingQualitySettings>) => {
    setS((prev) => {
      const next = { ...prev, ...partial };
      if (partial.cursorFilter) {
        next.cursorFilter = { ...prev.cursorFilter, ...partial.cursorFilter };
      }
      if (partial.calibration) {
        next.calibration = { ...prev.calibration, ...partial.calibration };
      }
      publish(next);
      return next;
    });
  };

  const setPreset = (preset: TrackingPreset) => {
    setS((prev) => {
      const next = applyPreset(prev, preset);
      publish(next);
      return next;
    });
  };

  const reset = () => {
    const next = { ...DEFAULT_TRACKING, calibration: { ...DEFAULT_TRACKING.calibration } };
    setS(next);
    publish(next);
  };

  return (
    <div className="space-y-4">
      <div className="text-mono text-[9px] tracking-[0.28em] uppercase text-jarvis-cyan/45">
        Tracking & Precision
      </div>

      {/* Presets */}
      <div className="grid grid-cols-3 gap-2">
        {([
          ["fast", "Fast"],
          ["balanced", "Balanced"],
          ["precision", "Precision"],
        ] as [TrackingPreset, string][]).map(([id, label]) => (
          <Seg
            key={id}
            label={label}
            active={s.preset === id}
            onClick={() => setPreset(id)}
          />
        ))}
      </div>

      {/* Camera */}
      <Field label="Webcam">
        <select
          className="w-full rounded-lg bg-black/40 border border-jarvis-cyan/15 px-2 py-2 text-[12px] text-jarvis-ice"
          value={s.cameraDeviceId}
          onChange={(e) => patch({ cameraDeviceId: e.target.value })}
        >
          <option value="">Default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId.slice(0, 10)}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Width">
          <select
            className="w-full rounded-lg bg-black/40 border border-jarvis-cyan/15 px-2 py-2 text-[12px] text-jarvis-ice"
            value={s.captureWidth}
            onChange={(e) => {
              const w = Number(e.target.value);
              patch({ captureWidth: w, captureHeight: w >= 1920 ? 1080 : 720 });
            }}
          >
            <option value={1280}>1280</option>
            <option value={1920}>1920</option>
          </select>
        </Field>
        <Field label="FPS">
          <select
            className="w-full rounded-lg bg-black/40 border border-jarvis-cyan/15 px-2 py-2 text-[12px] text-jarvis-ice"
            value={s.captureFps}
            onChange={(e) => patch({ captureFps: Number(e.target.value) })}
          >
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </Field>
        <Field label="Hand">
          <select
            className="w-full rounded-lg bg-black/40 border border-jarvis-cyan/15 px-2 py-2 text-[12px] text-jarvis-ice"
            value={s.primaryHand}
            onChange={(e) =>
              patch({ primaryHand: e.target.value as "right" | "left" })
            }
          >
            <option value="right">Right</option>
            <option value="left">Left</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Seg label="Calibrate…" active={false} onClick={() => setWiz(true)} />
        <Seg label="Reset defaults" active={false} onClick={reset} />
      </div>

      <Slider
        label="Cursor sensitivity X"
        value={s.sensX}
        min={0.5}
        max={2}
        step={0.05}
        onChange={(v) => patch({ sensX: v })}
      />
      <Slider
        label="Cursor sensitivity Y"
        value={s.sensY}
        min={0.5}
        max={2}
        step={0.05}
        onChange={(v) => patch({ sensY: v })}
      />
      <Slider
        label="Edge compensation"
        value={s.edgeCompress}
        min={0}
        max={0.6}
        step={0.05}
        onChange={(v) => patch({ edgeCompress: v })}
      />

      <div className="text-mono text-[9px] tracking-[0.22em] uppercase text-jarvis-cyan/40 pt-1">
        Adaptive smoothing (One Euro)
      </div>
      <Slider
        label="Min cutoff"
        value={s.cursorFilter.minCutoff}
        min={0.4}
        max={4}
        step={0.1}
        onChange={(v) => patch({ cursorFilter: { ...s.cursorFilter, minCutoff: v } })}
      />
      <Slider
        label="Speed β"
        value={s.cursorFilter.beta}
        min={0.005}
        max={0.12}
        step={0.005}
        onChange={(v) => patch({ cursorFilter: { ...s.cursorFilter, beta: v } })}
      />
      <Slider
        label="Dead zone"
        value={s.cursorFilter.deadZone}
        min={0}
        max={1.2}
        step={0.05}
        onChange={(v) => patch({ cursorFilter: { ...s.cursorFilter, deadZone: v } })}
      />
      <Slider
        label="Max jump"
        value={s.cursorFilter.maxJump}
        min={40}
        max={400}
        step={10}
        onChange={(v) => patch({ cursorFilter: { ...s.cursorFilter, maxJump: v } })}
      />

      <div className="text-mono text-[9px] tracking-[0.22em] uppercase text-jarvis-cyan/40 pt-1">
        Pinch & drag
      </div>
      <Slider
        label="Pinch activate"
        value={s.pinchActivate}
        min={0.15}
        max={0.45}
        step={0.01}
        onChange={(v) => patch({ pinchActivate: v })}
      />
      <Slider
        label="Pinch release"
        value={s.pinchRelease}
        min={0.2}
        max={0.55}
        step={0.01}
        onChange={(v) => patch({ pinchRelease: v })}
      />
      <Slider
        label="Drag arm (ms)"
        value={s.dragArmMs}
        min={200}
        max={800}
        step={20}
        onChange={(v) => patch({ dragArmMs: v })}
      />
      <Slider
        label="Drag move (px)"
        value={s.dragMovePx}
        min={10}
        max={60}
        step={2}
        onChange={(v) => patch({ dragMovePx: v })}
      />
      <Slider
        label="Tracking confidence"
        value={s.confidenceMin}
        min={0.2}
        max={0.8}
        step={0.05}
        onChange={(v) => patch({ confidenceMin: v })}
      />

      <div className="grid grid-cols-2 gap-2">
        <Seg
          label={s.showQualityViz ? "Quality viz on" : "Quality viz off"}
          active={s.showQualityViz}
          onClick={() => patch({ showQualityViz: !s.showQualityViz })}
        />
        <Seg
          label={s.showDiagnostics ? "Diagnostics on" : "Diagnostics off"}
          active={s.showDiagnostics}
          onClick={() => patch({ showDiagnostics: !s.showDiagnostics })}
        />
      </div>

      {s.showDiagnostics && diag && (
        <div
          className="rounded-xl px-3 py-3 text-[11px] text-mono space-y-1"
          style={{ background: "rgba(8,14,26,0.5)", boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.12)" }}
        >
          <Row k="Camera FPS" v={String(diag.cameraFps)} />
          <Row k="Infer FPS" v={String(diag.inferenceFps)} />
          <Row k="Infer ms" v={String(diag.avgInferenceMs)} />
          <Row k="Latency est." v={`${diag.captureToCursorMs} ms`} />
          <Row k="Drops" v={String(diag.frameDrops)} />
          <Row k="Quality" v={String(diag.trackingQuality)} />
          <Row k="Stability" v={String(diag.cursorStability)} />
          <Row k="Resolution" v={diag.resolution} />
          <Row k="Delegate" v={diag.delegate} />
          <Row k="Camera" v={diag.cameraLabel.slice(0, 28)} />
        </div>
      )}

      <p className="text-[10px] text-jarvis-ice/35 leading-snug">
        Camera / resolution changes apply the next time Hands starts. Smoothing and pinch update live.
      </p>

      <CalibrationWizard
        open={wiz}
        onClose={() => setWiz(false)}
        onSaved={(next) => {
          setS(next);
          setWiz(false);
        }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="text-mono text-[9px] tracking-[0.2em] uppercase text-jarvis-cyan/40 mb-1.5">
        {label}
      </div>
      {children}
    </label>
  );
}

function Seg({
  label, active, onClick,
}: {
  label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl px-2 py-3 text-mono text-[10px] tracking-[0.14em] uppercase transition-all"
      style={{
        background: active ? "rgba(125,211,252,0.2)" : "rgba(8,14,26,0.4)",
        boxShadow: active
          ? "inset 0 0 0 1px rgba(125,211,252,0.5)"
          : "inset 0 0 0 1px rgba(125,211,252,0.12)",
        color: active ? "rgba(224,242,254,0.95)" : "rgba(186,230,253,0.45)",
      }}
    >
      {label}
    </button>
  );
}

function Slider({
  label, value, min, max, step, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label
      className="block rounded-xl px-3 py-2.5"
      style={{ background: "rgba(8,14,26,0.35)", boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.1)" }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-mono text-[9px] tracking-[0.18em] uppercase text-jarvis-cyan/45">{label}</span>
        <span className="text-mono text-[11px] text-jarvis-ice/80">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-cyan-300 h-2"
      />
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-jarvis-ice/70">
      <span className="text-jarvis-cyan/40">{k}</span>
      <span className="truncate">{v}</span>
    </div>
  );
}
