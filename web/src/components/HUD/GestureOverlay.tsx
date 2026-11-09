/**
 * Unified Hands — single MediaPipe tracker.
 * Webcam = darkened full-bleed background under the HUD.
 * One circle per hand + landmark nodes.
 * Pinch=click · fist=drag · two hands=scale.
 *
 * Coordinate spaces are separated:
 *   camera → preview (HUD skeleton) via cameraToPreview
 *   camera → control → desktop via PrecisionController
 */
import { useEffect, useRef } from "react";
import {
  packLandmarks,
  publishHandsFrame,
  requestDesktopOverlay,
  sendDesktopInput,
  setDesktopInjectArmed,
} from "../../lib/hands/desktopBridge";
import { cameraToPreview, edgeProximity } from "../../lib/hands/coords";
import { handsDiagnostics } from "../../lib/hands/diagnostics";
import { HandIdentityTracker } from "../../lib/hands/handIdentity";
import {
  createHandLandmarker,
  FrameScheduler,
  openCamera,
} from "../../lib/hands/handsPipeline";
import { OneEuroFilter2D } from "../../lib/hands/oneEuro";
import { PrecisionController, type ScreenRect } from "../../lib/hands/precisionControl";
import {
  loadTrackingSettings,
  type TrackingQualitySettings,
} from "../../lib/hands/trackingSettings";
import { useStore } from "../../lib/store";

/** Backup tick while the HUD is occluded — Chromium can still starve RAF. */
const HIDDEN_DETECT_MS = 33;
const STATUS_MS = 500;
const DIAG_EMIT_MS = 250;

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
  return Math.hypot(a.x - b.x, a.y - b.y);
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

