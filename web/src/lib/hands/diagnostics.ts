/**
 * Lightweight high-frequency tracking diagnostics (no React per-frame).
 */

export type TrackingDiagnostics = {
  cameraFps: number;
  inferenceFps: number;
  avgInferenceMs: number;
  captureToCursorMs: number;
  frameDrops: number;
  trackingQuality: number;
  cursorStability: number;
  resolution: string;
  cameraLabel: string;
  delegate: "GPU" | "CPU" | "unknown";
};

type Sample = {
  t: number;
  inferMs: number;
  dropped: boolean;
  quality: number;
  /** Pixel/UV delta of filtered cursor between frames. */
  cursorDelta: number;
};

export class DiagnosticsCollector {
  private samples: Sample[] = [];
  private camFrames = 0;
  private camWindowStart = 0;
  private camFps = 0;
  private drops = 0;
  private lastInferEnd = 0;
  private lastCursor: { x: number; y: number } | null = null;
  private delegate: TrackingDiagnostics["delegate"] = "unknown";
  private resolution = "—";
  private cameraLabel = "";
  private lastCaptureTs = 0;

  setMeta(meta: {
    delegate?: TrackingDiagnostics["delegate"];
    resolution?: string;
    cameraLabel?: string;
  }) {
    if (meta.delegate) this.delegate = meta.delegate;
    if (meta.resolution) this.resolution = meta.resolution;
    if (meta.cameraLabel) this.cameraLabel = meta.cameraLabel;
  }

  markCameraFrame(nowMs: number) {
    if (!this.camWindowStart) this.camWindowStart = nowMs;
    this.camFrames += 1;
    if (nowMs - this.camWindowStart >= 1000) {
      this.camFps = (this.camFrames * 1000) / (nowMs - this.camWindowStart);
      this.camFrames = 0;
      this.camWindowStart = nowMs;
    }
    this.lastCaptureTs = nowMs;
  }

  markDropped() {
    this.drops += 1;
  }

  markInference(startMs: number, endMs: number, quality: number, cursor?: { x: number; y: number }) {
    const inferMs = Math.max(0, endMs - startMs);
    let cursorDelta = 0;
    if (cursor) {
      if (this.lastCursor) {
        cursorDelta = Math.hypot(cursor.x - this.lastCursor.x, cursor.y - this.lastCursor.y);
      }
      this.lastCursor = { ...cursor };
    }
    this.samples.push({
      t: endMs,
      inferMs,
      dropped: false,
      quality,
      cursorDelta,
    });
    // Keep ~2s window
    const cutoff = endMs - 2000;
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift();
    this.lastInferEnd = endMs;
  }

  snapshot(): TrackingDiagnostics {
    const n = this.samples.length || 1;
    const avgInfer = this.samples.reduce((s, x) => s + x.inferMs, 0) / n;
    const inferFps =
      this.samples.length >= 2
        ? ((this.samples.length - 1) * 1000) /
          Math.max(1, this.samples[this.samples.length - 1].t - this.samples[0].t)
        : 0;
    const quality =
      this.samples.reduce((s, x) => s + x.quality, 0) / n;
    // Stability = inverse of recent cursor jitter (normalized).
    const jitter =
      this.samples.reduce((s, x) => s + x.cursorDelta, 0) / n;
    const stability = Math.max(0, Math.min(1, 1 - jitter / 8));
    const latency = this.lastCaptureTs
      ? Math.max(0, this.lastInferEnd - this.lastCaptureTs + avgInfer)
      : avgInfer;

    return {
      cameraFps: Math.round(this.camFps * 10) / 10,
      inferenceFps: Math.round(inferFps * 10) / 10,
      avgInferenceMs: Math.round(avgInfer * 10) / 10,
      captureToCursorMs: Math.round(latency * 10) / 10,
      frameDrops: this.drops,
      trackingQuality: Math.round(quality * 100) / 100,
      cursorStability: Math.round(stability * 100) / 100,
      resolution: this.resolution,
      cameraLabel: this.cameraLabel,
      delegate: this.delegate,
    };
  }

  reset() {
    this.samples = [];
    this.camFrames = 0;
    this.camWindowStart = 0;
    this.camFps = 0;
    this.drops = 0;
    this.lastCursor = null;
  }
}

/** Singleton shared by GestureOverlay + settings panel. */
export const handsDiagnostics = new DiagnosticsCollector();
