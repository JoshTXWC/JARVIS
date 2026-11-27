/** Panels that live in the tool dock until opened onto the canvas. */
export const DOCKABLE_IDS = ["chat", "health", "settings"] as const;

export type DockableId = (typeof DOCKABLE_IDS)[number];

export function isDockable(id: string): id is DockableId {
  return (DOCKABLE_IDS as readonly string[]).includes(id);
}

/** Settings starts docked; Chat + Health open on-canvas by default. */
export const DEFAULT_DOCKED: string[] = ["settings"];

export const DOCK_META: Record<
  DockableId,
  { label: string; title: string; w: number; h: number }
> = {
  chat: { label: "Chat", title: "Chat", w: 460, h: 580 },
  health: { label: "Health", title: "System Health", w: 360, h: 420 },
  settings: { label: "Set", title: "Settings", w: 400, h: 480 },
};
