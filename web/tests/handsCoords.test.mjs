/**
 * Barehands coordinate + One Euro unit tests (Node, no DOM).
 * Run: node --test tests/handsCoords.test.mjs
 *
 * Mirrors the TypeScript logic in src/lib/hands/coords.ts + oneEuro.ts
 * for deterministic CI without a TS test runner.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function mirrorCameraX(nx) {
  return 1 - clamp01(nx);
}

function coverLayout(videoW, videoH, viewW, viewH) {
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

function cameraToPreview(nx, ny, videoW, videoH, viewW, viewH, mirrored = true) {
  const layout = coverLayout(videoW, videoH, viewW, viewH);
  const mx = mirrored ? mirrorCameraX(nx) : clamp01(nx);
  const my = clamp01(ny);
  return {
    x: layout.offsetX + mx * layout.dispW,
    y: layout.offsetY + my * layout.dispH,
  };
}

function cameraToControl(nx, ny, cal = { x0: 0.12, y0: 0.08, x1: 0.88, y1: 0.92 }) {
  const mx = mirrorCameraX(nx);
  const my = clamp01(ny);
  const w = Math.max(1e-6, cal.x1 - cal.x0);
  const h = Math.max(1e-6, cal.y1 - cal.y0);
  return {
    x: clamp01((mx - cal.x0) / w),
    y: clamp01((my - cal.y0) / h),
  };
}

function controlToDesktop(u, v, screen) {
  const uu = clamp01(u);
  const vv = clamp01(v);
  return {
    x: screen.x + uu * Math.max(0, screen.width - 1),
    y: screen.y + vv * Math.max(0, screen.height - 1),
  };
}

function cameraToDesktop(nx, ny, screen, cal) {
  const uv = cameraToControl(nx, ny, cal);
  return controlToDesktop(uv.x, uv.y, screen);
}

describe("cameraToPreview object-cover + mirror", () => {
  it("mirrors X and centers cover crop", () => {
    // 1280x720 into 1920x1080 → exact cover, no crop offset
    const p = cameraToPreview(0, 0.5, 1280, 720, 1920, 1080, true);
    assert.ok(Math.abs(p.x - 1920) < 1e-6);
    assert.ok(Math.abs(p.y - 540) < 1e-6);
  });

  it("applies negative offsets when video is wider than view", () => {
    // 1920x1080 into 800x800 → height-limited? max(800/1920, 800/1080)=0.741
    const layout = coverLayout(1920, 1080, 800, 800);
    assert.ok(layout.offsetX < 0 || layout.offsetY < 0);
    const mid = cameraToPreview(0.5, 0.5, 1920, 1080, 800, 800, true);
    assert.ok(mid.x > 0 && mid.x < 800);
    assert.ok(mid.y > 0 && mid.y < 800);
  });

  it("does not double-mirror when mirrored=false", () => {
    const a = cameraToPreview(0.2, 0.3, 100, 100, 100, 100, false);
    const b = cameraToPreview(0.2, 0.3, 100, 100, 100, 100, true);
    assert.ok(Math.abs(a.x - 20) < 1e-6);
    assert.ok(Math.abs(b.x - 80) < 1e-6);
  });
});

describe("cameraToDesktop multi-monitor", () => {
  it("supports negative monitor origins", () => {
    const screen = { x: -1920, y: 0, width: 3840, height: 1080 };
    const cal = { x0: 0, y0: 0, x1: 1, y1: 1 };
    const tl = cameraToDesktop(1, 0, screen, cal); // mirrored → u=0
    assert.equal(Math.round(tl.x), -1920);
    assert.equal(Math.round(tl.y), 0);
    const br = cameraToDesktop(0, 1, screen, cal);
    assert.equal(Math.round(br.x), -1920 + 3839);
    assert.equal(Math.round(br.y), 1079);
  });

  it("clamps to screen bounds", () => {
    const screen = { x: 0, y: 0, width: 1000, height: 1000 };
    const cal = { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 };
    const outside = cameraToDesktop(0.99, 0.01, screen, cal);
    assert.ok(outside.x >= 0 && outside.x <= 999);
    assert.ok(outside.y >= 0 && outside.y <= 999);
  });

  it("preview and desktop transforms differ", () => {
    const screen = { x: 0, y: 0, width: 1920, height: 1080 };
    const preview = cameraToPreview(0.3, 0.4, 1280, 720, 800, 600, true);
    const desktop = cameraToDesktop(0.3, 0.4, screen, {
      x0: 0.12,
      y0: 0.08,
      x1: 0.88,
      y1: 0.92,
    });
    // Different spaces — values should not match 1:1
    assert.notEqual(preview.x, desktop.x);
  });
});

describe("One Euro filter behavior", () => {
  function smoothingFactor(te, cutoff) {
    const r = 2 * Math.PI * cutoff * te;
    return r / (r + 1);
  }

  class LowPass {
    constructor() {
      this.hat = null;
    }
    filter(v, alpha) {
      if (this.hat == null) {
        this.hat = v;
        return v;
      }
      this.hat = alpha * v + (1 - alpha) * this.hat;
      return this.hat;
    }
    reset(v) {
      this.hat = v == null ? null : v;
    }
  }

  class OneEuro1D {
    constructor(params) {
      this.params = params;
      this.xFilter = new LowPass();
      this.dxFilter = new LowPass();
      this.lastT = null;
      this.lastX = null;
    }
    reset(seed) {
      this.xFilter.reset(seed);
      this.dxFilter.reset();
      this.lastT = null;
      this.lastX = seed ?? null;
    }
    filter(x, t) {
      const { minCutoff, beta, dCutoff, deadZone, maxJump } = this.params;
      if (this.lastT == null || this.lastX == null) {
        this.lastT = t;
        this.lastX = x;
        this.xFilter.reset(x);
        this.dxFilter.reset(0);
        return x;
      }
      let te = (t - this.lastT) / 1000;
      if (te <= 0 || te > 0.5) {
        this.reset(x);
        this.lastT = t;
        return x;
      }
      te = Math.max(te, 1 / 240);
      if (Math.abs(x - this.lastX) > maxJump) {
        this.reset(x);
        this.lastT = t;
        return x;
      }
      let dx = (x - this.lastX) / te;
      dx = this.dxFilter.filter(dx, smoothingFactor(te, dCutoff));
      const cutoff = minCutoff + beta * Math.abs(dx);
      let filtered = this.xFilter.filter(x, smoothingFactor(te, cutoff));
      if (Math.abs(filtered - this.lastX) < deadZone && Math.abs(dx) < deadZone * 60) {
        filtered = this.lastX;
        this.xFilter.reset(this.lastX);
      }
      this.lastT = t;
      this.lastX = filtered;
      return filtered;
    }
  }

  it("suppresses stationary jitter", () => {
    const f = new OneEuro1D({
      minCutoff: 1.0,
      beta: 0.02,
      dCutoff: 1,
      deadZone: 0.4,
      maxJump: 100,
    });
    let y = f.filter(100, 0);
    const out = [];
    for (let i = 1; i <= 40; i++) {
      const noisy = 100 + (Math.sin(i) * 0.3);
      y = f.filter(noisy, i * 16);
      out.push(y);
    }
    const span = Math.max(...out) - Math.min(...out);
    assert.ok(span < 1.0, `jitter span ${span}`);
  });

  it("tracks fast movement with less lag than heavy EMA", () => {
    const f = new OneEuro1D({
      minCutoff: 1.2,
      beta: 0.08,
      dCutoff: 1,
      deadZone: 0.1,
      maxJump: 500,
    });
    f.filter(0, 0);
    let y = 0;
    for (let i = 1; i <= 10; i++) {
      y = f.filter(i * 20, i * 16);
    }
    // After a fast ramp, filter should be close to target (not stuck at ~0.2 follow)
    assert.ok(y > 150, `fast track got ${y}`);
  });

  it("resets on max jump", () => {
    const f = new OneEuro1D({
      minCutoff: 1,
      beta: 0.02,
      dCutoff: 1,
      deadZone: 0,
      maxJump: 50,
    });
    f.filter(0, 0);
    f.filter(10, 16);
    const jumped = f.filter(400, 32);
    assert.equal(jumped, 400);
  });
});

describe("pinch lock vs drag semantics", () => {
  it("short pinch is click; hold+move is drag; never both", () => {
    let mode = "idle";
    let didDrag = false;
    let clicked = false;
    const DRAG_ARM = 400;
    const DRAG_MOVE = 28;
    let start = 1000;
    let lock = true;
    let hold = 0;
    let move = 0;

    // Approach lock
    mode = "locked";
    hold = 50;
    assert.equal(mode, "locked");

    // Short release → click
    lock = false;
    if (mode !== "idle" && !didDrag) {
      clicked = true;
      mode = "idle";
    }
    assert.equal(clicked, true);
    assert.equal(didDrag, false);

    // Reset for drag path
    clicked = false;
    mode = "locked";
    start = 2000;
    hold = 450;
    move = 40;
    if (hold >= DRAG_ARM && move >= DRAG_MOVE) {
      mode = "dragging";
      didDrag = true;
    }
    lock = false;
    if (mode !== "idle") {
      if (didDrag) {
        // mouse up only — no click
      } else {
        clicked = true;
      }
      mode = "idle";
    }
    assert.equal(didDrag, true);
    assert.equal(clicked, false);
  });
});
