/**
 * Tracking & Precision settings — presets, persistence helpers, defaults.
 */
import type { CalibrationRect } from "./coords";
import { DEFAULT_CALIBRATION } from "./coords";
import type { OneEuroParams } from "./oneEuro";
import {
  PRESET_BALANCED_EURO,
  PRESET_FAST_EURO,
  PRESET_PRECISION_EURO,
} from "./oneEuro";

export type TrackingPreset = "fast" | "balanced" | "precision";

export type TrackingQualitySettings = {
  cameraDeviceId: string;
  /** Ideal capture width. */
  captureWidth: number;
  /** Ideal capture height. */
  captureHeight: number;
  /** Ideal FPS request (actual may differ). */
  captureFps: number;
  primaryHand: "right" | "left";
  calibration: CalibrationRect;
  /** Independent sensitivity multipliers on control UV. */
  sensX: number;
  sensY: number;
  /** Soft edge compression 0–1. */
  edgeCompress: number;
  /** One Euro params for OS cursor. */
  cursorFilter: OneEuroParams;
  /** One Euro params for HUD/skeleton viz (lighter). */
  vizFilter: OneEuroParams;
  /** Pinch distance as fraction of hand size (wrist→middle MCP). */
  pinchActivate: number;
  pinchRelease: number;
  pinchApproach: number;
  /** Hold ms before drag can arm. */
  dragArmMs: number;
  /** Anchor movement (desktop px) required to start drag. */
  dragMovePx: number;
  confidenceMin: number;
  /** Reject landmark tip jumps above this (control UV units). */
  maxUvJump: number;
  /** Show tracking quality overlays. */
  showQualityViz: boolean;
  /** Show performance diagnostics panel. */
  showDiagnostics: boolean;
  preset: TrackingPreset;
  /** Monitor target: virtual desktop, primary, or specific display id. */
  monitorPolicy: "virtual" | "primary" | "display";
  monitorDisplayId: number | null;
};

export const DEFAULT_TRACKING: TrackingQualitySettings = {
  cameraDeviceId: "",
  captureWidth: 1280,
  captureHeight: 720,
  captureFps: 60,
  primaryHand: "right",
  calibration: { ...DEFAULT_CALIBRATION },
  sensX: 1,
  sensY: 1,
  edgeCompress: 0.25,
  cursorFilter: { ...PRESET_BALANCED_EURO },
  vizFilter: {
    minCutoff: 2.5,
    beta: 0.06,
    dCutoff: 1.2,
    deadZone: 0.12,
    maxJump: 220,
  },
  pinchActivate: 0.28,
  pinchRelease: 0.36,
  pinchApproach: 0.55,
  dragArmMs: 400,
  dragMovePx: 28,
  confidenceMin: 0.45,
  maxUvJump: 0.22,
  showQualityViz: false,
  showDiagnostics: false,
  preset: "balanced",
  monitorPolicy: "virtual",
  monitorDisplayId: null,
};

export function applyPreset(
  base: TrackingQualitySettings,
  preset: TrackingPreset,
): TrackingQualitySettings {
  const next = { ...base, preset };
  if (preset === "fast") {
    next.cursorFilter = { ...PRESET_FAST_EURO };
    next.vizFilter = {
      minCutoff: 3.2,
      beta: 0.09,
      dCutoff: 1.4,
      deadZone: 0.08,
      maxJump: 280,
    };
    next.edgeCompress = 0.15;
    next.dragArmMs = 320;
    next.dragMovePx = 34;
  } else if (preset === "precision") {
    next.cursorFilter = { ...PRESET_PRECISION_EURO };
    next.vizFilter = {
      minCutoff: 1.4,
      beta: 0.03,
      dCutoff: 1.0,
      deadZone: 0.25,
      maxJump: 160,
    };
    next.edgeCompress = 0.35;
    next.dragArmMs = 480;
    next.dragMovePx = 22;
    next.pinchActivate = 0.26;
    next.pinchRelease = 0.34;
  } else {
    next.cursorFilter = { ...PRESET_BALANCED_EURO };
    next.vizFilter = { ...DEFAULT_TRACKING.vizFilter };
    next.edgeCompress = 0.25;
    next.dragArmMs = 400;
    next.dragMovePx = 28;
    next.pinchActivate = 0.28;
    next.pinchRelease = 0.36;
  }
  return next;
}

const LS_KEY = "jarvis.hands.tracking.v1";

export function loadTrackingSettings(): TrackingQualitySettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_TRACKING, calibration: { ...DEFAULT_CALIBRATION } };
    const parsed = JSON.parse(raw) as Partial<TrackingQualitySettings>;
    return {
      ...DEFAULT_TRACKING,
      ...parsed,
      calibration: { ...DEFAULT_CALIBRATION, ...(parsed.calibration || {}) },
      cursorFilter: { ...DEFAULT_TRACKING.cursorFilter, ...(parsed.cursorFilter || {}) },
      vizFilter: { ...DEFAULT_TRACKING.vizFilter, ...(parsed.vizFilter || {}) },
    };
  } catch {
    return { ...DEFAULT_TRACKING, calibration: { ...DEFAULT_CALIBRATION } };
  }
}

export function saveTrackingSettings(s: TrackingQualitySettings) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode */
  }
}

export type CalibrationProfile = {
  id: string;
  name: string;
  updatedAt: number;
  cameraDeviceId: string;
  captureWidth: number;
  captureHeight: number;
  displayId: number | null;
  calibration: CalibrationRect;
  sensX: number;
  sensY: number;
  edgeCompress: number;
  /** Optional affine samples (control UV → desktop UV). */
  affineSamples?: Array<{ src: { x: number; y: number }; dst: { x: number; y: number } }>;
  residualRms?: number;
};

const CAL_KEY = "jarvis.hands.calibrationProfiles.v1";

export function loadCalibrationProfiles(): CalibrationProfile[] {
  try {
    const raw = localStorage.getItem(CAL_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveCalibrationProfile(profile: CalibrationProfile) {
  const all = loadCalibrationProfiles().filter((p) => p.id !== profile.id);
  all.unshift(profile);
  try {
    localStorage.setItem(CAL_KEY, JSON.stringify(all.slice(0, 12)));
  } catch {
    /* noop */
  }
}

export function deleteCalibrationProfile(id: string) {
  const all = loadCalibrationProfiles().filter((p) => p.id !== id);
  try {
    localStorage.setItem(CAL_KEY, JSON.stringify(all));
  } catch {
    /* noop */
  }
}
