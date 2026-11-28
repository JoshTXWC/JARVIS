/**
 * Tool sidebar — Chat + Health + Settings. Click to undock; drop tiles here to store.
 */
import type { ReactNode } from "react";
import { useStore } from "../../lib/store";
import { DOCK_META, DOCKABLE_IDS, type DockableId } from "../../lib/dockCatalog";
import JarvisLogo from "../Brand/JarvisLogo";
import { cn } from "@/lib/utils";

const ICONS: Record<DockableId, ReactNode> = {
  chat: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M5 6h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" strokeLinejoin="round" />
    </svg>
  ),
  health: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  settings: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
    </svg>
  ),
};

export default function IconDock() {
  const docked = useStore((s) => s.dockedPanels);
  const undockPanel = useStore((s) => s.undockPanel);
  const dockHot = useStore((s) => s.dockHot);
  const backgroundMode = useStore((s) => s.backgroundMode);
  const visible = DOCKABLE_IDS.filter((id) => {
    if (!docked.includes(id)) return false;
    // Chat lives in the full stage — keep it out of the dock strip.
    if (backgroundMode === "chat" && id === "chat") return false;
    return true;
  });

  return (
    <aside
      id="jarvis-icon-dock"
      className={cn(
        "pointer-events-auto fixed left-0 top-0 bottom-0 z-[40] w-[72px] flex flex-col items-center py-3 gap-1 border-r border-border bg-card transition-colors duration-150 overflow-hidden",
        dockHot && "bg-muted border-primary",
      )}
      style={{ pointerEvents: dockHot ? "none" : "auto" }}
      title={dockHot ? "Release to store" : "Open panel · drop here to dock"}
    >
      <div className="mb-2 w-10 h-10 grid place-items-center rounded-full overflow-hidden">
        <JarvisLogo size={40} />
      </div>

      <nav className="flex flex-col items-center gap-2 w-full px-2 overflow-hidden">
        {visible.length === 0 ? (
          <span className="text-[11px] text-muted-foreground px-1 text-center leading-tight mt-2">
            Drop
          </span>
        ) : (
          visible.map((id) => {
            const meta = DOCK_META[id];
            return (
              <button
                key={id}
                type="button"
                title={meta.title}
                onClick={() => {
                  if (useStore.getState().dockHot) return;
                  if (Date.now() < useStore.getState().dockDropLockUntil) return;
                  undockPanel(id);
                }}
                className="relative size-12 grid place-items-center rounded-lg text-foreground hover:bg-white/[0.12]"
              >
                {ICONS[id]}
              </button>
            );
          })
        )}
      </nav>
    </aside>
  );
}
