/**
 * Shared MediaPipe hand-tracking helpers.
 * Single camera owner stays in GestureOverlay — this module handles
 * GPU→CPU fallback, stale-frame dropping, and rVFC scheduling.
 */

export type LandmarkerLike = {
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => any;
  close?: () => void;
};

export type PipelineBootResult = {
  landmarker: LandmarkerLike;
  delegate: "GPU" | "CPU";
};

/**
 * Create HandLandmarker with GPU delegate, falling back to CPU.
 */
export async function createHandLandmarker(opts?: {
  numHands?: number;
  confidence?: number;
}): Promise<PipelineBootResult> {
  const visionMod = await import(
    /* @vite-ignore */
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm"
  );
  const { FilesetResolver, HandLandmarker } = visionMod as {
    FilesetResolver: any;
    HandLandmarker: any;
  };
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  );

  const confidence = opts?.confidence ?? 0.45;
  const base = {
    runningMode: "VIDEO" as const,
    numHands: opts?.numHands ?? 2,
    minHandDetectionConfidence: confidence,
    minHandPresenceConfidence: confidence,
    minTrackingConfidence: confidence,
  };

  try {
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      ...base,
      baseOptions: {
        modelAssetPath: "/hand_landmarker.task",
        delegate: "GPU",
      },
    });
    return { landmarker, delegate: "GPU" };
  } catch (e) {
    console.warn("[hands] GPU delegate failed, falling back to CPU", e);
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      ...base,
      baseOptions: {
        modelAssetPath: "/hand_landmarker.task",
        delegate: "CPU",
      },
    });
    return { landmarker, delegate: "CPU" };
  }
}

export type CaptureConstraints = {
  deviceId?: string;
  width?: number;
  height?: number;
  fps?: number;
};

export async function openCamera(c: CaptureConstraints = {}): Promise<MediaStream> {
  const video: MediaTrackConstraints = {
    width: { ideal: c.width ?? 1280 },
    height: { ideal: c.height ?? 720 },
    frameRate: { ideal: c.fps ?? 60, max: c.fps ?? 60 },
    facingMode: "user",
  };
  if (c.deviceId) {
    video.deviceId = { exact: c.deviceId };
    delete (video as any).facingMode;
  }
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

/**
 * Frame scheduler: prefer requestVideoFrameCallback; drop stale work
 * by only keeping the latest scheduled callback.
 */
export class FrameScheduler {
  private video: HTMLVideoElement | null = null;
  private rvfcId = 0;
  private rafId = 0;
  private running = false;
  private busy = false;
  private pending = false;
  private onFrame: ((now: number, meta?: VideoFrameCallbackMetadata) => void | Promise<void>) | null =
    null;

  start(
    video: HTMLVideoElement,
    onFrame: (now: number, meta?: VideoFrameCallbackMetadata) => void | Promise<void>,
  ) {
    this.stop();
    this.video = video;
    this.onFrame = onFrame;
    this.running = true;
    this.pump();
  }

  stop() {
    this.running = false;
    this.onFrame = null;
    if (this.video && this.rvfcId && "cancelVideoFrameCallback" in this.video) {
      try {
        (this.video as any).cancelVideoFrameCallback(this.rvfcId);
      } catch {
        /* noop */
      }
    }
    this.rvfcId = 0;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.busy = false;
    this.pending = false;
  }

  private pump() {
    if (!this.running || !this.video || !this.onFrame) return;
    const video = this.video;
    if (typeof (video as any).requestVideoFrameCallback === "function") {
      this.rvfcId = (video as any).requestVideoFrameCallback(
        async (now: number, meta: VideoFrameCallbackMetadata) => {
          if (!this.running) return;
          await this.run(now, meta);
          this.pump();
        },
      );
    } else {
      this.rafId = requestAnimationFrame(async (now) => {
        if (!this.running) return;
        await this.run(now);
        this.pump();
      });
    }
  }

  private async run(now: number, meta?: VideoFrameCallbackMetadata) {
    if (this.busy) {
      // Drop: inference still running — skip this camera frame.
      this.pending = true;
      return;
    }
    this.busy = true;
    this.pending = false;
    try {
      await this.onFrame?.(now, meta);
    } finally {
      this.busy = false;
      // If a frame arrived while busy, we intentionally drop it (no queue).
      void this.pending;
    }
  }
}

export async function listVideoInputs(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  } catch {
    return [];
  }
}
