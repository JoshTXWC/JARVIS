/**
 * Unified Hands — single MediaPipe tracker.
 * Webcam = darkened full-bleed background under the HUD.
 * One circle per hand + landmark nodes.
 * Pinch=click · fist=drag · two hands=scale.
 */
import { useEffect, useRef } from "react";
import {
  packLandmarks,
  publishHandsFrame,
  requestDesktopOverlay,
} from "../../lib/hands/desktopBridge";
import { useStore } from "../../lib/store";

const PINCH_THRESHOLD = 0.05;
/** Detect every animation frame for snappy tracking. */
const DETECT_MS = 0;
const STATUS_MS = 500;
/** 1 = raw fingertip (lowest cursor lag). */
const FOLLOW = 1;

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

type Pt = { x: number; y: number };

function dist(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function isFingerFolded(
  landmarks: Array<{ x: number; y: number; z: number }>,
  tipIdx: number,
  mcpIdx: number,
): boolean {
  const tip = landmarks[tipIdx];
  const mcp = landmarks[mcpIdx];
  const wrist = landmarks[0];
  return dist(tip, wrist) < dist(mcp, wrist);
}

/**
 * Map a MediaPipe landmark onto the screen, matching the mirrored
 * object-cover video so the cursor sits on the visible hand.
 */
function mapLandmark(
  p: Pt,
  videoW: number,
  videoH: number,
  screenW: number,
  screenH: number,
): Pt {
  if (videoW <= 0 || videoH <= 0) {
    return { x: (1 - p.x) * screenW, y: p.y * screenH };
  }
  const scale = Math.max(screenW / videoW, screenH / videoH);
  const dispW = videoW * scale;
  const dispH = videoH * scale;
  const offsetX = (screenW - dispW) / 2;
  const offsetY = (screenH - dispH) / 2;
  // Video CSS uses scaleX(-1) — mirror X to match what you see.
  return {
    x: offsetX + (1 - p.x) * dispW,
    y: offsetY + p.y * dispH,
  };
}

function handLabel(
  landmarks: Array<{ x: number; y: number; z: number }>,
): "pinch" | "fist" | "open" {
  const pinch = dist(landmarks[8], landmarks[4]) < PINCH_THRESHOLD;
  if (pinch) return "pinch";
  const fist =
    isFingerFolded(landmarks, 8, 5) &&
    isFingerFolded(landmarks, 12, 9) &&
    isFingerFolded(landmarks, 16, 13) &&
    isFingerFolded(landmarks, 20, 17);
  return fist ? "fist" : "open";
}

function drawHandNodes(
  ctx: CanvasRenderingContext2D,
  landmarks: Array<{ x: number; y: number; z: number }>,
  videoW: number,
  videoH: number,
  sw: number,
  sh: number,
) {
  const pts = landmarks.map((p) => mapLandmark(p, videoW, videoH, sw, sh));
  ctx.strokeStyle = "rgba(34,211,238,0.55)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (const [a, b] of CONNECTIONS) {
    const A = pts[a];
    const B = pts[b];
    if (!A || !B) continue;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  }
  for (let i = 0; i < pts.length; i++) {
    const M = pts[i];
    const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
    ctx.beginPath();
    ctx.fillStyle = tip
      ? "rgba(224,242,254,0.95)"
      : "rgba(125,211,252,0.9)";
    ctx.arc(M.x, M.y, tip ? 4.5 : 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default function GestureOverlay() {
  const enabled = useStore((s) => s.gestureEnabled);
  const showCam = useStore((s) => s.handsShowCam);
  const setHandsShowCam = useStore((s) => s.setHandsShowCam);
  const setGestureStatus = useStore((s) => s.setGestureStatus);
  const desktopControlEnabled = useStore((s) => s.desktopControlEnabled);
  const desktopControlMode = useStore((s) => s.desktopControlMode);
  const desktopOverlayEnabled = useStore((s) => s.desktopOverlayEnabled);
  const desktopPaused = useStore((s) => s.desktopPaused);
  const setDesktopGesture = useStore((s) => s.setDesktopGesture);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cloudRef = useRef<HTMLCanvasElement>(null);
  const circleRefs = useRef<[HTMLDivElement | null, HTMLDivElement | null]>([null, null]);
  const landmarkerRef = useRef<any>(null);
  const rafRef = useRef(0);
  const lastDetectRef = useRef(0);
  const lastStatusRef = useRef(0);
  const lastPinchRef = useRef([false, false]);
  const dragIdRef = useRef<string | null>(null);
  const lastCursorRef = useRef<Pt>({ x: 0, y: 0 });
  const smoothRef = useRef<[Pt | null, Pt | null]>([null, null]);
  const scaleIdRef = useRef<string | null>(null);
  const scaleBaseDistRef = useRef(0);
  const scaleBaseBoxRef = useRef<{ w: number; h: number } | null>(null);
  /** When Precision/Spatial inject OS input, skip HUD DOM click/drag. */
  const desktopInjectRef = useRef(false);
  const desktopControlEnabledRef = useRef(desktopControlEnabled);
  const desktopOverlayEnabledRef = useRef(desktopOverlayEnabled);
  desktopControlEnabledRef.current = desktopControlEnabled;
  desktopOverlayEnabledRef.current = desktopOverlayEnabled;
  desktopInjectRef.current =
    desktopControlEnabled &&
    !desktopPaused &&
    (desktopControlMode === "precision" || desktopControlMode === "spatial");

  useEffect(() => {
    if (!enabled) {
      stop();
      setGestureStatus("");
      requestDesktopOverlay(false);
      try {
        delete document.body.dataset.jarvisHands;
      } catch { /* noop */ }
      return;
    }
    try {
      document.body.dataset.jarvisHands = "1";
    } catch { /* noop */ }

    let cancelled = false;

    const boot = async () => {
      try {
        setGestureStatus("hands loading…");
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
        landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
        if (cancelled) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 60, max: 60 },
            facingMode: "user",
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setGestureStatus("hands · pinch=click · fist=drag · 2 hands=scale");
        tick();
      } catch (e: any) {
        console.error("[hands]", e);
        setGestureStatus(`hands failed: ${e?.message || e}`);
      }
    };

    const paintCircle = (
      idx: number,
      pos: Pt | null,
      mode: "pinch" | "fist" | "open" | null,
    ) => {
      const el = circleRefs.current[idx];
      if (!el) return;
      if (!pos || !mode) {
        el.style.opacity = "0";
        return;
      }
      el.style.opacity = "1";
      el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%)`;
      el.dataset.mode = mode;
    };

    const smoothToward = (idx: number, target: Pt): Pt => {
      const prev = smoothRef.current[idx];
      if (!prev) {
        smoothRef.current[idx] = { ...target };
        return target;
      }
      const next = {
        x: prev.x + (target.x - prev.x) * FOLLOW,
        y: prev.y + (target.y - prev.y) * FOLLOW,
      };
      smoothRef.current[idx] = next;
      return next;
    };

    const tick = () => {
      const video = videoRef.current;
      const cloud = cloudRef.current;
      const lm = landmarkerRef.current;
      const now = performance.now();
      if (!video || !lm || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (now - lastDetectRef.current >= DETECT_MS) {
        lastDetectRef.current = now;
        const videoW = video.videoWidth || 1280;
        const videoH = video.videoHeight || 720;
        const sw = window.innerWidth;
        const sh = window.innerHeight;

        if (cloud) {
          if (cloud.width !== sw || cloud.height !== sh) {
            cloud.width = sw;
            cloud.height = sh;
          }
        }

        let result: any;
        try {
          result = lm.detectForVideo(video, now);
        } catch {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        const hands = (result?.landmarks || []) as Array<
          Array<{ x: number; y: number; z: number }>
        >;

        const cctx = cloud?.getContext("2d");
        if (cctx && cloud) {
          cctx.clearRect(0, 0, cloud.width, cloud.height);
          for (const landmarks of hands) {
            drawHandNodes(cctx, landmarks, videoW, videoH, sw, sh);
          }
        }

        const primary: {
          mode: "pinch" | "fist" | "open";
          tip: Pt;
        }[] = [];

        for (let i = 0; i < Math.min(2, hands.length); i++) {
          const landmarks = hands[i];
          const mode = handLabel(landmarks);
          const raw = mapLandmark(landmarks[8], videoW, videoH, sw, sh);
          const tip = smoothToward(i, raw);
          primary.push({ mode, tip });
          paintCircle(i, tip, mode);
        }
        for (let i = hands.length; i < 2; i++) {
          smoothRef.current[i] = null;
          paintCircle(i, null, null);
        }

        // Shared pipeline → desktop control + system-wide overlay (no 2nd camera).
        if (desktopControlEnabledRef.current || desktopOverlayEnabledRef.current) {
          publishHandsFrame(
            {
              t: now,
              hands: packLandmarks(hands),
              lost: hands.length === 0,
              poses: primary.map((p) => p.mode),
            },
            { overlay: desktopOverlayEnabledRef.current },
          );
          if (primary[0]) setDesktopGesture(primary[0].mode);
          else setDesktopGesture(hands.length ? "track" : "lost");
        }

        // Broadcast index-finger cursor for Neural + any listeners (raw, no lag).
        if (primary[0]) {
          window.dispatchEvent(
            new CustomEvent("jarvis:hands-pointer", {
              detail: {
                x: primary[0].tip.x,
                y: primary[0].tip.y,
                mode: primary[0].mode,
                pinch: primary[0].mode === "pinch",
                pinch2: primary[1]?.mode === "pinch",
                fist: primary[0].mode === "fist",
                hands: primary.length,
                x2: primary[1]?.tip.x,
                y2: primary[1]?.tip.y,
              },
            }),
          );
        } else {
          window.dispatchEvent(
            new CustomEvent("jarvis:hands-pointer", {
              detail: {
                x: -1, y: -1, mode: null, pinch: false, pinch2: false, fist: false, hands: 0,
              },
            }),
          );
        }

        // —— One-hand cursor actions (hand 0) —— HUD only when not injecting OS input
        if (desktopInjectRef.current) {
          lastPinchRef.current[0] = primary[0]?.mode === "pinch";
          // Still release any in-progress HUD drag if we switched modes mid-grab.
          if (dragIdRef.current) {
            window.dispatchEvent(
              new CustomEvent("jarvis:gesture-release", {
                detail: { id: dragIdRef.current, x: -1, y: -1 },
              }),
            );
            dragIdRef.current = null;
          }
          if (scaleIdRef.current) {
            window.dispatchEvent(
              new CustomEvent("jarvis:gesture-release", {
                detail: { id: scaleIdRef.current },
              }),
            );
            scaleIdRef.current = null;
          }
        } else if (primary[0]) {
          const { tip, mode } = primary[0];
          const pinchNow = mode === "pinch";
          // Index finger = cursor: pinch selects like a click (never while dragging a tile,
          // and never on dock icons during / right after a dock drop).
          if (pinchNow && !lastPinchRef.current[0] && !dragIdRef.current) {
            const st = useStore.getState();
            const dockLocked =
              st.dockHot || Date.now() < st.dockDropLockUntil;
            const el = document.elementFromPoint(tip.x, tip.y) as HTMLElement | null;
            const overDock = !!el?.closest("#jarvis-icon-dock");
            if (!(dockLocked && overDock)) {
              const clickable = el?.closest(
                "button, a, input, [role='button'], [data-floating-id], [data-reticle]",
              ) as HTMLElement | null;
              if (!(overDock && dockLocked) && clickable && typeof clickable.click === "function") {
                if (!(clickable.closest("#jarvis-icon-dock") && dockLocked)) {
                  clickable.click();
                }
              } else if (el && typeof (el as any).click === "function" && !overDock) {
                (el as any).click();
              }
              window.dispatchEvent(
                new CustomEvent("jarvis:hands-click", {
                  detail: { x: tip.x, y: tip.y },
                }),
              );
            }
          }
          lastPinchRef.current[0] = pinchNow;

          if (mode === "fist" && primary.length < 2) {
            if (!dragIdRef.current) {
              const hit = document
                .elementFromPoint(tip.x, tip.y)
                ?.closest("[data-floating-id]") as HTMLElement | null;
              const id = hit?.getAttribute("data-floating-id");
              if (id) {
                dragIdRef.current = id;
                lastCursorRef.current = tip;
                window.dispatchEvent(
                  new CustomEvent("jarvis:gesture-grab", { detail: { id } }),
                );
              }
            } else {
              const dx = tip.x - lastCursorRef.current.x;
              const dy = tip.y - lastCursorRef.current.y;
              if (Math.abs(dx) > 0.15 || Math.abs(dy) > 0.15) {
                window.dispatchEvent(
                  new CustomEvent("jarvis:gesture-move", {
                    detail: {
                      id: dragIdRef.current,
                      dx,
                      dy,
                      x: tip.x,
                      y: tip.y,
                    },
                  }),
                );
                lastCursorRef.current = tip;
              }
            }
          } else if (dragIdRef.current && primary.length < 2) {
            window.dispatchEvent(
              new CustomEvent("jarvis:gesture-release", {
                detail: {
                  id: dragIdRef.current,
                  x: tip.x,
                  y: tip.y,
                },
              }),
            );
            dragIdRef.current = null;
          }
        } else {
          lastPinchRef.current[0] = false;
          smoothRef.current[0] = null;
          if (dragIdRef.current) {
            window.dispatchEvent(
              new CustomEvent("jarvis:gesture-release", {
                detail: { id: dragIdRef.current, x: -1, y: -1 },
              }),
            );
            dragIdRef.current = null;
          }
        }

        // —— Two-hand scale —— HUD tiles only (Spatial handles OS resize)
        if (!desktopInjectRef.current) {
          if (primary.length >= 2) {
            if (dragIdRef.current) {
              window.dispatchEvent(
                new CustomEvent("jarvis:gesture-release", {
                  detail: {
                    id: dragIdRef.current,
                    x: primary[0].tip.x,
                    y: primary[0].tip.y,
                  },
                }),
              );
              dragIdRef.current = null;
            }
            const d = dist(primary[0].tip, primary[1].tip);
            if (!scaleIdRef.current) {
              const mid = {
                x: (primary[0].tip.x + primary[1].tip.x) / 2,
                y: (primary[0].tip.y + primary[1].tip.y) / 2,
              };
              const hit = document
                .elementFromPoint(mid.x, mid.y)
                ?.closest("[data-floating-id]") as HTMLElement | null;
              const id = hit?.getAttribute("data-floating-id");
              if (id && d > 40) {
                scaleIdRef.current = id;
                scaleBaseDistRef.current = d;
                const rect = hit!.getBoundingClientRect();
                scaleBaseBoxRef.current = { w: rect.width, h: rect.height };
              }
            } else if (scaleBaseDistRef.current > 1 && scaleBaseBoxRef.current) {
              const factor = Math.max(
                0.55,
                Math.min(2.4, d / scaleBaseDistRef.current),
              );
              window.dispatchEvent(
                new CustomEvent("jarvis:gesture-scale", {
                  detail: {
                    id: scaleIdRef.current,
                    factor,
                    baseW: scaleBaseBoxRef.current.w,
                    baseH: scaleBaseBoxRef.current.h,
                  },
                }),
              );
            }
          } else if (scaleIdRef.current) {
            window.dispatchEvent(
              new CustomEvent("jarvis:gesture-release", {
                detail: { id: scaleIdRef.current },
              }),
            );
            scaleIdRef.current = null;
            scaleBaseDistRef.current = 0;
            scaleBaseBoxRef.current = null;
          }
        }

        if (now - lastStatusRef.current > STATUS_MS) {
          lastStatusRef.current = now;
          const modes = primary.map((p) => p.mode).join("+") || "—";
          setGestureStatus(
            `hands · ${primary.length} · ${modes} · pinch=click · fist=drag · 2=scale`,
          );
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    void boot();
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Overlay lifecycle — never reopen the webcam.
  useEffect(() => {
    if (enabled && desktopControlEnabled && desktopOverlayEnabled) {
      requestDesktopOverlay(true);
    } else {
      requestDesktopOverlay(false);
    }
  }, [enabled, desktopControlEnabled, desktopOverlayEnabled]);

  function stop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
    try {
      landmarkerRef.current?.close?.();
    } catch { /* noop */ }
    landmarkerRef.current = null;
    dragIdRef.current = null;
    scaleIdRef.current = null;
    smoothRef.current = [null, null];
    requestDesktopOverlay(false);
    try {
      delete document.body.dataset.jarvisHands;
    } catch { /* noop */ }
  }

  if (!enabled) return null;

  return (
    <>
      {/* Hidden video always runs for tracking; visible feed is optional */}
      <div
        className={`fixed inset-0 z-[1] pointer-events-none overflow-hidden transition-opacity duration-300 ${
          showCam ? "opacity-100" : "opacity-0"
        }`}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
          playsInline
          muted
          autoPlay
        />
        {showCam && (
          <>
            <div className="absolute inset-0 bg-[#020814]/55" />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse at center, transparent 20%, rgba(2,8,20,0.55) 100%)",
              }}
            />
          </>
        )}
      </div>

      {/* Landmark skeleton / nodes */}
      <canvas
        ref={cloudRef}
        className="fixed inset-0 z-[84] pointer-events-none w-full h-full"
      />

      {[0, 1].map((i) => (
        <div
          key={i}
          ref={(el) => {
            circleRefs.current[i] = el;
          }}
          className="hands-cursor fixed top-0 left-0 z-[86] pointer-events-none w-5 h-5 rounded-full opacity-0"
          data-mode="open"
          style={{ willChange: "transform" }}
        />
      ))}

      <button
        type="button"
        className="fixed bottom-20 right-3 z-[87] pointer-events-auto rounded-lg border border-jarvis-cyan/25 bg-black/70 px-2.5 py-1.5 text-mono text-[9px] tracking-[0.18em] uppercase text-jarvis-cyan/80 hover:text-jarvis-ice"
        title={showCam ? "Hide webcam — keep hand nodes" : "Show webcam background"}
        onClick={() => setHandsShowCam(!showCam)}
      >
        {showCam ? "cam on · tap=nodes only" : "cam off · tap=show cam"}
      </button>

      <style>{`
        .hands-cursor {
          border: 2px solid rgba(34, 211, 238, 0.85);
          background: rgba(34, 211, 238, 0.12);
          box-shadow: 0 0 14px rgba(34, 211, 238, 0.45);
        }
        .hands-cursor[data-mode="pinch"] {
          border-color: rgba(224, 242, 254, 0.95);
          background: rgba(224, 242, 254, 0.35);
        }
        .hands-cursor[data-mode="fist"] {
          border-color: rgba(252, 211, 77, 0.95);
          background: rgba(252, 211, 77, 0.28);
        }
      `}</style>
    </>
  );
}
