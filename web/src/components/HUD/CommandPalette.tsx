/**
 * Global Ctrl+K / Cmd+K palette — tools, panels, settings, recent tasks.
 */
import { useEffect, useMemo, useState } from "react";
import { getTools } from "../../lib/api";
import { DOCKABLE_IDS, DOCK_META, type DockableId } from "../../lib/dockCatalog";
import { useStore } from "../../lib/store";
import { wsClient } from "../../lib/ws";

type Item = {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tools, setTools] = useState<{ name: string; description: string; permission: string }[]>([]);
  const [idx, setIdx] = useState(0);
  const undockPanel = useStore((s) => s.undockPanel);
  const dockPanel = useStore((s) => s.dockPanel);
  const docked = useStore((s) => s.dockedPanels);
  const chat = useStore((s) => s.chat);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQ("");
        setIdx(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    getTools()
      .then((j) => setTools(j?.tools || []))
      .catch(() => undefined);
  }, [open]);

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    for (const id of DOCKABLE_IDS) {
      const meta = DOCK_META[id];
      const isDocked = docked.includes(id);
      out.push({
        id: `panel:${id}`,
        label: isDocked ? `Open ${meta.title}` : `Focus ${meta.title}`,
        group: "Panels",
        hint: meta.label,
        run: () => undockPanel(id as DockableId),
      });
    }
    out.push({
      id: "settings:security",
      label: "Open Settings",
      group: "Settings",
      run: () => undockPanel("settings"),
    });
    out.push({
      id: "task:pause",
      label: "Pause current task",
      group: "Tasks",
      run: () => wsClient.pause(),
    });
    out.push({
      id: "task:resume",
      label: "Resume task",
      group: "Tasks",
      run: () => wsClient.resume(),
    });
    out.push({
      id: "task:cancel",
      label: "Cancel task",
      group: "Tasks",
      run: () => wsClient.cancel(),
    });
    for (const t of tools) {
      out.push({
        id: `tool:${t.name}`,
        label: t.name,
        group: "Tools",
        hint: t.permission,
        run: () => {
          undockPanel("tools");
          wsClient.chat(
            `Please run the tool \`${t.name}\` if appropriate. Use a real tool call; confirm if required.`,
          );
        },
      });
    }
    for (const m of chat.filter((c) => c.role === "user").slice(-6).reverse()) {
      out.push({
        id: `chat:${m.id}`,
        label: (m.text || "").slice(0, 80) || "(empty)",
        group: "Recent",
        run: () => {
          /* focus dialogue — already open */
        },
      });
    }
    const needle = q.trim().toLowerCase();
    if (!needle) return out;
    return out.filter(
      (i) =>
        i.label.toLowerCase().includes(needle) ||
        i.group.toLowerCase().includes(needle) ||
        (i.hint || "").toLowerCase().includes(needle),
    );
  }, [tools, docked, chat, q, undockPanel, dockPanel]);

  useEffect(() => {
    setIdx(0);
  }, [q, open]);

  if (!open) return null;

  const run = (item: Item) => {
    item.run();
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4"
      style={{ background: "rgba(3,7,15,0.55)" }}
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-xl rounded-xl overflow-hidden shadow-2xl"
        style={{
          background: "rgba(8,14,26,0.92)",
          boxShadow: "0 0 0 1px rgba(125,211,252,0.22), 0 24px 60px -16px rgba(0,0,0,0.7)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && items[idx]) {
              e.preventDefault();
              run(items[idx]);
            }
          }}
          placeholder="Search tools, panels, tasks…"
          aria-label="Command search"
          className="w-full bg-transparent text-[14px] text-jarvis-ice/90 px-4 py-3.5 outline-none border-b border-jarvis-cyan/15"
        />
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {items.slice(0, 40).map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                onMouseEnter={() => setIdx(i)}
                onClick={() => run(item)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 ${
                  i === idx ? "bg-jarvis-cyan/15" : "hover:bg-jarvis-cyan/8"
                }`}
              >
                <span className="text-mono text-[9px] tracking-[0.16em] uppercase text-jarvis-ice/35 w-16 shrink-0">
                  {item.group}
                </span>
                <span className="text-[13px] text-jarvis-ice/85 truncate flex-1">{item.label}</span>
                {item.hint && (
                  <span className="text-mono text-[9px] text-jarvis-cyan/45 uppercase tracking-wider">
                    {item.hint}
                  </span>
                )}
              </button>
            </li>
          ))}
          {!items.length && (
            <li className="px-4 py-6 text-[12px] text-jarvis-ice/35">No matches.</li>
          )}
        </ul>
        <div className="px-4 py-2 text-mono text-[9px] tracking-[0.16em] uppercase text-jarvis-ice/30 border-t border-jarvis-cyan/10">
          Ctrl+K · Enter to run · Esc to close
        </div>
      </div>
    </div>
  );
}
