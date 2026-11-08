/**
 * Bridge shared MediaPipe frames → backend desktop-control + Electron overlay.
 * Never opens a second camera.
 */
import { wsClient } from "../ws";
import type { HandsFrame } from "./types";

declare global {
  interface Window {
    jarvis?: {
      send: (channel: string, payload?: unknown) => void;
      invoke?: (channel: string, payload?: unknown) => Promise<unknown>;
      on: (channel: string, cb: (...args: unknown[]) => void) => () => void;
    };
  }
}

let lastOverlayMs = 0;
const OVERLAY_MIN_MS = 16;

export function publishHandsFrame(frame: HandsFrame, opts?: { overlay?: boolean }) {
  // Backend injection (Precision / Spatial). HUD mode ignores inject server-side.
  wsClient.send({ type: "hands_frame", ...frame });

  // Desktop skeleton overlay via Electron IPC (throttled ~60 Hz).
  if (opts?.overlay !== false && window.jarvis?.send) {
    const now = frame.t || performance.now();
    if (now - lastOverlayMs >= OVERLAY_MIN_MS) {
      lastOverlayMs = now;
      window.jarvis.send("jarvis:hands-overlay-frame", frame);
    }
  }
}

export function requestDesktopOverlay(open: boolean) {
  window.jarvis?.send?.(open ? "jarvis:desktop-overlay-open" : "jarvis:desktop-overlay-close");
}

export function sendDesktopControlAction(
  action: string,
  payload: Record<string, unknown> = {},
) {
  wsClient.send({ type: "desktop_control", action, ...payload });
}

/** Compact landmarks for the wire (drop unused z precision). */
export function packLandmarks(
  hands: Array<Array<{ x: number; y: number; z?: number }>>,
): Array<Array<[number, number, number]>> {
  return hands.map((h) =>
    h.map((p) => [p.x, p.y, p.z ?? 0] as [number, number, number]),
  );
}
