/**
 * Combined desktop hand control (Mouse + Windows).
 *
 * Cursor = dominant-hand index tip (landmark 8) with One Euro filtering.
 * Pinch approach dampens → early lock → short release = click;
 * hold ~400ms + deliberate move = drag from knuckle/palm anchor.
 * Fist = window drag · two fingers = scroll · quick double short-pinch = right click.
 */

import {
  cameraToControl,
  cameraToDesktop,
  clamp01,
  controlToDesktop,
  desktopToUv,
  edgeProximity,
  type CalibrationRect,
  type Pt,
  type ScreenRect,
  DEFAULT_CALIBRATION,
} from "./coords";
import { OneEuroFilter2D, type OneEuroParams, DEFAULT_CURSOR_EURO } from "./oneEuro";
import type { TrackingQualitySettings } from "./trackingSettings";
import { DEFAULT_TRACKING } from "./trackingSettings";

export type { Pt, ScreenRect };

export type InjectOp =
  | { op: "move"; x: number; y: number }
  | { op: "down"; button?: string }
  | { op: "up"; button?: string }
  | { op: "click"; button?: string }
  | { op: "scroll"; dy: number }
  | { op: "release" }
  | { op: "win_grab"; x: number; y: number }
  | { op: "win_drag"; x: number; y: number }
  | { op: "win_drop" }
  | { op: "cursor_hide" }
  | { op: "cursor_show" };

export type CursorPhase =
  | "point"
  | "approach"
  | "locked"
  | "drag_ready"
  | "dragging"
  | "releasing"
  | "fist"
  | "scroll"
  | "lost";

export type CursorViz = {
  phase: CursorPhase;
  /** Overlay coords in 0–1 of the virtual screen. */
  u: number;
  v: number;
  /** 0 = far, 1 = at pinch threshold. */
  approach: number;
  /** 0–1 hold progress toward drag arm. */
  hold: number;
  /** Optional lock indicator. */
  locked?: boolean;
  /** Edge / confidence quality 0–1. */
  quality?: number;
};

const SCROLL_THRESHOLD = 0.018;
const DOUBLE_PINCH_MS = 420;
const RELEASE_BLEND_MS = 160;
const LOST_RESET_MS = 350;

