/**
 * One Euro Filter — adaptive low-pass for fingertip tracking.
 * Uses real frame timestamps; low cutoff at rest, rises with speed.
 * Casiez et al., CHI 2012.
 */

export type OneEuroParams = {
  /** Minimum cutoff frequency (Hz). Lower = more smoothing when still. */
  minCutoff: number;
  /** Speed coefficient — how quickly cutoff rises with velocity. */
  beta: number;
  /** Cutoff for the derivative (speed) estimate. */
  dCutoff: number;
  /** Ignore displacements smaller than this (normalized or pixel units). */
  deadZone: number;
  /** Reject / clamp single-frame jumps larger than this. */
  maxJump: number;
};

export const DEFAULT_CURSOR_EURO: OneEuroParams = {
  minCutoff: 1.2,
  beta: 0.035,
  dCutoff: 1.0,
  deadZone: 0.35,
  maxJump: 180,
};

export const DEFAULT_VIZ_EURO: OneEuroParams = {
  minCutoff: 2.5,
  beta: 0.06,
  dCutoff: 1.2,
  deadZone: 0.15,
  maxJump: 220,
};

export const PRESET_FAST_EURO: OneEuroParams = {
  minCutoff: 2.2,
  beta: 0.07,
  dCutoff: 1.3,
  deadZone: 0.15,
  maxJump: 260,
};

export const PRESET_BALANCED_EURO: OneEuroParams = { ...DEFAULT_CURSOR_EURO };

export const PRESET_PRECISION_EURO: OneEuroParams = {
  minCutoff: 0.7,
  beta: 0.018,
  dCutoff: 0.9,
  deadZone: 0.55,
  maxJump: 140,
};

function smoothingFactor(te: number, cutoff: number): number {
  const r = 2 * Math.PI * cutoff * te;
  return r / (r + 1);
}

class LowPass {
  private hat: number | null = null;

  filter(v: number, alpha: number): number {
    if (this.hat == null) {
      this.hat = v;
      return v;
    }
    this.hat = alpha * v + (1 - alpha) * this.hat;
    return this.hat;
  }

  reset(v?: number) {
    this.hat = v == null ? null : v;
  }

  value(): number | null {
    return this.hat;
  }
}

export class OneEuroFilter1D {
  private xFilter = new LowPass();
  private dxFilter = new LowPass();
  private lastT: number | null = null;
  private lastX: number | null = null;

  constructor(public params: OneEuroParams) {}

  setParams(p: Partial<OneEuroParams>) {
    this.params = { ...this.params, ...p };
  }

  reset(seed?: number) {
    this.xFilter.reset(seed);
    this.dxFilter.reset();
    this.lastT = null;
    this.lastX = seed ?? null;
  }

  filter(x: number, timestampMs: number): number {
    const { minCutoff, beta, dCutoff, deadZone, maxJump } = this.params;

    if (this.lastT == null || this.lastX == null) {
      this.lastT = timestampMs;
      this.lastX = x;
      this.xFilter.reset(x);
      this.dxFilter.reset(0);
      return x;
    }

    let te = (timestampMs - this.lastT) / 1000;
    if (te <= 0 || te > 0.5) {
      // Stale / clock jump — reseat without carrying velocity.
      this.reset(x);
      this.lastT = timestampMs;
      return x;
    }
    // Clamp pathological tiny dt from duplicated timestamps.
    te = Math.max(te, 1 / 240);

    let dx = (x - this.lastX) / te;
    const jump = Math.abs(x - this.lastX);
    if (jump > maxJump) {
      // Physically implausible — snap to new value, clear history.
      this.reset(x);
      this.lastT = timestampMs;
      return x;
    }

    const aD = smoothingFactor(te, dCutoff);
    dx = this.dxFilter.filter(dx, aD);
    const cutoff = minCutoff + beta * Math.abs(dx);
    const aX = smoothingFactor(te, cutoff);
    let filtered = this.xFilter.filter(x, aX);

    if (Math.abs(filtered - (this.xFilter.value() ?? filtered)) < 0) {
      // no-op guard
    }
    // Dead zone relative to previous output.
    const prev = this.lastX;
    if (Math.abs(filtered - prev) < deadZone && Math.abs(dx) < deadZone * 60) {
      filtered = prev;
      this.xFilter.reset(prev);
    }

    this.lastT = timestampMs;
    this.lastX = filtered;
    return filtered;
  }
}

export class OneEuroFilter2D {
  private fx: OneEuroFilter1D;
  private fy: OneEuroFilter1D;

  constructor(params: OneEuroParams = DEFAULT_CURSOR_EURO) {
    this.fx = new OneEuroFilter1D(params);
    this.fy = new OneEuroFilter1D({ ...params });
  }

  setParams(p: Partial<OneEuroParams>) {
    this.fx.setParams(p);
    this.fy.setParams(p);
  }

  reset(seed?: { x: number; y: number }) {
    this.fx.reset(seed?.x);
    this.fy.reset(seed?.y);
  }

  filter(x: number, y: number, timestampMs: number): { x: number; y: number } {
    return {
      x: this.fx.filter(x, timestampMs),
      y: this.fy.filter(y, timestampMs),
    };
  }
}
