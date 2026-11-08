/** Core panels that live in the centered icon dock when not on the canvas. */
export const DOCKABLE_IDS = [
  "diag",
  "uptime",
  "terminal",
  "chat",
  "mission",
  "toolFeed",
  "settings",
] as const;

export type DockableId = (typeof DOCKABLE_IDS)[number];

export function isDockable(id: string): id is DockableId {
  return (DOCKABLE_IDS as readonly string[]).includes(id);
}

/** Default: everything docked except chat (command bar is always open). */
export const DEFAULT_DOCKED: string[] = [
  "diag",
  "uptime",
  "terminal",
  "mission",
  "toolFeed",
  "settings",
];

export const DOCK_META: Record<
  DockableId,
  { label: string; title: string }
> = {
  diag:     { label: "SYS",  title: "System Diagnostics" },
  uptime:   { label: "UP",   title: "Uptime" },
  terminal: { label: "TERM", title: "Terminal" },
  chat:     { label: "CHAT", title: "Dialogue" },
  mission:  { label: "LOG",  title: "Mission Log" },
  toolFeed: { label: "TOOL", title: "Tool Feed" },
  settings: { label: "SET",  title: "Settings" },
};