function dist(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function tip(lm: Array<{ x: number; y: number }>, i: number): Pt {
  return { x: lm[i].x, y: lm[i].y };
}

function folded(lm: Array<{ x: number; y: number }>, tipI: number, mcpI: number) {
  const w = tip(lm, 0);
  return dist(tip(lm, tipI), w) < dist(tip(lm, mcpI), w);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Hand size proxy: wrist → middle MCP. */
export function handSize(lm: Array<{ x: number; y: number }>): number {
  return Math.max(1e-4, dist(tip(lm, 0), tip(lm, 9)));
}

/** Pinch distance normalized by hand size. */
export function normalizedPinch(lm: Array<{ x: number; y: number }>): number {
  return dist(tip(lm, 8), tip(lm, 4)) / handSize(lm);
}

export function classifyPose(
  lm: Array<{ x: number; y: number }>,
  pinchActivate = 0.28,
): "pinch" | "fist" | "open" | "two_finger" {
  if (lm.length < 21) return "open";
  if (normalizedPinch(lm) < pinchActivate) return "pinch";
  const indexUp = !folded(lm, 8, 5);
  const midUp = !folded(lm, 12, 9);
  if (indexUp && midUp && folded(lm, 16, 13) && folded(lm, 20, 17)) return "two_finger";
  if (folded(lm, 8, 5) && folded(lm, 12, 9) && folded(lm, 16, 13) && folded(lm, 20, 17)) {
    return "fist";
  }
  return "open";
}

/** @deprecated Prefer cameraToDesktop — kept for callers/tests. */
export function landmarkToScreen(
  nx: number,
  ny: number,
  screen: ScreenRect,
  cal: CalibrationRect = DEFAULT_CALIBRATION,
): Pt {
  return cameraToDesktop(nx, ny, screen, cal);
}

/** Stable hand anchor for relative drag — index MCP blended with palm. */
function handAnchor(
  lm: Array<{ x: number; y: number }>,
  screen: ScreenRect,
  cal: CalibrationRect,
  opts: { sensX: number; sensY: number; edgeCompress: number },
): Pt {
  const knuckle = cameraToDesktop(lm[5].x, lm[5].y, screen, cal, opts);
  const palm = cameraToDesktop(lm[0].x, lm[0].y, screen, cal, opts);
  return {
    x: knuckle.x * 0.65 + palm.x * 0.35,
    y: knuckle.y * 0.65 + palm.y * 0.35,
  };
}

type PinchMode = "idle" | "locked" | "drag_ready" | "dragging";

export class PrecisionController {
  private wasFist = false;
  private windowDragging = false;
  private scrollAnchorY: number | null = null;
  private lastShortClickAt = 0;

  private filter = new OneEuroFilter2D(DEFAULT_CURSOR_EURO);
  private cursor: Pt | null = null;
  private lastUv: Pt | null = null;

  private pinchMode: PinchMode = "idle";
  private lockPos: Pt | null = null;
  private pinchStartMs = 0;
  private dragAnchor0: Pt | null = null;
  private didDrag = false;
  private mouseDown = false;

  private releasing = false;
  private releaseFrom: Pt | null = null;
  private releaseStartMs = 0;
  private lostSince: number | null = null;
  private settings: TrackingQualitySettings = { ...DEFAULT_TRACKING };

  configure(partial: Partial<TrackingQualitySettings>) {
    this.settings = { ...this.settings, ...partial };
    if (partial.cursorFilter) {
      this.filter.setParams(partial.cursorFilter as OneEuroParams);
    }
    if (partial.calibration) {
      this.settings.calibration = { ...partial.calibration };
    }
  }

  getSettings(): TrackingQualitySettings {
    return this.settings;
  }

  reset() {
    const ops: InjectOp[] = [];
    if (this.mouseDown) {
      ops.push({ op: "up", button: "left" });
      this.mouseDown = false;
    }
    if (this.windowDragging) ops.push({ op: "win_drop" });
    ops.push({ op: "release" });
    this.wasFist = false;
    this.windowDragging = false;
    this.scrollAnchorY = null;
    this.filter.reset();
    this.cursor = null;
    this.lastUv = null;
    this.pinchMode = "idle";
    this.lockPos = null;
    this.pinchStartMs = 0;
    this.dragAnchor0 = null;
    this.didDrag = false;
    this.releasing = false;
    this.releaseFrom = null;
    this.lostSince = null;
    return ops;
  }

  /** Call when dominant hand identity changes to avoid cursor teleport. */
  onHandIdentityChange() {
    this.filter.reset(this.cursor ?? undefined);
    this.lastUv = null;
  }

  private beginRelease(nowMs: number) {
    if (this.cursor) {
      this.releasing = true;
      this.releaseFrom = { ...this.cursor };
      this.releaseStartMs = nowMs;
    }
    this.pinchMode = "idle";
    this.lockPos = null;
    this.dragAnchor0 = null;
    this.didDrag = false;
  }

  private endPinchGesture(nowMs: number, ops: InjectOp[]) {
    if (this.mouseDown) {
      ops.push({ op: "up", button: "left" });
      this.mouseDown = false;
    } else if (!this.didDrag && this.lockPos) {
      if (nowMs - this.lastShortClickAt <= DOUBLE_PINCH_MS) {
        ops.push({ op: "click", button: "right" });
        this.lastShortClickAt = 0;
      } else {
        ops.push({ op: "click", button: "left" });
        this.lastShortClickAt = nowMs;
      }
    }
    this.beginRelease(nowMs);
  }

  private mapOpts() {
    return {
      sensX: this.settings.sensX,
      sensY: this.settings.sensY,
      edgeCompress: this.settings.edgeCompress,
    };
  }

  private tipQuality(lm: Array<{ x: number; y: number }>): number {
    const tip8 = tip(lm, 8);
    const edge = edgeProximity(tip8.x, tip8.y, 0.1);
    // Partially visible: wrist or tip near border.
    const wristEdge = edgeProximity(lm[0].x, lm[0].y, 0.06);
    return clamp01(1 - Math.max(edge, wristEdge * 0.7));
  }

  /**
   * Returns OS inject ops + viz for this frame.
   * Cursor tracks landmark 8 (never palm / pinch midpoint).
   */
  frame(
    landmarks: Array<{ x: number; y: number }> | null,
    screen: ScreenRect,
    nowMs: number,
  ): { ops: InjectOp[]; pose: string; cursor: Pt | null; viz: CursorViz | null } {
    const s = this.settings;
    const cal = s.calibration;
    const opts = this.mapOpts();

    if (!landmarks || landmarks.length < 21) {
      if (this.lostSince == null) this.lostSince = nowMs;
      const ops: InjectOp[] = [];
      if (nowMs - (this.lostSince ?? nowMs) >= LOST_RESET_MS) {
        ops.push(...this.reset());
      } else if (this.mouseDown) {
        ops.push({ op: "up", button: "left" });
        this.mouseDown = false;
        ops.push({ op: "release" });
      }
      return {
        ops,
        pose: "lost",
        cursor: null,
        viz: { phase: "lost", u: 0.5, v: 0.5, approach: 0, hold: 0, quality: 0 },
      };
    }
    this.lostSince = null;

    const quality = this.tipQuality(landmarks);
    const poseClass = classifyPose(landmarks, s.pinchActivate);
    const pinchNorm = normalizedPinch(landmarks);
    const approach = clamp01(
      1 - (pinchNorm - s.pinchActivate) / Math.max(1e-6, s.pinchApproach - s.pinchActivate),
    );

    // Control UV from landmark 8, then One Euro in desktop pixels.
    const uvRaw = cameraToControl(landmarks[8].x, landmarks[8].y, cal, opts);

    // Reject implausible UV jumps (partial hand / flicker).
    if (this.lastUv) {
      const jump = dist(uvRaw, this.lastUv);
      if (jump > s.maxUvJump && quality < 0.55) {
        // Hold last good position this frame.
        const held = this.cursor;
        if (held) {
          const uv = desktopToUv(held, screen);
          return {
            ops: [{ op: "move", x: Math.round(held.x), y: Math.round(held.y) }],
            pose: "point",
            cursor: held,
            viz: {
              phase: "point",
              u: uv.x,
              v: uv.y,
              approach,
              hold: 0,
              quality,
            },
          };
        }
      }
    }
    this.lastUv = uvRaw;

    const rawTip = controlToDesktop(uvRaw.x, uvRaw.y, screen);
    const filtered = this.filter.filter(rawTip.x, rawTip.y, nowMs);
    const smoothed: Pt = { x: filtered.x, y: filtered.y };
    const anchor = handAnchor(landmarks, screen, cal, opts);

    const ops: InjectOp[] = [];

    // —— Fist = window drag (clears pinch) ——
    if (poseClass === "fist") {
      if (this.pinchMode !== "idle" || this.mouseDown) {
        if (this.mouseDown) {
          ops.push({ op: "up", button: "left" });
          this.mouseDown = false;
        }
        this.pinchMode = "idle";
        this.lockPos = null;
        this.didDrag = false;
      }
      this.releasing = false;
      this.cursor = smoothed;
      ops.push({ op: "move", x: Math.round(smoothed.x), y: Math.round(smoothed.y) });
      if (!this.wasFist) {
        this.wasFist = true;
        this.windowDragging = true;
        ops.push({ op: "win_grab", x: Math.round(smoothed.x), y: Math.round(smoothed.y) });
      } else if (this.windowDragging) {
        ops.push({ op: "win_drag", x: Math.round(smoothed.x), y: Math.round(smoothed.y) });
      }
      const uv = desktopToUv(smoothed, screen);
      return {
        ops,
        pose: "fist",
        cursor: smoothed,
        viz: { phase: "fist", u: uv.x, v: uv.y, approach: 0, hold: 0, quality },
      };
    }
    if (this.wasFist) {
      this.wasFist = false;
      if (this.windowDragging) {
        this.windowDragging = false;
        ops.push({ op: "win_drop" });
      }
    }

    // —— Two-finger scroll ——
    if (poseClass === "two_finger") {
      if (this.pinchMode !== "idle" || this.mouseDown) {
        if (this.mouseDown) {
          ops.push({ op: "up", button: "left" });
          this.mouseDown = false;
        }
        this.pinchMode = "idle";
        this.lockPos = null;
      }
      this.releasing = false;
      this.cursor = smoothed;
      ops.push({ op: "move", x: Math.round(smoothed.x), y: Math.round(smoothed.y) });
      if (this.scrollAnchorY == null) {
        this.scrollAnchorY = landmarks[8].y;
      } else {
        const dy = landmarks[8].y - this.scrollAnchorY;
        if (Math.abs(dy) >= SCROLL_THRESHOLD) {
          const ticks = Math.round(dy / SCROLL_THRESHOLD);
          if (ticks) ops.push({ op: "scroll", dy: ticks });
          this.scrollAnchorY = landmarks[8].y;
        }
      }
      const uv = desktopToUv(smoothed, screen);
      return {
        ops,
        pose: "two_finger",
        cursor: smoothed,
        viz: { phase: "scroll", u: uv.x, v: uv.y, approach: 0, hold: 0, quality },
      };
    }
    this.scrollAnchorY = null;

    // —— Smooth release blend back to tip ——
    if (this.releasing && this.releaseFrom) {
      const t = clamp01((nowMs - this.releaseStartMs) / RELEASE_BLEND_MS);
      const blended = {
        x: lerp(this.releaseFrom.x, smoothed.x, t),
        y: lerp(this.releaseFrom.y, smoothed.y, t),
      };
      this.cursor = blended;
      ops.push({ op: "move", x: Math.round(blended.x), y: Math.round(blended.y) });
      if (t >= 1) {
        this.releasing = false;
        this.releaseFrom = null;
      }
      if (pinchNorm > s.pinchRelease) {
        const uv = desktopToUv(blended, screen);
        return {
          ops,
          pose: "releasing",
          cursor: blended,
          viz: { phase: "releasing", u: uv.x, v: uv.y, approach, hold: 0, quality },
        };
      }
      this.releasing = false;
      this.releaseFrom = null;
    }

    // —— Pinch lock / click / drag (hysteresis: activate vs release) ——
    const wantLock =
      this.pinchMode === "idle"
        ? pinchNorm <= s.pinchActivate
        : pinchNorm <= s.pinchRelease;

    if (wantLock) {
      if (this.pinchMode === "idle") {
        this.lockPos = { ...(this.cursor ?? smoothed) };
        this.pinchMode = "locked";
        this.pinchStartMs = nowMs;
        this.dragAnchor0 = { ...anchor };
        this.didDrag = false;
        // Freeze filter at lock so release doesn't inherit pinch velocity.
        this.filter.reset(this.lockPos);
      }

      const lock = this.lockPos!;
      const holdMs = nowMs - this.pinchStartMs;
      const hold = clamp01(holdMs / s.dragArmMs);
      const moveFromStart = this.dragAnchor0 ? dist(anchor, this.dragAnchor0) : 0;

      if (this.pinchMode === "locked" && holdMs >= s.dragArmMs) {
        this.pinchMode = "drag_ready";
      }

      if (
        (this.pinchMode === "drag_ready" || this.pinchMode === "locked") &&
        holdMs >= s.dragArmMs &&
        moveFromStart >= s.dragMovePx
      ) {
        this.pinchMode = "dragging";
        this.didDrag = true;
        this.dragAnchor0 = { ...anchor };
        ops.push({ op: "move", x: Math.round(lock.x), y: Math.round(lock.y) });
        ops.push({ op: "down", button: "left" });
        this.mouseDown = true;
      }

      if (this.pinchMode === "dragging" && this.dragAnchor0) {
        const c = {
          x: lock.x + (anchor.x - this.dragAnchor0.x),
          y: lock.y + (anchor.y - this.dragAnchor0.y),
        };
        this.cursor = c;
        ops.push({ op: "move", x: Math.round(c.x), y: Math.round(c.y) });
        const uv = desktopToUv(c, screen);
        return {
          ops,
          pose: "dragging",
          cursor: c,
          viz: {
            phase: "dragging",
            u: uv.x,
            v: uv.y,
            approach: 1,
            hold: 1,
            locked: true,
            quality,
          },
        };
      }

      this.cursor = lock;
      ops.push({ op: "move", x: Math.round(lock.x), y: Math.round(lock.y) });
      const phase: CursorPhase =
        this.pinchMode === "drag_ready" ? "drag_ready" : "locked";
      const uv = desktopToUv(lock, screen);
      return {
        ops,
        pose: phase,
        cursor: lock,
        viz: {
          phase,
          u: uv.x,
          v: uv.y,
          approach: 1,
          hold,
          locked: true,
          quality,
        },
      };
    }

    if (this.pinchMode !== "idle") {
      this.endPinchGesture(nowMs, ops);
      const c = this.cursor ?? smoothed;
      ops.push({ op: "move", x: Math.round(c.x), y: Math.round(c.y) });
      const uv = desktopToUv(c, screen);
      return {
        ops,
        pose: "releasing",
        cursor: c,
        viz: { phase: "releasing", u: uv.x, v: uv.y, approach, hold: 0, quality },
      };
    }

    // —— Normal pointing with approach dampening ——
    let target = smoothed;
    if (approach > 0 && pinchNorm > s.pinchActivate) {
      const damp = 1 - approach * 0.92;
      if (this.cursor) {
        target = {
          x: this.cursor.x + (target.x - this.cursor.x) * damp,
          y: this.cursor.y + (target.y - this.cursor.y) * damp,
        };
      }
    }
    this.cursor = target;
    ops.push({ op: "move", x: Math.round(target.x), y: Math.round(target.y) });
    const phase: CursorPhase = approach > 0.15 ? "approach" : "point";
    const uv = desktopToUv(target, screen);
    return {
      ops,
      pose: phase === "approach" ? "approach" : "point",
      cursor: target,
      viz: { phase, u: uv.x, v: uv.y, approach, hold: 0, quality },
    };
  }
}
