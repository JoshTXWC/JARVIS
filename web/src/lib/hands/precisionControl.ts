/**
 * Combined desktop hand control (Mouse + Windows).
 *
 * Cursor = dominant-hand index tip (landmark 8) with adaptive smoothing.
 * Pinch approach dampens → early lock → short release = click;
 * hold ~400ms + deliberate move = drag from knuckle/palm anchor.
 * Fist = window drag · two fingers = scroll · quick double short-pinch = right click.
 */

export type Pt = { x: number; y: number };
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

export type ScreenRect = { x: number; y: number; width: number; height: number };

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
};

const PINCH = 0.048;
/** Start dampening before contact — index already drifts toward thumb. */
const APPROACH_START = 0.13;
/** Lock slightly before fingers touch. */
const LOCK_DIST = 0.072;
const SCROLL_THRESHOLD = 0.018;
const DOUBLE_PINCH_MS = 420;
const DRAG_ARM_MS = 400;
/** Screen-pixel movement of knuckle/palm required to start drag. */
const DRAG_MOVE_PX = 28;
/** Adaptive smoothing: slow → more filter, fast → stick to tip. */
const SMOOTH_SLOW = 0.38;
const SMOOTH_FAST = 0.88;
const SPEED_REF_PX = 42;
const RELEASE_BLEND_MS = 160;

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

function clamp01(t: number) {
  return Math.min(1, Math.max(0, t));
}

export function classifyPose(
  lm: Array<{ x: number; y: number }>,
): "pinch" | "fist" | "open" | "two_finger" {
  if (lm.length < 21) return "open";
  if (dist(tip(lm, 8), tip(lm, 4)) < PINCH) return "pinch";
  const indexUp = !folded(lm, 8, 5);
  const midUp = !folded(lm, 12, 9);
  if (indexUp && midUp && folded(lm, 16, 13) && folded(lm, 20, 17)) return "two_finger";
  if (folded(lm, 8, 5) && folded(lm, 12, 9) && folded(lm, 16, 13) && folded(lm, 20, 17)) {
    return "fist";
  }
  return "open";
}

/** Mirror + map into calibrated region → screen pixels. */
export function landmarkToScreen(
  nx: number,
  ny: number,
  screen: ScreenRect,
  cal = { x0: 0.12, y0: 0.08, x1: 0.88, y1: 0.92 },
): Pt {
  const x = 1 - Math.min(1, Math.max(0, nx));
  const y = Math.min(1, Math.max(0, ny));
  const w = Math.max(1e-6, cal.x1 - cal.x0);
  const h = Math.max(1e-6, cal.y1 - cal.y0);
  const u = Math.min(1, Math.max(0, (x - cal.x0) / w));
  const v = Math.min(1, Math.max(0, (y - cal.y0) / h));
  return {
    x: screen.x + u * (screen.width - 1),
    y: screen.y + v * (screen.height - 1),
  };
}

function toUv(pt: Pt, screen: ScreenRect): { u: number; v: number } {
  return {
    u: clamp01((pt.x - screen.x) / Math.max(1, screen.width - 1)),
    v: clamp01((pt.y - screen.y) / Math.max(1, screen.height - 1)),
  };
}