function handLabel(
  landmarks: Array<{ x: number; y: number; z: number }>,
): "pinch" | "fist" | "open" {
  const pinch = dist(landmarks[8], landmarks[4]) < 0.06;
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
  quality: number,
) {
  const pts = landmarks.map((p) =>
    cameraToPreview(p.x, p.y, videoW, videoH, sw, sh, true),
  );
  const edgeFade = 0.35 + quality * 0.65;
  ctx.strokeStyle = `rgba(34,211,238,${0.55 * edgeFade})`;
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
      ? `rgba(224,242,254,${0.95 * edgeFade})`
      : `rgba(125,211,252,${0.9 * edgeFade})`;
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
  const schedulerRef = useRef<FrameScheduler | null>(null);
  const processFrameRef = useRef<((now: number) => void) | null>(null);
  const hiddenTimerRef = useRef(0);
  const lastStatusRef = useRef(0);
  const lastDiagRef = useRef(0);
  const lastPinchRef = useRef([false, false]);
  const dragIdRef = useRef<string | null>(null);
  const lastCursorRef = useRef<Pt>({ x: 0, y: 0 });
  const vizFiltersRef = useRef<[OneEuroFilter2D, OneEuroFilter2D]>([
    new OneEuroFilter2D(),
    new OneEuroFilter2D(),
  ]);
  const scaleIdRef = useRef<string | null>(null);
  const scaleBaseDistRef = useRef(0);
  const scaleBaseBoxRef = useRef<{ w: number; h: number } | null>(null);
  const precisionRef = useRef(new PrecisionController());
  const identityRef = useRef(new HandIdentityTracker());
  const trackingRef = useRef<TrackingQualitySettings>(loadTrackingSettings());
  const screenRef = useRef<ScreenRect>({ x: 0, y: 0, width: 1920, height: 1080 });
  const desktopInjectRef = useRef(false);
  const desktopControlEnabledRef = useRef(desktopControlEnabled);
  const desktopOverlayEnabledRef = useRef(desktopOverlayEnabled);
  const desktopModeRef = useRef(desktopControlMode);
  const desktopPausedRef = useRef(desktopPaused);
  desktopControlEnabledRef.current = desktopControlEnabled;
  desktopOverlayEnabledRef.current = desktopOverlayEnabled;
  desktopModeRef.current = desktopControlMode;
  desktopPausedRef.current = desktopPaused;
  desktopInjectRef.current =
    desktopControlEnabled &&
    !desktopPaused &&
    (desktopControlMode === "precision" || desktopControlMode === "spatial");

  useEffect(() => {
    if (!enabled) {
      stop();
      setGestureStatus("");
      requestDesktopOverlay(false);
      window.jarvis?.send?.("jarvis:hands-active", false);
      try {
        delete document.body.dataset.jarvisHands;
      } catch { /* noop */ }
      return;
    }
    try {
      document.body.dataset.jarvisHands = "1";
    } catch { /* noop */ }
    window.jarvis?.send?.("jarvis:hands-active", true);

    let cancelled = false;
    const scheduler = new FrameScheduler();
    schedulerRef.current = scheduler;

    const onTrackingSettings = (e: Event) => {
      const detail = (e as CustomEvent).detail as TrackingQualitySettings | undefined;
      if (!detail) return;
      trackingRef.current = detail;
      precisionRef.current.configure(detail);
      vizFiltersRef.current[0].setParams(detail.vizFilter);
      vizFiltersRef.current[1].setParams(detail.vizFilter);
    };
    window.addEventListener("jarvis:tracking-settings", onTrackingSettings);

    const boot = async () => {
      try {
        setGestureStatus("hands loading…");
        const tracking = loadTrackingSettings();
        trackingRef.current = tracking;
        precisionRef.current.configure(tracking);
        vizFiltersRef.current[0].setParams(tracking.vizFilter);
        vizFiltersRef.current[1].setParams(tracking.vizFilter);

        const { landmarker, delegate } = await createHandLandmarker({
          confidence: tracking.confidenceMin,
        });
        if (cancelled) {
          landmarker.close?.();
          return;
        }
        landmarkerRef.current = landmarker;

        const stream = await openCamera({
          deviceId: tracking.cameraDeviceId || undefined,
          width: tracking.captureWidth,
          height: tracking.captureHeight,
          fps: tracking.captureFps,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings?.() || {};
        handsDiagnostics.setMeta({
          delegate,
          resolution: `${settings.width || tracking.captureWidth}×${settings.height || tracking.captureHeight}`,
          cameraLabel: track?.label || "camera",
        });

        setGestureStatus("hands · tip cursor · pinch lock · hold-drag · fist=window");

        const processFrame = (now: number) => {
          const videoEl = videoRef.current;
          const cloud = cloudRef.current;
          const lm = landmarkerRef.current;
          if (!videoEl || !lm || videoEl.readyState < 2) return;

          handsDiagnostics.markCameraFrame(now);

          const videoW = videoEl.videoWidth || 1280;
          const videoH = videoEl.videoHeight || 720;
          const sw = window.innerWidth;
          const sh = window.innerHeight;

          if (cloud) {
            if (cloud.width !== sw || cloud.height !== sh) {
              cloud.width = sw;
              cloud.height = sh;
            }
          }

          const t0 = performance.now();
          let result: any;
          try {
            result = lm.detectForVideo(videoEl, now);
          } catch {
            handsDiagnostics.markDropped();
            return;
          }
          const t1 = performance.now();

          const hands = (result?.landmarks || []) as Array<
            Array<{ x: number; y: number; z: number }>
          >;
          const handednessLabels: string[] = (result?.handednesses || []).map(
            (h: any) => h?.[0]?.categoryName || h?.[0]?.displayName || "",
          );
          const scores: number[] = (result?.handednesses || []).map(
            (h: any) => h?.[0]?.score ?? 1,
          );

          const slots = identityRef.current.update(
            hands,
            handednessLabels,
            scores,
            trackingRef.current.primaryHand,
          );
          if (slots.remapped) {
            precisionRef.current.onHandIdentityChange();
          }

          const orderedHands: typeof hands = [];
          if (slots.dominant) orderedHands.push(slots.dominant.landmarks as any);
          if (slots.secondary) orderedHands.push(slots.secondary.landmarks as any);

          const qualities = orderedHands.map((h) => {
            const tip8 = h[8];
            return 1 - edgeProximity(tip8.x, tip8.y, 0.1);
          });

          const cctx = cloud?.getContext("2d", { alpha: true });
          if (cctx && cloud) {
            cctx.clearRect(0, 0, cloud.width, cloud.height);
            for (let i = 0; i < orderedHands.length; i++) {
              drawHandNodes(
                cctx,
                orderedHands[i],
                videoW,
                videoH,
                sw,
                sh,
                qualities[i] ?? 1,
              );
            }
          }

          const primary: {
            mode: "pinch" | "fist" | "open";
            tip: Pt;
          }[] = [];

          for (let i = 0; i < Math.min(2, orderedHands.length); i++) {
            const landmarks = orderedHands[i];
            const mode = handLabel(landmarks);
            const raw = cameraToPreview(
              landmarks[8].x,
              landmarks[8].y,
              videoW,
              videoH,
              sw,
              sh,
              true,
            );
            // Separate viz filter — does not drive desktop cursor.
            const tip = vizFiltersRef.current[i].filter(raw.x, raw.y, now);
            primary.push({ mode, tip });
            paintCircle(i, tip, mode);
          }
          for (let i = orderedHands.length; i < 2; i++) {
            vizFiltersRef.current[i].reset();
            paintCircle(i, null, null);
          }

          const controlArmed =
            desktopControlEnabledRef.current &&
            !desktopPausedRef.current &&
            (desktopModeRef.current === "precision" ||
              desktopModeRef.current === "spatial");
          let controlPose: string | null = null;
          let controlCursor: {
            phase: string;
            u: number;
            v: number;
            approach: number;
            hold: number;
          } | null = null;

          let cursorForDiag: Pt | undefined;
          if (controlArmed) {
            const controlLm = slots.dominant?.landmarks || null;
            const { ops, pose, viz, cursor } = precisionRef.current.frame(
              controlLm,
              screenRef.current,
              now,
            );
            for (const op of ops) sendDesktopInput(op);
            controlPose = pose;
            controlCursor = viz;
            cursorForDiag = cursor ?? undefined;
            setDesktopGesture(pose);
          } else if (primary[0]) {
            setDesktopGesture(primary[0].mode);
          } else {
            setDesktopGesture(hands.length ? "track" : "seeking");
          }

          const avgQ =
            qualities.length > 0
              ? qualities.reduce((a, b) => a + b, 0) / qualities.length
              : 0;
          handsDiagnostics.markInference(t0, t1, avgQ, cursorForDiag);

          if (now - lastDiagRef.current >= DIAG_EMIT_MS) {
            lastDiagRef.current = now;
            window.dispatchEvent(
              new CustomEvent("jarvis:hands-diagnostics", {
                detail: handsDiagnostics.snapshot(),
              }),
            );
          }

          const framePayload = {
            t: now,
            hands: packLandmarks(orderedHands),
            lost: orderedHands.length === 0,
            poses: controlPose
              ? [controlPose, ...primary.slice(1).map((p) => p.mode)]
              : primary.map((p) => p.mode),
            cursor: controlCursor,
            videoW,
            videoH,
            dominantIndex: 0,
            qualities,
          };
          publishHandsFrame(framePayload, {
            overlay: true,
            inject: desktopControlEnabledRef.current,
          });
          // Local event for calibration wizard (camera-space landmarks).
          window.dispatchEvent(
            new CustomEvent("jarvis:hands-frame-local", { detail: framePayload }),
          );

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

          // —— HUD-only DOM gestures when not injecting OS input ——
          if (desktopInjectRef.current) {
            lastPinchRef.current[0] = primary[0]?.mode === "pinch";
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
            vizFiltersRef.current[0].reset();
            if (dragIdRef.current) {
              window.dispatchEvent(
                new CustomEvent("jarvis:gesture-release", {
                  detail: { id: dragIdRef.current, x: -1, y: -1 },
                }),
              );
              dragIdRef.current = null;
            }
          }

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
        };

        processFrameRef.current = processFrame;
        scheduler.start(video, (now) => processFrame(now));
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

    // When the HUD is occluded, rVFC may stall — pause scheduler, use interval only.
    const onVis = () => {
      const video = videoRef.current;
      if (document.hidden) {
        schedulerRef.current?.stop();
        if (!hiddenTimerRef.current) {
          hiddenTimerRef.current = window.setInterval(() => {
            processFrameRef.current?.(performance.now());
          }, HIDDEN_DETECT_MS);
        }
      } else {
        if (hiddenTimerRef.current) {
          window.clearInterval(hiddenTimerRef.current);
          hiddenTimerRef.current = 0;
        }
        if (video && processFrameRef.current) {
          const sched = new FrameScheduler();
          schedulerRef.current = sched;
          sched.start(video, (now) => processFrameRef.current?.(now));
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    onVis();

    void boot();
    return () => {
      cancelled = true;
      window.removeEventListener("jarvis:tracking-settings", onTrackingSettings);
      document.removeEventListener("visibilitychange", onVis);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    const want = enabled && desktopOverlayEnabled;
    if (want) {
      requestDesktopOverlay(true);
      window.jarvis?.send?.("jarvis:desktop-overlay-meta", {
        mode: desktopControlEnabled ? desktopControlMode : "hud",
        viz_mode: useStore.getState().desktopVizMode,
        paused: desktopPaused,
      });
    } else {
      requestDesktopOverlay(false);
    }
  }, [
    enabled,
    desktopControlEnabled,
    desktopOverlayEnabled,
    desktopControlMode,
    desktopPaused,
  ]);

  useEffect(() => {
    const armed =
      enabled &&
      desktopControlEnabled &&
      !desktopPaused &&
      (desktopControlMode === "precision" || desktopControlMode === "spatial");
    if (!armed) {
      const drop = precisionRef.current.reset();
      for (const op of drop) sendDesktopInput(op);
      sendDesktopInput({ op: "release" });
    }
    setDesktopInjectArmed(armed);
    if (armed && window.jarvis?.invoke) {
      void window.jarvis.invoke("jarvis:virtual-screen").then((b: any) => {
        if (b && b.width && b.height) {
          screenRef.current = {
            x: b.x || 0,
            y: b.y || 0,
            width: b.width,
            height: b.height,
          };
        }
      });
    }
    return () => {
      if (armed) {
        const drop = precisionRef.current.reset();
        for (const op of drop) sendDesktopInput(op);
        sendDesktopInput({ op: "release" });
        setDesktopInjectArmed(false);
      }
    };
  }, [enabled, desktopControlEnabled, desktopControlMode, desktopPaused]);

  function stop() {
    schedulerRef.current?.stop();
    schedulerRef.current = null;
    processFrameRef.current = null;
    if (hiddenTimerRef.current) {
      window.clearInterval(hiddenTimerRef.current);
      hiddenTimerRef.current = 0;
    }
    window.jarvis?.send?.("jarvis:hands-active", false);
    setDesktopInjectArmed(false);
    sendDesktopInput({ op: "release" });
    precisionRef.current.reset();
    identityRef.current.reset();
    handsDiagnostics.reset();
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
    vizFiltersRef.current[0].reset();
    vizFiltersRef.current[1].reset();
    requestDesktopOverlay(false);
    try {
      delete document.body.dataset.jarvisHands;
    } catch { /* noop */ }
  }

  if (!enabled) return null;

  return (
    <>
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
          className="hands-cursor fixed top-0 left-0 z-[86] pointer-events-none w-3.5 h-3.5 rounded-full opacity-0"
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
          border: none;
          background: #3b9eff;
          box-shadow: 0 0 10px rgba(59, 158, 255, 0.85), 0 0 2px rgba(255,255,255,0.9);
        }
        .hands-cursor[data-mode="pinch"] {
          background: #e0f2fe;
          box-shadow: 0 0 12px rgba(224, 242, 254, 0.95);
        }
        .hands-cursor[data-mode="fist"] {
          background: #fbbf24;
          box-shadow: 0 0 12px rgba(251, 191, 36, 0.9);
        }
      `}</style>
    </>
  );
}
