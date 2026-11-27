/**
 * Floating ChatGPT-style windows. Drag / resize; drop on tool dock to store.
 */
import ChatPanel from "../Chat/ChatPanel";
import CommandBar from "../Chat/CommandBar";
import Floating from "./Floating";
import Settings from "./Settings";
import SystemHealth from "./SystemHealth";
import { DOCK_META, DOCKABLE_IDS, type DockableId } from "../../lib/dockCatalog";
import { useStore } from "../../lib/store";
import { cn } from "@/lib/utils";

function defaultBox(id: DockableId, index: number) {
  const meta = DOCK_META[id];
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  // Chat opens mid-right so the orb stays visible in center.
  if (id === "chat") {
    return { x: Math.max(100, Math.round(vw * 0.52)), y: 72, w: meta.w, h: meta.h };
  }
  if (id === "health") {
    return { x: Math.max(84, Math.round(vw * 0.18)), y: 96, w: meta.w, h: meta.h };
  }
  return {
    x: 100 + index * 36,
    y: 64 + index * 32,
    w: meta.w,
    h: meta.h,
  };
}

export default function CanvasTiles() {
  const docked = useStore((s) => s.dockedPanels);
  const open = DOCKABLE_IDS.filter((id) => !docked.includes(id));

  return (
    <>
      {open.map((id, i) => (
        <Floating
          key={id}
          id={id}
          defaultBox={defaultBox(id, i)}
          minW={320}
          minH={280}
          z={50 + i}
          overflowVisible={id === "chat"}
        >
          <WidgetWindow id={id} />
        </Floating>
      ))}
    </>
  );
}

function WidgetWindow({ id }: { id: DockableId }) {
  return (
    <div
      className={cn(
        "glass-tile flex h-full min-h-0 flex-col rounded-xl",
        id === "chat" ? "overflow-visible" : "overflow-hidden",
        "border border-white/12",
        "shadow-[0_16px_48px_-16px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.08)]",
      )}
    >
      <div
        data-drag-handle
        className="shrink-0 flex items-center gap-2 px-4 h-11 border-b border-white/10 cursor-grab active:cursor-grabbing bg-white/[0.04] rounded-t-xl"
      >
        <h3 className="text-sm font-semibold text-foreground/95">{DOCK_META[id].title}</h3>
      </div>

      <div
        className={cn(
          "relative min-h-0 flex-1 flex flex-col bg-transparent",
          id === "chat" ? "overflow-visible" : "overflow-hidden",
        )}
      >
        {id === "chat" ? (
          <>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatPanel embedded />
            </div>
            <div className="shrink-0 overflow-visible border-t border-white/10 bg-black/25 px-3 py-3 backdrop-blur-xl">
              <CommandBar embedded compactStatus />
            </div>
          </>
        ) : id === "health" ? (
          <SystemHealth />
        ) : (
          <div className="h-full overflow-y-auto p-4">
            <Settings />
          </div>
        )}
      </div>
    </div>
  );
}
