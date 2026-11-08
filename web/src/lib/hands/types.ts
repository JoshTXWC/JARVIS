export type HandsMode = "hud" | "precision" | "spatial";
export type HandsVizMode = "skeleton" | "minimal" | "hidden";

export type HandLandmark = { x: number; y: number; z?: number };

export type HandsFrame = {
  t: number;
  hands: Array<Array<[number, number, number]>>;
  lost?: boolean;
  poses?: string[];
};

export type DesktopControlSettings = {
  enabled: boolean;
  mode: HandsMode;
  overlay_enabled: boolean;
  viz_mode: HandsVizMode;
  overlay_opacity: number;
  primary_hand: "right" | "left";
  sensitivity: number;
  smoothing: number;
  acceleration: number;
  dead_zone: number;
  pinch_threshold: number;
  pinch_hold_ms: number;
  click_debounce_ms: number;
  scroll_speed: number;
  scroll_threshold: number;
  open_palm_freeze_ms: number;
  fist_pause_ms: number;
  confidence_min: number;
  spatial_cooldown_ms: number;
  swipe_min_dx: number;
  swipe_min_dy: number;
  resize_scale_gain: number;
  grab_pinch_ms: number;
  monitor_policy: "virtual" | "primary";
  emergency_stop_accel: string;
  mode_cycle_accel: string;
  pause_accel: string;
  calibration: { x0: number; y0: number; x1: number; y1: number };
  jarvis_action_map: Record<string, string>;
  camera_device_id: string;
};

export const DEFAULT_DESKTOP_CONTROL: DesktopControlSettings = {
  enabled: false,
  mode: "hud",
  overlay_enabled: true,
  viz_mode: "skeleton",
  overlay_opacity: 0.85,
  primary_hand: "right",
  sensitivity: 1,
  smoothing: 0.35,
  acceleration: 1.15,
  dead_zone: 0.004,
  pinch_threshold: 0.05,
  pinch_hold_ms: 40,
  click_debounce_ms: 180,
  scroll_speed: 1,
  scroll_threshold: 0.018,
  open_palm_freeze_ms: 450,
  fist_pause_ms: 400,
  confidence_min: 0.45,
  spatial_cooldown_ms: 700,
  swipe_min_dx: 0.18,
  swipe_min_dy: 0.16,
  resize_scale_gain: 1,
  grab_pinch_ms: 80,
  monitor_policy: "virtual",
  emergency_stop_accel: "Control+Shift+Alt+Escape",
  mode_cycle_accel: "Control+Shift+Alt+M",
  pause_accel: "Control+Shift+Alt+P",
  calibration: { x0: 0.15, y0: 0.1, x1: 0.85, y1: 0.9 },
  jarvis_action_map: {},
  camera_device_id: "",
};
