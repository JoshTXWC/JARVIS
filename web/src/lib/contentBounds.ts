/**
 * Floating panels live on the main canvas around the centered orb.
 * Left strip is reserved for the side dock.
 */
export const EDGE_PAD = 12;
export const DOCK_W = 68;
export const HEADER_H = 12;
export const FOOTER_H = 12;
/** Left dock strip — releasing a tile here docks it. */
export const DOCK_ZONE_W = 88;

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function contentBounds(
  vw = typeof window !== "undefined" ? window.innerWidth : 1600,
  vh = typeof window !== "undefined" ? window.innerHeight : 900,
): Bounds {
  return {
    left: DOCK_W + EDGE_PAD,
    top: HEADER_H,
    right: vw - EDGE_PAD,
    bottom: vh - FOOTER_H,
  };
}

/** True when pointer is over the side dock strip or the dock element itself. */
export function inDockZone(clientY: number, clientX?: number): boolean {
  if (typeof clientX === "number" && clientX <= DOCK_ZONE_W) return true;
  const dock = typeof document !== "undefined"
    ? document.getElementById("jarvis-icon-dock")
    : null;
  if (!dock || clientX == null) return false;
  const r = dock.getBoundingClientRect();
  const pad = 20;
  return (
    clientX >= r.left - pad &&
    clientX <= r.right + pad &&
    clientY >= r.top - pad &&
    clientY <= r.bottom + pad
  );
}

export function clampBox(
  box: { x: number; y: number; w: number; h: number },
  vw?: number,
  vh?: number,
) {
  const W = vw ?? (typeof window !== "undefined" ? window.innerWidth : 1600);
  const H = vh ?? (typeof window !== "undefined" ? window.innerHeight : 900);
  const b = contentBounds(W, H);
  const maxW = Math.max(80, b.right - b.left);
  const maxH = Math.max(60, b.bottom - b.top);
  const w = Math.min(Math.max(80, box.w), maxW);
  const h = Math.min(Math.max(60, box.h), maxH);
  return {
    x: Math.max(b.left, Math.min(b.right - w, box.x)),
    y: Math.max(b.top, Math.min(b.bottom - h, box.y)),
    w,
    h,
  };
}
