/**
 * Nine-point cursor calibration wizard for Barehands desktop control.
 * Maps comfortable hand motion → Windows desktop without forcing a homography
 * when samples are non-planar.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cameraToControl,
  fitAffine,
  type CalibrationRect,
  type Pt,
} from "../../lib/hands/coords";
import {
  loadTrackingSettings,
  saveCalibrationProfile,
  saveTrackingSettings,
  type TrackingQualitySettings,
} from "../../lib/hands/trackingSettings";

type Step =
  | "camera"
  | "hand"
  | "monitor"
  | "targets"
  | "review"
  | "test";

type Sample = {
  id: string;
  label: string;
  /** Target desktop UV. */
  target: Pt;
  /** Stable fingertip in camera space (pre-mirror). */
  camera?: Pt;
  /** Filtered control UV at capture. */
  control?: Pt;
};

const NINE: Array<{ id: string; label: string; target: Pt }> = [
  { id: "c", label: "Center", target: { x: 0.5, y: 0.5 } },
  { id: "tl", label: "Top-left", target: { x: 0.08, y: 0.08 } },
  { id: "t", label: "Top", target: { x: 0.5, y: 0.08 } },
  { id: "tr", label: "Top-right", target: { x: 0.92, y: 0.08 } },
  { id: "l", label: "Left", target: { x: 0.08, y: 0.5 } },
  { id: "r", label: "Right", target: { x: 0.92, y: 0.5 } },
  { id: "bl", label: "Bottom-left", target: { x: 0.08, y: 0.92 } },
  { id: "b", label: "Bottom", target: { x: 0.5, y: 0.92 } },
  { id: "br", label: "Bottom-right", target: { x: 0.92, y: 0.92 } },
];

type LiveTip = {
  raw: Pt | null;
  filtered: Pt | null;
  camera: Pt | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (s: TrackingQualitySettings) => void;
};

