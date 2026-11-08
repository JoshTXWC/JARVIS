/** Core panels that live in the centered icon dock when not on the canvas.
 *  Chat + command bar are fused into a single always-open Dialogue panel,
 *  so they are intentionally absent from this list.
 *  Mission Log stays retired. Terminal is available for ops / brain errors.
 */
export const DOCKABLE_IDS = [
  "diag",
  "uptime",
  "toolFeed",
  "terminal",
  "tools",
  "tasks",
  "workspace",
  "settings",
] as const;

export type DockableId = (typeof DOCKABLE_IDS)[number];

export function isDockable(id: string): id is DockableId {
  return (DOCKABLE_IDS as readonly string[]).includes(id);
}

/** Default canvas: Dialogue only — everything else starts in the icon dock. */
export const DEFAULT_DOCKED: string[] = [
  "diag",
  "uptime",
  "toolFeed",
  "terminal",
  "tools",
  "tasks",
  "workspace",
  "settings",
];

export const DOCK_META: Record<
  DockableId,
  { label: string; title: string }
> = {
  diag:      { label: "SYS",  title: "System Status" },
  uptime:    { label: "UP",   title: "Uptime" },
  toolFeed:  { label: "FEED", title: "Tool Feed" },
  terminal:  { label: "TERM", title: "Terminal" },
  tools:     { label: "TOOL", title: "Tools" },
  tasks:     { label: "TASK", title: "Task Manager" },
  workspace: { label: "SPACE", title: "Workspace" },
  settings:  { label: "SET",  title: "Settings" },
};
