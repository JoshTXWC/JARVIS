/**
 * Dockable Tools panel — catalog, search, favorites, schema-driven runners.
 * Privileged execution always goes through the agent WS confirm path.
 */
import { useEffect, useMemo, useState } from "react";
import { getPlugins, getTools } from "../../lib/api";
import { useStore } from "../../lib/store";
import { wsClient } from "../../lib/ws";

type ToolInfo = {
  name: string;
  description: string;
  permission: string;
  plugin: string;
  parameters?: Record<string, unknown>;
};

type PluginInfo = {
  name: string;
  description: string;
  permissions: string[];
};

const FAV_KEY = "jarvis.tools.favorites";

function loadFavs(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    const j = raw ? JSON.parse(raw) : [];
    return Array.isArray(j) ? j.map(String) : [];
  } catch {
    return [];
  }
}

export default function ToolsPanel() {
  const dockPanel = useStore((s) => s.dockPanel);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [q, setQ] = useState("");
  const [favs, setFavs] = useState<string[]>(() => loadFavs());
  const [selected, setSelected] = useState<ToolInfo | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"tools" | "plugins">("tools");

  useEffect(() => {
    void (async () => {
      try {
        const [t, p] = await Promise.all([getTools(), getPlugins()]);
        setTools(t?.tools || []);
        setPlugins(p?.plugins || []);
      } catch { /* noop */ }
    })();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = tools;
    if (needle) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(needle) ||
          (t.description || "").toLowerCase().includes(needle) ||
          (t.plugin || "").toLowerCase().includes(needle),
      );
    }
    return [...list].sort((a, b) => {
      const af = favs.includes(a.name) ? 0 : 1;
      const bf = favs.includes(b.name) ? 0 : 1;
      if (af !== bf) return af - bf;
      return a.name.localeCompare(b.name);
    });
  }, [tools, q, favs]);

  const byPlugin = useMemo(() => {
    const m = new Map<string, ToolInfo[]>();
    for (const t of filtered) {
      const k = t.plugin || "core";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [filtered]);

  const toggleFav = (name: string) => {
    setFavs((prev) => {
      const next = prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name];
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
      return next;
    });
  };

  const selectTool = (t: ToolInfo) => {
    setSelected(t);
    const props = schemaProps(t.parameters);
    const init: Record<string, string> = {};
    for (const key of Object.keys(props)) init[key] = "";
    setArgs(init);
  };

  const runViaAgent = () => {
    if (!selected) return;
    const filled = Object.fromEntries(
      Object.entries(args).filter(([, v]) => v.trim() !== ""),
    );
    const argStr = Object.entries(filled)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    const prompt =
      `Please run the tool \`${selected.name}\`` +
      (argStr ? ` with arguments: ${argStr}` : "") +
      `. Use the tool call — do not invent results.`;
    wsClient.chat(prompt);
  };

  return (
    <div className="holo-panel flex flex-col h-full overflow-hidden">
      <header className="shrink-0 px-4 pt-4 pb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-mono text-[9px] tracking-[0.32em] uppercase text-jarvis-cyan/45">Catalog</div>
          <h2 className="text-display text-[16px] tracking-[0.2em] text-jarvis-ice/90 mt-0.5">TOOLS</h2>
        </div>
        <button
          type="button"
          onClick={() => dockPanel("tools")}
          className="text-mono text-[10px] tracking-[0.18em] uppercase px-2 py-1 rounded-md text-jarvis-ice/45 hover:text-jarvis-ice"
          style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.18)" }}
        >
          Close
        </button>
      </header>

      <div className="px-4 pb-2 flex gap-2">
        {(["tools", "plugins"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`text-mono text-[10px] tracking-[0.14em] uppercase px-2.5 py-1 rounded-md ${
              tab === t ? "text-jarvis-ice bg-jarvis-cyan/15" : "text-jarvis-ice/45"
            }`}
            style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.16)" }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "tools" && (
        <>
          <div className="px-4 pb-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tools…"
              aria-label="Search tools"
              className="w-full bg-transparent text-[12px] text-jarvis-ice/85 px-2.5 py-1.5 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-jarvis-cyan/40"
              style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.2)" }}
            />
          </div>
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="w-[48%] min-w-0 overflow-y-auto px-2 pb-3 space-y-3 border-r border-jarvis-cyan/10">
              {[...byPlugin.entries()].map(([plugin, list]) => (
                <div key={plugin}>
                  <div className="text-mono text-[8px] tracking-[0.22em] uppercase text-jarvis-ice/35 px-2 mb-1">
                    {plugin}
                  </div>
                  {list.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => selectTool(t)}
                      className={`w-full text-left px-2 py-1.5 rounded-md mb-0.5 transition-colors ${
                        selected?.name === t.name ? "bg-jarvis-cyan/15" : "hover:bg-jarvis-cyan/8"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); toggleFav(t.name); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); toggleFav(t.name); } }}
                          className={`text-[11px] ${favs.includes(t.name) ? "text-amber-300/90" : "text-jarvis-ice/25"}`}
                          aria-label="Toggle favorite"
                        >
                          ★
                        </span>
                        <span className="text-[12px] text-jarvis-ice/85 truncate">{t.name}</span>
                        <PermBadge p={t.permission} />
                      </div>
                    </button>
                  ))}
                </div>
              ))}
              {!filtered.length && (
                <div className="text-[11px] text-jarvis-ice/30 px-2">No tools match.</div>
              )}
            </div>
            <div className="flex-1 min-w-0 overflow-y-auto px-3 pb-3">
              {selected ? (
                <Runner tool={selected} args={args} setArgs={setArgs} onRun={runViaAgent} />
              ) : (
                <div className="text-[11px] text-jarvis-ice/35 pt-2">Select a tool to inspect its schema.</div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "plugins" && (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-2">
          {plugins.map((p) => (
            <div
              key={p.name}
              className="rounded-md px-3 py-2"
              style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.14)" }}
            >
              <div className="text-[12px] text-jarvis-ice/85">{p.name}</div>
              <div className="text-[10px] text-jarvis-ice/40 mt-0.5 leading-snug">{p.description}</div>
              <div className="text-mono text-[9px] text-jarvis-cyan/45 mt-1 tracking-wider uppercase">
                {(p.permissions || []).join(" · ") || "safe"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function schemaProps(parameters?: Record<string, unknown>): Record<string, { type?: string; description?: string }> {
  if (!parameters || typeof parameters !== "object") return {};
  const props = (parameters as { properties?: Record<string, unknown> }).properties;
  if (!props || typeof props !== "object") return {};
  const out: Record<string, { type?: string; description?: string }> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v && typeof v === "object") out[k] = v as { type?: string; description?: string };
    else out[k] = {};
  }
  return out;
}

function Runner({
  tool, args, setArgs, onRun,
}: {
  tool: ToolInfo;
  args: Record<string, string>;
  setArgs: (a: Record<string, string>) => void;
  onRun: () => void;
}) {
  const props = schemaProps(tool.parameters);
  const keys = Object.keys(props);

  return (
    <div className="space-y-3 pt-1">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-jarvis-ice/90 font-medium">{tool.name}</span>
          <PermBadge p={tool.permission} />
        </div>
        <p className="text-[11px] text-jarvis-ice/45 mt-1 leading-relaxed">{tool.description}</p>
      </div>
      {keys.length === 0 ? (
        <div className="text-[11px] text-jarvis-ice/35">No parameters.</div>
      ) : (
        keys.map((k) => (
          <label key={k} className="block">
            <span className="text-mono text-[9px] tracking-[0.16em] uppercase text-jarvis-ice/40">{k}</span>
            {props[k].description && (
              <span className="block text-[10px] text-jarvis-ice/30 mb-0.5">{props[k].description}</span>
            )}
            <input
              value={args[k] ?? ""}
              onChange={(e) => setArgs({ ...args, [k]: e.target.value })}
              className="w-full mt-0.5 bg-transparent text-[12px] text-jarvis-ice/85 px-2 py-1.5 rounded outline-none focus-visible:ring-1 focus-visible:ring-jarvis-cyan/40"
              style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.2)" }}
            />
          </label>
        ))
      )}
      <button
        type="button"
        onClick={onRun}
        className="text-mono text-[10px] tracking-[0.16em] uppercase px-3 py-2 rounded-md text-jarvis-ice/85 hover:text-jarvis-ice bg-jarvis-cyan/15"
        style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.28)" }}
        title="Runs via agent — caution/dangerous tools still require confirm"
      >
        Run via agent
      </button>
      <p className="text-[10px] text-jarvis-ice/35 leading-relaxed">
        Execution uses the existing permission confirm path. No unprotected execute endpoint.
      </p>
    </div>
  );
}

function PermBadge({ p }: { p: string }) {
  const c =
    p === "dangerous" ? "text-red-300/85 border-red-400/30"
    : p === "caution" ? "text-amber-300/85 border-amber-400/30"
    : "text-emerald-300/75 border-emerald-400/25";
  return (
    <span className={`ml-auto shrink-0 text-mono text-[8px] tracking-[0.12em] uppercase px-1.5 py-0.5 rounded border ${c}`}>
      {p || "safe"}
    </span>
  );
}
