/**
 * Workspace presets — Code / Research / Media / System layouts.
 * Reuses Floating + layout broker; no second layout system.
 */
import { useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import { apiFetch } from "../../lib/session";
import { resetAllLayouts } from "./Floating";

const PRESETS = [
  {
    id: "code",
    label: "Code",
    hint: "Dialogue + Tools + Terminal + Tasks",
    open: ["dialogue", "tools", "terminal", "tasks"],
  },
  {
    id: "research",
    label: "Research",
    hint: "Dialogue + Tools + System status",
    open: ["dialogue", "tools", "diag", "uptime"],
  },
  {
    id: "media",
    label: "Media",
    hint: "Dialogue focused for generation",
    open: ["dialogue", "toolFeed"],
  },
  {
    id: "system",
    label: "System",
    hint: "Diagnostics, terminal, settings, security",
    open: ["dialogue", "diag", "terminal", "settings", "tasks"],
  },
] as const;

export default function WorkspacePanel() {
  const dockPanel = useStore((s) => s.dockPanel);
  const undockPanel = useStore((s) => s.undockPanel);
  const dockedPanels = useStore((s) => s.dockedPanels);
  const [project, setProject] = useState("");
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/workspace/project")
      .then((r) => r.json())
      .then((j) => setSavedPath(j?.path || null))
      .catch(() => undefined);
  }, []);

  const applyPreset = (open: readonly string[]) => {
    const want = new Set(open);
    // Dock everything dockable first, then undock preset set.
    for (const id of [...dockedPanels]) {
      /* keep */
    }
    const all = ["diag", "uptime", "toolFeed", "terminal", "settings", "tools", "tasks", "workspace"];
    for (const id of all) {
      if (want.has(id)) undockPanel(id);
      else if (id !== "dialogue") dockPanel(id);
    }
    setMsg(`Applied ${open.length} panels`);
  };

  const saveProject = async () => {
    setMsg(null);
    try {
      const r = await apiFetch("/api/workspace/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: project }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || r.statusText);
      setSavedPath(j.path);
      setMsg("Project associated (scoped reads only — no secret ingest).");
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <div className="holo-panel flex flex-col h-full overflow-hidden">
      <header className="shrink-0 px-4 pt-4 pb-3 flex items-start justify-between">
        <div>
          <div className="text-mono text-[9px] tracking-[0.32em] uppercase text-jarvis-cyan/45">
            Layout
          </div>
          <h2 className="text-display text-[16px] tracking-[0.2em] text-jarvis-ice/90 mt-0.5">
            WORKSPACE
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dockPanel("workspace")}
          className="text-mono text-[10px] tracking-[0.18em] uppercase px-2 py-1 rounded-md text-jarvis-ice/45 hover:text-jarvis-ice"
          style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.18)" }}
        >
          Close
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.open)}
              className="text-left rounded-md px-3 py-3 transition-colors hover:bg-jarvis-cyan/10"
              style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.16)" }}
            >
              <div className="text-display text-[13px] tracking-[0.16em] text-jarvis-ice/90">
                {p.label}
              </div>
              <div className="text-[10px] text-jarvis-ice/40 mt-1 leading-snug">{p.hint}</div>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            if (confirm("Reset all panel positions and sizes?")) resetAllLayouts();
          }}
          className="w-full text-mono text-[10px] tracking-[0.16em] uppercase px-3 py-2 rounded-md text-jarvis-ice/55 hover:text-jarvis-ice"
          style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.18)" }}
        >
          Reset layout
        </button>

        <div
          className="rounded-md px-3 py-3 space-y-2"
          style={{ background: "rgba(8,14,26,0.4)", boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.12)" }}
        >
          <div className="text-mono text-[9px] tracking-[0.2em] uppercase text-jarvis-ice/40">
            Project directory
          </div>
          <p className="text-[10px] text-jarvis-ice/40 leading-relaxed">
            Scoped association for reads. Secrets and credential files stay blocked.
          </p>
          {savedPath && (
            <div className="text-[11px] text-jarvis-cyan/70 truncate" title={savedPath}>
              {savedPath}
            </div>
          )}
          <input
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="C:\\path\\to\\project"
            className="w-full bg-transparent text-[12px] text-jarvis-ice/85 px-2 py-1.5 rounded outline-none focus-visible:ring-1 focus-visible:ring-jarvis-cyan/40"
            style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.2)" }}
            aria-label="Project directory path"
          />
          <button
            type="button"
            onClick={() => void saveProject()}
            className="text-mono text-[10px] tracking-[0.14em] uppercase px-2.5 py-1.5 rounded-md text-jarvis-ice/70 hover:text-jarvis-ice"
            style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.22)" }}
          >
            Associate
          </button>
        </div>

        {msg && <div className="text-[11px] text-jarvis-ice/50">{msg}</div>}
      </div>
    </div>
  );
}
