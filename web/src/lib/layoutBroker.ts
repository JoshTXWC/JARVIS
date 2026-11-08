/**
 * LAYOUT BROKER — collision-free spawn placement for Floating panels.
 * Uses the same content-stage bounds as drag clamping.
 */
import { contentBounds, EDGE_PAD, FOOTER_H, HEADER_H } from "./contentBounds";

export interface Rect { x: number; y: number; w: number; h: number }

const live: Map<string, Rect> = new Map();
const reserved: Rect[] = [];

const GAP = 8;
const SCAN_STEP = 24;

export function update(id: string, rect: Rect): void {
  live.set(id, rect);
}

export function release(id: string): void {
  live.delete(id);
}

export function reserve(zones: Rect[]): void {
  reserved.length = 0;
  reserved.push(...zones);
}

function overlaps(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w + GAP <= b.x ||
    b.x + b.w + GAP <= a.x ||
    a.y + a.h + GAP <= b.y ||
    b.y + b.h + GAP <= a.y
  );
}

function collisionFree(id: string, probe: Rect): boolean {
  for (const [otherId, r] of live) {
    if (otherId === id) continue;
    if (overlaps(probe, r)) return false;
  }
  for (const r of reserved) {
    if (overlaps(probe, r)) return false;
  }
  return true;
}

export function collidesAnything(id: string, rect: Rect): boolean {
  return !collisionFree(id, rect);
}

export function findSlot(
  id: string,
  requested: Rect,
  vw: number,
  vh: number,
): Rect {
  const bounds = contentBounds(vw, vh);
  const side = EDGE_PAD;
  const top = HEADER_H + EDGE_PAD;
  const bottom = FOOTER_H + EDGE_PAD;

  const w = Math.min(requested.w, Math.max(120, vw - side * 2));
  const h = Math.min(requested.h, Math.max(100, vh - top - bottom));

  const req: Rect = { x: requested.x, y: requested.y, w, h };
  if (
    req.x >= bounds.left &&
    req.y >= bounds.top &&
    req.x + req.w <= bounds.right &&
    req.y + req.h <= bounds.bottom &&
    collisionFree(id, req)
  ) {
    return req;
  }

  const maxX = bounds.right - w;
  const maxY = bounds.bottom - h;
  for (let cy = bounds.top; cy <= maxY; cy += SCAN_STEP) {
    for (let cx = bounds.left; cx <= maxX; cx += SCAN_STEP) {
      const probe: Rect = { x: cx, y: cy, w, h };
      if (collisionFree(id, probe)) return probe;
    }
  }

  const off = (live.size * 28) % 200;
  return {
    x: Math.max(bounds.left, Math.min(maxX, vw / 2 - w / 2 + off)),
    y: Math.max(bounds.top, Math.min(maxY, vh / 2 - h / 2 + off)),
    w,
    h,
  };
}
