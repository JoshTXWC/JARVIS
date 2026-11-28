/** Panels that live in the tool dock until opened onto the canvas. */
export const DOCKABLE_IDS = ["chat", "health", "settings"] as const;

export type DockableId = (typeof DOCKABLE_IDS)[number];

export function isDockable(id: string): id is DockableId {
  return (DOCKABLE_IDS as readonly string[]).includes(id);
}

/** Settings starts docked; Chat + Health open on-canvas by default. */
export const DEFAULT_DOCKED: string[] = ["settings"];

export type DockSizeMeta = {
  label: string;
  title: string;
  /** Default open size */
  w: number;
  h: number;
  minW: number;
  minH: number;
  /** Omit / Infinity = only limited by the canvas */
  maxW?: number;
  maxH?: number;
};

export const DOCK_META: Record<DockableId, DockSizeMeta> = {
  // Chat: min only — can grow across the canvas (no artificial max width).
  chat: {
    label: "Chat",
    title: "Chat",
    w: 520,
    h: 640,
    minW: 400,
    minH: 420,
  },
  health: {
    label: "Health",
    title: "System Health",
    w: 339,
    h: 380,
    minW: 339,
    minH: 380,
    maxW: 339,
    maxH: 380,
  },
  settings: {
    label: "Set",
    title: "Settings",
    w: 400,
    h: 480,
    minW: 400,
    minH: 300,
    maxW: 400,
    maxH: 600,
  },
};

/** Ephemeral AI media / browser / tool windows — each has min + max. */
export const MEDIA_WINDOW_SIZES = {
  page: { w: 720, h: 640, minW: 420, minH: 320, maxW: 1100, maxH: 900 },
  search: { w: 480, h: 520, minW: 340, minH: 280, maxW: 720, maxH: 800 },
  image: { w: 560, h: 480, minW: 320, minH: 260, maxW: 900, maxH: 800 },
  video: { w: 640, h: 480, minW: 360, minH: 280, maxW: 1000, maxH: 800 },
  app: { w: 640, h: 560, minW: 360, minH: 300, maxW: 1000, maxH: 860 },
  terminal: { w: 560, h: 420, minW: 320, minH: 240, maxW: 900, maxH: 720 },
  default: { w: 520, h: 460, minW: 320, minH: 260, maxW: 860, maxH: 780 },
} as const;

export type MediaWindowKind = keyof typeof MEDIA_WINDOW_SIZES;

export function mediaWindowSize(kind?: string) {
  if (kind && kind in MEDIA_WINDOW_SIZES) {
    return MEDIA_WINDOW_SIZES[kind as MediaWindowKind];
  }
  return MEDIA_WINDOW_SIZES.default;
}
