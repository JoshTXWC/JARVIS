/**
 * Floating panels live inside the main content stage:
 *   viewport − header − footer − side pad (px-2 = 8).
 */
export const EDGE_PAD = 8;       // px-2 side padding
export const HEADER_H = 72;      // brand + icon dock
/** Slim strip for floating chrome controls. */
export const FOOTER_H = 44;
/** Top strip where releasing a tile docks it back into the icon menu. */
export const DOCK_ZONE_H = 72;

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
    left: EDGE_PAD,
    top: HEADER_H + 2,
    right: vw - EDGE_PAD,
    bottom: vh - FOOTER_H - 2,
  };
}

export function inDockZone(clientY: number): boolean {
  return clientY <= DOCK_ZONE_H;
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
