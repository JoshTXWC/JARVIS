/**
 * Centralized Barehands coordinate transforms.
 *
 * Spaces (never interchangeable):
 *   camera  — MediaPipe normalized landmarks [0,1] in sensor frame
 *   preview — pixels over the mirrored object-cover webcam preview
 *   control — calibrated normalized cursor-control region [0,1]
 *   hud     — JARVIS Electron viewport CSS pixels
 *   desktop — Windows virtual-desktop pixels (may be negative on multi-mon)
 */

export type Pt = { x: number; y: number };

export type ScreenRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Active tracking region inside camera space (before mirror). */
export type CalibrationRect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type CoverLayout = {
  scale: number;
  dispW: number;
  dispH: number;
  offsetX: number;
  offsetY: number;
};

export const DEFAULT_CALIBRATION: CalibrationRect = {
  x0: 0.12,
  y0: 0.08,
  x1: 0.88,
  y1: 0.92,
};

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Mirror camera X so selfie-view matches on-screen hand motion. */
export function mirrorCameraX(nx: number): number {
  return 1 - clamp01(nx);
}

/**
 * object-cover layout: how a video of (videoW×videoH) is drawn into
 * a (viewW×viewH) box. Used for HUD preview + skeleton drawing.
 */
export function coverLayout(
  videoW: number,
  videoH: number,
  viewW: number,
  viewH: number,
): CoverLayout {
  if (videoW <= 0 || videoH <= 0 || viewW <= 0 || viewH <= 0) {
    return { scale: 1, dispW: viewW, dispH: viewH, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.max(viewW / videoW, viewH / videoH);
  const dispW = videoW * scale;
  const dispH = videoH * scale;
  return {
    scale,
    dispW,
    dispH,
    offsetX: (viewW - dispW) / 2,
    offsetY: (viewH - dispH) / 2,
  };
}

/**
 * Camera landmark → preview/HUD pixels matching a mirrored object-cover video.
 * Do NOT use this for desktop cursor injection.
 */
export function cameraToPreview(
  nx: number,
  ny: number,
  videoW: number,
  videoH: number,
  viewW: number,
  viewH: number,
  mirrored = true,
): Pt {
  const layout = coverLayout(videoW, videoH, viewW, viewH);
  const mx = mirrored ? mirrorCameraX(nx) : clamp01(nx);
  const my = clamp01(ny);
  return {
    x: layout.offsetX + mx * layout.dispW,
    y: layout.offsetY + my * layout.dispH,
  };
}

/**
 * Camera landmark → calibrated control UV [0,1].
 * Mirrors X once. Applies optional independent X/Y sensitivity around center.
 */
export function cameraToControl(
  nx: number,
  ny: number,
  cal: CalibrationRect = DEFAULT_CALIBRATION,
  opts?: {
    sensX?: number;
    sensY?: number;
    /** Soft edge compression near 0/1 (0 = linear). */
    edgeCompress?: number;
  },
): Pt {
  const mx = mirrorCameraX(nx);
  const my = clamp01(ny);
  const w = Math.max(1e-6, cal.x1 - cal.x0);
  const h = Math.max(1e-6, cal.y1 - cal.y0);
  let u = clamp01((mx - cal.x0) / w);
  let v = clamp01((my - cal.y0) / h);

  const sx = opts?.sensX ?? 1;
  const sy = opts?.sensY ?? 1;
  if (sx !== 1) u = clamp01(0.5 + (u - 0.5) * sx);
  if (sy !== 1) v = clamp01(0.5 + (v - 0.5) * sy);

  const ec = opts?.edgeCompress ?? 0;
  if (ec > 0) {
    // Gentle ease toward edges so users reach corners without hitting webcam borders.
    const ease = (t: number) => {
      const c = clamp01(ec);
      const s = t * 2 - 1;
      const shaped = Math.sign(s) * Math.pow(Math.abs(s), 1 - c * 0.35);
      return shaped * 0.5 + 0.5;
    };
    u = ease(u);
    v = ease(v);
  }

  return { x: u, y: v };
}

/**
 * Control UV → Windows desktop pixels. Supports negative origins (multi-mon).
 * Clamps to the target screen rect.
 */
export function controlToDesktop(
  u: number,
  v: number,
  screen: ScreenRect,
): Pt {
  const uu = clamp01(u);
  const vv = clamp01(v);
  const maxX = screen.x + Math.max(0, screen.width - 1);
  const maxY = screen.y + Math.max(0, screen.height - 1);
  return {
    x: clamp(screen.x + uu * Math.max(0, screen.width - 1), screen.x, maxX),
    y: clamp(screen.y + vv * Math.max(0, screen.height - 1), screen.y, maxY),
  };
}

/** Full camera → desktop pipeline (separate from preview mapping). */
export function cameraToDesktop(
  nx: number,
  ny: number,
  screen: ScreenRect,
  cal: CalibrationRect = DEFAULT_CALIBRATION,
  opts?: Parameters<typeof cameraToControl>[3],
): Pt {
  const uv = cameraToControl(nx, ny, cal, opts);
  return controlToDesktop(uv.x, uv.y, screen);
}

/** Desktop pixel → normalized UV of a screen rect. */
export function desktopToUv(pt: Pt, screen: ScreenRect): Pt {
  return {
    x: clamp01((pt.x - screen.x) / Math.max(1, screen.width - 1)),
    y: clamp01((pt.y - screen.y) / Math.max(1, screen.height - 1)),
  };
}

/**
 * Affine fit from control samples → desktop UV, when ≥3 stable points exist.
 * Falls back to identity if underdetermined / ill-conditioned.
 */
export function fitAffine(
  samples: Array<{ src: Pt; dst: Pt }>,
): ((p: Pt) => Pt) | null {
  if (samples.length < 3) return null;
  // Solve [x y 1] * M = [u v] via least squares (2 independent 3-param systems).
  const n = samples.length;
  const AtA = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const AtUx = [0, 0, 0];
  const AtUy = [0, 0, 0];
  for (const s of samples) {
    const row = [s.src.x, s.src.y, 1];
    for (let i = 0; i < 3; i++) {
      AtUx[i] += row[i] * s.dst.x;
      AtUy[i] += row[i] * s.dst.y;
      for (let j = 0; j < 3; j++) AtA[i][j] += row[i] * row[j];
    }
  }
  const inv = invert3(AtA);
  if (!inv) return null;
  const mx = mul3(inv, AtUx);
  const my = mul3(inv, AtUy);
  return (p: Pt) => ({
    x: clamp01(mx[0] * p.x + mx[1] * p.y + mx[2]),
    y: clamp01(my[0] * p.x + my[1] * p.y + my[2]),
  });
}

function invert3(m: number[][]): number[][] | null {
  const [
    [a, b, c],
    [d, e, f],
    [g, h, i],
  ] = m;
  const det =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-9) return null;
  const invDet = 1 / det;
  return [
    [(e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
    [(f * g - d * i) * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
    [(d * h - e * g) * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet],
  ];
}

function mul3(m: number[][], v: number[]): number[] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** How close a camera landmark is to the frame edge (0 = center, 1 = at/outside). */
export function edgeProximity(nx: number, ny: number, margin = 0.08): number {
  const mx = Math.min(nx, 1 - nx);
  const my = Math.min(ny, 1 - ny);
  const m = Math.min(mx, my);
  if (m >= margin) return 0;
  return clamp01(1 - m / margin);
}