export default function CalibrationWizard({ open, onClose, onSaved }: Props) {
  const [step, setStep] = useState<Step>("camera");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [hand, setHand] = useState<"right" | "left">("right");
  const [monitor, setMonitor] = useState<"virtual" | "primary">("virtual");
  const [samples, setSamples] = useState<Sample[]>(
    NINE.map((n) => ({ ...n })),
  );
  const [idx, setIdx] = useState(0);
  const [live, setLive] = useState<LiveTip>({ raw: null, filtered: null, camera: null });
  const [margins, setMargins] = useState({ x0: 0.12, y0: 0.08, x1: 0.88, y1: 0.92 });
  const [sensX, setSensX] = useState(1);
  const [sensY, setSensY] = useState(1);
  const [residual, setResidual] = useState<number | null>(null);
  const [affineOn, setAffineOn] = useState(false);
  const stableRef = useRef<Pt[]>([]);

  useEffect(() => {
    if (!open) return;
    const s = loadTrackingSettings();
    setDeviceId(s.cameraDeviceId);
    setHand(s.primaryHand);
    setMonitor(s.monitorPolicy === "primary" ? "primary" : "virtual");
    setMargins({ ...s.calibration });
    setSensX(s.sensX);
    setSensY(s.sensY);
    setStep("camera");
    setSamples(NINE.map((n) => ({ ...n })));
    setIdx(0);
    setResidual(null);
    void navigator.mediaDevices?.enumerateDevices?.().then((all) => {
      setDevices(all.filter((d) => d.kind === "videoinput"));
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPtr = (e: Event) => {
      const d = (e as CustomEvent).detail as { x?: number; y?: number };
      if (d?.x == null || d.y == null || d.x < 0) {
        setLive({ raw: null, filtered: null, camera: null });
        return;
      }
      // HUD tip is preview space — store as "filtered" preview for live viz.
      const filtered = { x: d.x / window.innerWidth, y: d.y / window.innerHeight };
      setLive((prev) => ({
        raw: filtered,
        filtered,
        camera: prev.camera,
      }));
      stableRef.current.push(filtered);
      if (stableRef.current.length > 18) stableRef.current.shift();
    };
    // Prefer packaged landmarks from overlay publish for camera-space samples.
    const onFrame = (e: Event) => {
      const frame = (e as CustomEvent).detail as {
        hands?: Array<Array<[number, number, number]>>;
      };
      const tip = frame?.hands?.[0]?.[8];
      if (tip) {
        setLive((prev) => ({
          ...prev,
          camera: { x: tip[0], y: tip[1] },
        }));
      }
    };
    window.addEventListener("jarvis:hands-pointer", onPtr);
    window.addEventListener("jarvis:hands-frame-local", onFrame);
    return () => {
      window.removeEventListener("jarvis:hands-pointer", onPtr);
      window.removeEventListener("jarvis:hands-frame-local", onFrame);
    };
  }, [open]);

  const current = samples[idx];

  const captureStable = () => {
    const cam = live.camera;
    if (!cam) return;
    const buf = stableRef.current;
    if (buf.length < 8) return;
    const avg = buf.reduce(
      (a, p) => ({ x: a.x + p.x, y: a.y + p.y }),
      { x: 0, y: 0 },
    );
    const mean = { x: avg.x / buf.length, y: avg.y / buf.length };
    const jitter = buf.reduce(
      (s, p) => s + Math.hypot(p.x - mean.x, p.y - mean.y),
      0,
    ) / buf.length;
    if (jitter > 0.02) return; // not stable enough

    const cal: CalibrationRect = margins;
    const control = cameraToControl(cam.x, cam.y, cal, { sensX, sensY });
    setSamples((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        camera: { ...cam },
        control,
      };
      return next;
    });
    if (idx < samples.length - 1) setIdx(idx + 1);
    else setStep("review");
  };

  const computeMapping = useMemo(() => {
    const done = samples.filter((s) => s.camera && s.control);
    if (done.length < 5) return null;
    // Fit active region from extremes of mirrored camera samples.
    const xs = done.map((s) => 1 - (s.camera!.x));
    const ys = done.map((s) => s.camera!.y);
    const pad = 0.02;
    const region: CalibrationRect = {
      x0: Math.max(0.02, Math.min(...xs) - pad),
      y0: Math.max(0.02, Math.min(...ys) - pad),
      x1: Math.min(0.98, Math.max(...xs) + pad),
      y1: Math.min(0.98, Math.max(...ys) + pad),
    };
    const affineSamples = done.map((s) => ({
      src: cameraToControl(s.camera!.x, s.camera!.y, region, { sensX, sensY }),
      dst: s.target,
    }));
    const affine = fitAffine(affineSamples);
    let rms = 0;
    for (const s of affineSamples) {
      const mapped = affine ? affine(s.src) : s.src;
      rms += (mapped.x - s.dst.x) ** 2 + (mapped.y - s.dst.y) ** 2;
    }
    rms = Math.sqrt(rms / affineSamples.length);
    return { region, affine, rms, affineSamples };
  }, [samples, sensX, sensY]);

  useEffect(() => {
    if (computeMapping) setResidual(computeMapping.rms);
  }, [computeMapping]);

  const save = () => {
    const base = loadTrackingSettings();
    const region = computeMapping?.region ?? margins;
    const next: TrackingQualitySettings = {
      ...base,
      cameraDeviceId: deviceId,
      primaryHand: hand,
      monitorPolicy: monitor,
      calibration: region,
      sensX,
      sensY,
      edgeCompress: residual != null && residual > 0.06 ? 0.35 : base.edgeCompress,
    };
    saveTrackingSettings(next);
    saveCalibrationProfile({
      id: `cal-${Date.now()}`,
      name: `${monitor} · ${hand} · ${new Date().toLocaleDateString()}`,
      updatedAt: Date.now(),
      cameraDeviceId: deviceId,
      captureWidth: base.captureWidth,
      captureHeight: base.captureHeight,
      displayId: null,
      calibration: region,
      sensX,
      sensY,
      edgeCompress: next.edgeCompress,
      affineSamples: computeMapping?.affineSamples,
      residualRms: residual ?? undefined,
    });
    window.dispatchEvent(new CustomEvent("jarvis:tracking-settings", { detail: next }));
    onSaved(next);
    setAffineOn(!!computeMapping?.affine && (residual ?? 1) < 0.12);
    setStep("test");
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center pointer-events-auto"
      style={{ background: "rgba(2,8,20,0.72)" }}
    >
      <div
        className="relative w-[min(720px,94vw)] max-h-[90vh] overflow-auto rounded-2xl p-5"
        style={{
          background: "linear-gradient(165deg, rgba(8,16,32,0.96), rgba(4,10,22,0.98))",
          boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.22), 0 24px 80px rgba(0,0,0,0.55)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-mono text-[9px] tracking-[0.28em] uppercase text-jarvis-cyan/50">
              Calibration
            </div>
            <div className="text-display text-[22px] text-jarvis-ice tracking-wide">
              Cursor mapping
            </div>
          </div>
          <button
            type="button"
            className="text-mono text-[10px] uppercase tracking-[0.2em] text-jarvis-ice/50 hover:text-jarvis-ice"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {step === "camera" && (
          <section className="space-y-3">
            <p className="text-[12px] text-jarvis-ice/60">Select the webcam used for Hands.</p>
            <select
              className="w-full rounded-xl bg-black/40 border border-jarvis-cyan/20 px-3 py-2 text-[13px] text-jarvis-ice"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            >
              <option value="">Default camera</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId.slice(0, 12)}
                </option>
              ))}
            </select>
            <Nav next={() => setStep("hand")} />
          </section>
        )}

        {step === "hand" && (
          <section className="space-y-3">
            <p className="text-[12px] text-jarvis-ice/60">Dominant hand for the main cursor.</p>
            <div className="grid grid-cols-2 gap-2">
              {(["right", "left"] as const).map((h) => (
                <Choice key={h} label={h} active={hand === h} onClick={() => setHand(h)} />
              ))}
            </div>
            <Nav back={() => setStep("camera")} next={() => setStep("monitor")} />
          </section>
        )}

        {step === "monitor" && (
          <section className="space-y-3">
            <p className="text-[12px] text-jarvis-ice/60">Target display region.</p>
            <div className="grid grid-cols-2 gap-2">
              <Choice label="All monitors" active={monitor === "virtual"} onClick={() => setMonitor("virtual")} />
              <Choice label="Primary" active={monitor === "primary"} onClick={() => setMonitor("primary")} />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Num label="Margin L" value={margins.x0} onChange={(v) => setMargins({ ...margins, x0: v })} />
              <Num label="Margin R" value={1 - margins.x1} onChange={(v) => setMargins({ ...margins, x1: 1 - v })} />
              <Num label="Margin T" value={margins.y0} onChange={(v) => setMargins({ ...margins, y0: v })} />
              <Num label="Margin B" value={1 - margins.y1} onChange={(v) => setMargins({ ...margins, y1: 1 - v })} />
              <Num label="Sens X" value={sensX} min={0.5} max={2} onChange={setSensX} />
              <Num label="Sens Y" value={sensY} min={0.5} max={2} onChange={setSensY} />
            </div>
            <Nav back={() => setStep("hand")} next={() => { setIdx(0); setStep("targets"); }} />
          </section>
        )}

        {step === "targets" && current && (
          <section className="space-y-3">
            <p className="text-[12px] text-jarvis-ice/60">
              Point at the glowing target with your index fingertip and hold still, then Capture.
              ({idx + 1}/{samples.length})
            </p>
            <div
              className="relative h-56 rounded-xl overflow-hidden"
              style={{ background: "rgba(0,0,0,0.35)", boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.15)" }}
            >
              <TargetDot u={current.target.x} v={current.target.y} label={current.label} />
              {live.filtered && (
                <div
                  className="absolute w-2.5 h-2.5 rounded-full bg-cyan-300/90"
                  style={{
                    left: `${live.filtered.x * 100}%`,
                    top: `${live.filtered.y * 100}%`,
                    transform: "translate(-50%,-50%)",
                  }}
                  title="Filtered tip"
                />
              )}
              {live.camera && (
                <div className="absolute bottom-2 left-2 text-mono text-[9px] text-jarvis-cyan/50">
                  cam {live.camera.x.toFixed(3)},{live.camera.y.toFixed(3)}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl py-3 text-mono text-[11px] tracking-[0.18em] uppercase bg-cyan-400/20 text-jarvis-ice"
                onClick={captureStable}
              >
                Capture
              </button>
              <button
                type="button"
                className="rounded-xl px-4 py-3 text-mono text-[10px] uppercase text-jarvis-ice/50"
                onClick={() => (idx > 0 ? setIdx(idx - 1) : setStep("monitor"))}
              >
                Back
              </button>
            </div>
          </section>
        )}

        {step === "review" && (
          <section className="space-y-3">
            <p className="text-[12px] text-jarvis-ice/60">
              Residual RMS:{" "}
              <span className="text-jarvis-ice">{residual != null ? residual.toFixed(3) : "—"}</span>
              {residual != null && residual > 0.12 && (
                <span className="text-amber-200/80"> · high error — prefer region+sensitivity, skip affine</span>
              )}
            </p>
            <ul className="text-[11px] text-jarvis-ice/55 space-y-1 max-h-40 overflow-auto">
              {samples.map((s) => (
                <li key={s.id}>
                  {s.label}: {s.camera ? "ok" : "missing"}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-jarvis-ice/40">
              Affine correction {affineOn || (residual != null && residual < 0.12) ? "available" : "skipped"} —
              only applied when samples fit a near-planar mapping.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl py-3 text-mono text-[11px] tracking-[0.18em] uppercase bg-cyan-400/25 text-jarvis-ice"
                onClick={save}
              >
                Save & test
              </button>
              <button
                type="button"
                className="rounded-xl px-4 py-3 text-mono text-[10px] uppercase text-jarvis-ice/50"
                onClick={() => { setIdx(0); setStep("targets"); }}
              >
                Redo
              </button>
            </div>
          </section>
        )}

        {step === "test" && (
          <section className="space-y-3">
            <p className="text-[12px] text-jarvis-ice/60">
              Move to each corner. Mapping saved locally. Restart Hands if you changed the camera.
            </p>
            <div
              className="relative h-48 rounded-xl"
              style={{ background: "rgba(0,0,0,0.35)", boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.15)" }}
            >
              {NINE.map((n) => (
                <div
                  key={n.id}
                  className="absolute w-2 h-2 rounded-full bg-jarvis-cyan/35"
                  style={{ left: `${n.target.x * 100}%`, top: `${n.target.y * 100}%`, transform: "translate(-50%,-50%)" }}
                />
              ))}
              {live.filtered && (
                <div
                  className="absolute w-3 h-3 rounded-full bg-cyan-300"
                  style={{
                    left: `${live.filtered.x * 100}%`,
                    top: `${live.filtered.y * 100}%`,
                    transform: "translate(-50%,-50%)",
                    boxShadow: "0 0 12px rgba(34,211,238,0.8)",
                  }}
                />
              )}
            </div>
            <button
              type="button"
              className="w-full rounded-xl py-3 text-mono text-[11px] tracking-[0.18em] uppercase bg-cyan-400/20 text-jarvis-ice"
              onClick={onClose}
            >
              Done
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

function Nav({ back, next }: { back?: () => void; next?: () => void }) {
  return (
    <div className="flex gap-2 pt-2">
      {back && (
        <button type="button" onClick={back} className="rounded-xl px-4 py-3 text-mono text-[10px] uppercase text-jarvis-ice/50">
          Back
        </button>
      )}
      {next && (
        <button
          type="button"
          onClick={next}
          className="flex-1 rounded-xl py-3 text-mono text-[11px] tracking-[0.18em] uppercase bg-cyan-400/20 text-jarvis-ice"
        >
          Next
        </button>
      )}
    </div>
  );
}

function Choice({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl px-3 py-4 text-mono text-[11px] tracking-[0.16em] uppercase capitalize"
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

function Num({
  label, value, onChange, min = 0, max = 0.4,
}: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <label className="block text-[10px] text-jarvis-cyan/45 text-mono uppercase tracking-[0.16em]">
      {label}
      <input
        type="number"
        step={0.01}
        min={min}
        max={max}
        value={Number(value.toFixed(2))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg bg-black/40 border border-jarvis-cyan/15 px-2 py-1.5 text-[12px] text-jarvis-ice"
      />
    </label>
  );
}

function TargetDot({ u, v, label }: { u: number; v: number; label: string }) {
  return (
    <div
      className="absolute"
      style={{ left: `${u * 100}%`, top: `${v * 100}%`, transform: "translate(-50%,-50%)" }}
    >
      <div
        className="w-5 h-5 rounded-full"
        style={{
          background: "rgba(34,211,238,0.25)",
          boxShadow: "0 0 0 2px rgba(34,211,238,0.9), 0 0 22px rgba(34,211,238,0.55)",
        }}
      />
      <div className="mt-2 text-center text-mono text-[9px] tracking-[0.14em] uppercase text-jarvis-cyan/70 whitespace-nowrap">
        {label}
      </div>
    </div>
  );
}
