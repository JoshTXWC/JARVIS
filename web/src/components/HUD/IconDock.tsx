/**
 * Centered icon dock — click an icon to spawn its tile onto the canvas.
 * Icons disappear while their tile is open; dragging a tile back into the
 * top zone returns it here.
 */
import type { ReactNode } from "react";
import { useStore } from "../../lib/store";
import { DOCK_META, DOCKABLE_IDS, type DockableId } from "../../lib/dockCatalog";

const ICONS: Record<DockableId, ReactNode> = {
  diag: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 1.5" strokeLinecap="round" />
    </svg>
  ),
  uptime: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  ),
  terminal: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10l3 2-3 2M12 14h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chat: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M5 6h14a2 2 0 012 2v7a2 2 0 01-2 2H10l-4 3v-3H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
    </svg>
  ),
  mission: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M8 4h9l-1 16H7L8 4z" />
      <path d="M10 8h5M9.5 12h6M9 16h5" strokeLinecap="round" />
    </svg>
  ),
  toolFeed: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M14.7 6.3a4 4 0 015 5L12 19l-4-1-1-4 7.7-7.7z" />
      <path d="M3 21l4-1" strokeLinecap="round" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
    </svg>
  ),
};

interface Props {
  onUndock?: (id: DockableId) => void;
}

export default function IconDock({ onUndock }: Props) {
  const docked = useStore((s) => s.dockedPanels);
  const undockPanel = useStore((s) => s.undockPanel);
  const dockHot = useStore((s) => s.dockHot);

  const visible = DOCKABLE_IDS.filter((id) => docked.includes(id));

  return (
    <div
      id="jarvis-icon-dock"
      data-reticle
      className="pointer-events-auto flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg min-h-[44px] min-w-[120px] transition-all duration-200"
      style={{
        background: dockHot ? "rgba(125,211,252,0.16)" : "rgba(8,14,26,0.5)",
        boxShadow: dockHot
          ? "0 0 0 1px rgba(125,211,252,0.55), 0 0 28px -4px rgba(125,211,252,0.45)"
          : "inset 0 0 0 1px rgba(125,211,252,0.14)",
      }}
      title={dockHot ? "Release to dock tile" : "Open a panel"}
    >
      {visible.length === 0 ? (
        <span className="text-mono text-[9px] tracking-[0.28em] uppercase text-jarvis-cyan/35 px-2">
          {dockHot ? "drop to dock" : "all open"}
        </span>
      ) : (
        visible.map((id) => {
          const meta = DOCK_META[id];
          return (
            <button
              key={id}
              type="button"
              title={meta.title}
              data-reticle
              onClick={() => {
                undockPanel(id);
                onUndock?.(id);
              }}
              className="group relative w-9 h-9 rounded-lg grid place-items-center text-jarvis-cyan/70 hover:text-jarvis-ice transition-all"
              style={{
                background: "rgba(14,24,42,0.55)",
                boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.16)",
              }}
            >
              {ICONS[id]}
              <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[7px] text-mono tracking-wider text-jarvis-cyan/0 group-hover:text-jarvis-cyan/55 transition-colors whitespace-nowrap">
                {meta.label}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