/** Stable hand anchor for relative drag — index MCP blended with palm. */
function handAnchor(lm: Array<{ x: number; y: number }>, screen: ScreenRect): Pt {
  const knuckle = landmarkToScreen(lm[5].x, lm[5].y, screen);
  const palm = landmarkToScreen(lm[0].x, lm[0].y, screen);
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

  private smoothed: Pt | null = null;
  private cursor: Pt | null = null;

  private pinchMode: PinchMode = "idle";
  private lockPos: Pt | null = null;
  private pinchStartMs = 0;
  private dragAnchor0: Pt | null = null;
  private didDrag = false;
  private mouseDown = false;

  private releasing = false;
  private releaseFrom: Pt | null = null;
  private releaseStartMs = 0;

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
    this.smoothed = null;
    this.cursor = null;
    this.pinchMode = "idle";
    this.lockPos = null;
    this.pinchStartMs = 0;
    this.dragAnchor0 = null;
    this.didDrag = false;
    this.releasing = false;
    this.releaseFrom = null;
    return ops;
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
      // Short pinch → click at lock. Double short-pinch → right click.
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

  /**
   * Returns OS inject ops + viz for this frame.
   * Cursor tracks landmark 8 (never palm / pinch midpoint).
   */
  frame(
    landmarks: Array<{ x: number; y: number }> | null,
    screen: ScreenRect,
    nowMs: number,
  ): { ops: InjectOp[]; pose: string; cursor: Pt | null; viz: CursorViz | null } {
    if (!landmarks || landmarks.length < 21) {
      const ops = this.reset();
      return {
        ops,
        pose: "lost",
        cursor: null,
        viz: { phase: "lost", u: 0.5, v: 0.5, approach: 0, hold: 0 },
      };
    }

    const poseClass = classifyPose(landmarks);
    const pinchDist = dist(tip(landmarks, 8), tip(landmarks, 4));
    const approach = clamp01(
      1 - (pinchDist - PINCH) / Math.max(1e-6, APPROACH_START - PINCH),
    );

    // Raw index tip (landmark 8) — never palm / pinch midpoint.
    const rawTip = landmarkToScreen(landmarks[8].x, landmarks[8].y, screen);
    const anchor = handAnchor(landmarks, screen);

    // —— Adaptive smoothing toward tip ——
    if (!this.smoothed) {
      this.smoothed = { ...rawTip };
    } else {
      const speed = dist(rawTip, this.smoothed);
      const alpha = lerp(SMOOTH_SLOW, SMOOTH_FAST, clamp01(speed / SPEED_REF_PX));
      this.smoothed = {
        x: lerp(this.smoothed.x, rawTip.x, alpha),
        y: lerp(this.smoothed.y, rawTip.y, alpha),
      };
    }

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
      const c = this.smoothed!;
      this.cursor = c;
      ops.push({ op: "move", x: Math.round(c.x), y: Math.round(c.y) });
      if (!this.wasFist) {
        this.wasFist = true;
        this.windowDragging = true;
        ops.push({ op: "win_grab", x: Math.round(c.x), y: Math.round(c.y) });
      } else if (this.windowDragging) {
        ops.push({ op: "win_drag", x: Math.round(c.x), y: Math.round(c.y) });
      }
      const uv = toUv(c, screen);
      return {
        ops,
        pose: "fist",
        cursor: c,
        viz: { phase: "fist", u: uv.u, v: uv.v, approach: 0, hold: 0 },
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
      const c = this.smoothed!;
      this.cursor = c;
      ops.push({ op: "move", x: Math.round(c.x), y: Math.round(c.y) });
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
      const uv = toUv(c, screen);
      return {
        ops,
        pose: "two_finger",
        cursor: c,
        viz: { phase: "scroll", u: uv.u, v: uv.v, approach: 0, hold: 0 },
      };
    }
    this.scrollAnchorY = null;

    // —— Smooth release blend back to tip ——
    if (this.releasing && this.releaseFrom) {
      const t = clamp01((nowMs - this.releaseStartMs) / RELEASE_BLEND_MS);
      const blended = {
        x: lerp(this.releaseFrom.x, this.smoothed!.x, t),
        y: lerp(this.releaseFrom.y, this.smoothed!.y, t),
      };
      this.cursor = blended;
      ops.push({ op: "move", x: Math.round(blended.x), y: Math.round(blended.y) });
      if (t >= 1) {
        this.releasing = false;
        this.releaseFrom = null;
      }
      // Allow re-lock if user pinches again mid-release
      if (pinchDist > LOCK_DIST) {
        const uv = toUv(blended, screen);
        return {
          ops,
          pose: "releasing",
          cursor: blended,
          viz: { phase: "releasing", u: uv.u, v: uv.v, approach, hold: 0 },
        };
      }
      this.releasing = false;
      this.releaseFrom = null;
    }

    // —— Pinch lock / click / drag ——
    const wantLock = pinchDist <= LOCK_DIST;

    if (wantLock) {
      if (this.pinchMode === "idle") {
        // Lock at current tip — before contact jitter.
        this.lockPos = { ...(this.cursor ?? this.smoothed!) };
        this.pinchMode = "locked";
        this.pinchStartMs = nowMs;
        this.dragAnchor0 = { ...anchor };
        this.didDrag = false;
      }

      const lock = this.lockPos!;
      const holdMs = nowMs - this.pinchStartMs;
      const hold = clamp01(holdMs / DRAG_ARM_MS);
      const moveFromStart = this.dragAnchor0
        ? dist(anchor, this.dragAnchor0)
        : 0;

      if (this.pinchMode === "locked" && holdMs >= DRAG_ARM_MS) {
        this.pinchMode = "drag_ready";
      }

      if (
        (this.pinchMode === "drag_ready" || this.pinchMode === "locked") &&
        holdMs >= DRAG_ARM_MS &&
        moveFromStart >= DRAG_MOVE_PX
      ) {
        // Arm drag: mouse down at lock, then follow hand anchor delta.
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
        const uv = toUv(c, screen);
        return {
          ops,
          pose: "dragging",
          cursor: c,
          viz: { phase: "dragging", u: uv.u, v: uv.v, approach: 1, hold: 1 },
        };
      }

      // Locked / drag_ready — cursor stays put; ignore tip jitter from pinch.
      this.cursor = lock;
      ops.push({ op: "move", x: Math.round(lock.x), y: Math.round(lock.y) });
      const phase: CursorPhase =
        this.pinchMode === "drag_ready" ? "drag_ready" : "locked";
      const uv = toUv(lock, screen);
      return {
        ops,
        pose: phase,
        cursor: lock,
        viz: { phase, u: uv.u, v: uv.v, approach: 1, hold },
      };
    }

    // Pinch released
    if (this.pinchMode !== "idle") {
      this.endPinchGesture(nowMs, ops);
      const c = this.cursor ?? this.smoothed!;
      ops.push({ op: "move", x: Math.round(c.x), y: Math.round(c.y) });
      const uv = toUv(c, screen);
      return {
        ops,
        pose: "releasing",
        cursor: c,
        viz: { phase: "releasing", u: uv.u, v: uv.v, approach, hold: 0 },
      };
    }

    // —— Normal pointing with approach dampening ——
    let target = this.smoothed!;
    if (approach > 0 && pinchDist > LOCK_DIST) {
      // Progressively freeze as fingers close — stabilize before lock.
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
    const uv = toUv(target, screen);
    return {
      ops,
      pose: phase === "approach" ? "approach" : "point",
      cursor: target,
      viz: { phase, u: uv.u, v: uv.v, approach, hold: 0 },
    };
  }
}
