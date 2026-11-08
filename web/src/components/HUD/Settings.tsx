/**
 * SETTINGS — tabbed control surface, big interactive blocks, minimal copy.
 */
import { useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import { apiFetch } from "../../lib/session";
import { startWakeListening, stopWakeListening } from "../../lib/wakeMic";
import { resetAllLayouts } from "./Floating";
import DesktopControlSettings from "./DesktopControlSettings";
import SecurityPanel from "./SecurityPanel";

type Tab = "hands" | "voice" | "security" | "system";

const TABS: { id: Tab; label: string }[] = [
  { id: "hands", label: "Hands" },
  { id: "voice", label: "Voice" },
  { id: "security", label: "Security" },
  { id: "system", label: "System" },
];

export default function Settings() {
  const health = useStore((s) => s.health);
  const voiceEnabled = useStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useStore((s) => s.setVoiceEnabled);
  const wakeEnabled = useStore((s) => s.wakeEnabled);
  const micEnabled = useStore((s) => s.micEnabled);
  const bargeIn = useStore((s) => s.bargeIn);
  const setBargeIn = useStore((s) => s.setBargeIn);
  const clearChat = useStore((s) => s.clearChat);
  const clearMedia = useStore((s) => s.clearMedia);
  const clearTools = useStore((s) => s.clearTools);
  const setReader = useStore((s) => s.setReader);
  const prevSessionAvailable = useStore((s) => s.prevSessionAvailable);
  const restoreLastSession = useStore((s) => s.restoreLastSession);
  const dockPanel = useStore((s) => s.dockPanel);

  const [tab, setTab] = useState<Tab>("hands");
  const [agents, setAgents] = useState<string[]>([]);

  useEffect(() => {
    apiFetch("/api/agents")
      .then((r) => r.json())
      .then((j) => setAgents(j?.agents || []))
      .catch(() => undefined);
  }, []);

  const cleanSlate = async () => {
    if (!confirm("Wipe chat, media, and tool history?")) return;
    clearChat();
    clearMedia();
    clearTools();
    setReader(null);
    try { await apiFetch("/api/cleanslate", { method: "POST" }); } catch { /* noop */ }
  };

  const modelName = health?.model.model || "—";
  const provider = health?.model.provider || "—";

  return (
    <div className="holo-panel flex flex-col h-full overflow-hidden relative">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(90% 70% at 0% 0%, rgba(125,211,252,0.14), transparent 55%)," +
            "linear-gradient(180deg, rgba(8,14,26,0.2), transparent 40%)",
        }}
      />

      <header className="relative shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-display text-[20px] tracking-[0.2em] text-jarvis-ice/95">
            SETTINGS
          </h2>
          <button
            type="button"
            onClick={() => dockPanel("settings")}
            className="text-mono text-[10px] tracking-[0.18em] uppercase px-3 py-2 rounded-lg text-jarvis-ice/55 hover:text-jarvis-ice"
            style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.2)" }}
          >
            Close
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Mini label="Model" value={modelName} />
          <Mini label="Provider" value={provider} />
        </div>

        <div
          className="mt-3 grid grid-cols-4 gap-1 p-1 rounded-2xl"
          style={{ background: "rgba(8,14,26,0.55)", boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.12)" }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="rounded-xl py-2.5 text-mono text-[10px] tracking-[0.16em] uppercase transition-all"
              style={{
                background: tab === t.id ? "rgba(125,211,252,0.18)" : "transparent",
                boxShadow: tab === t.id ? "inset 0 0 0 1px rgba(125,211,252,0.4)" : "none",
                color: tab === t.id ? "rgba(224,242,254,0.95)" : "rgba(186,230,253,0.4)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="relative flex-1 min-h-0 overflow-y-auto px-4 pb-5">
        {tab === "hands" && (
          <section className="pt-1">
            <DesktopControlSettings />
          </section>
        )}

        {tab === "voice" && (
          <section className="pt-1 space-y-3">
            <VoiceCard
              label="Speak aloud"
              active={voiceEnabled}
              onClick={() => setVoiceEnabled(!voiceEnabled)}
            />
            <VoiceCard
              label="Wake word"
              active={wakeEnabled && micEnabled}
              onClick={async () => {
                if (!(wakeEnabled && micEnabled)) await startWakeListening();
                else stopWakeListening();
              }}
            />
            <VoiceCard
              label="Barge-in"
              active={bargeIn}
              onClick={() => setBargeIn(!bargeIn)}
            />
          </section>
        )}

        {tab === "security" && (
          <section className="pt-1">
            <SecurityPanel />
          </section>
        )}

        {tab === "system" && (
          <section className="pt-1 space-y-3">
            {prevSessionAvailable && (
              <ActionCard label="Restore session" onClick={() => restoreLastSession()} accent />
            )}
            <ActionCard
              label="Reset layouts"
              onClick={() => { if (confirm("Reset panel positions?")) resetAllLayouts(); }}
            />
            <div
              className="rounded-2xl px-3 py-3 space-y-2"
              style={{ background: "rgba(8,14,26,0.4)", boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.12)" }}
            >
              <Row k="Tools" v={String(health?.tools ?? 0)} />
              <Row k="Plugins" v={String(health?.plugins?.length ?? 0)} />
              <Row k="Image" v={health?.image_model || "—"} />
              <Row k="Endpoint" v={health?.model.endpoint || "—"} />
              <Row k="Agents" v={(agents.length ? agents : health?.agents || []).join(", ") || "—"} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ActionCard label="Clear chat" onClick={() => { if (confirm("Wipe chat?")) clearChat(); }} />
              <ActionCard label="Clear media" onClick={() => { if (confirm("Wipe media?")) clearMedia(); }} />
              <ActionCard label="Clear tools" onClick={() => { if (confirm("Wipe tools?")) clearTools(); }} />
              <ActionCard label="Clean slate" danger onClick={cleanSlate} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-3 py-2.5 min-w-0"
      style={{
        background: "linear-gradient(160deg, rgba(125,211,252,0.1), rgba(8,14,26,0.5))",
        boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.18)",
      }}
    >
      <div className="text-[8px] text-mono tracking-[0.24em] text-jarvis-cyan/40 uppercase">{label}</div>
      <div className="text-[12px] text-mono text-jarvis-ice mt-1 truncate" title={value}>{value}</div>
    </div>
  );
}

function VoiceCard({
  label, active, onClick,
}: {
  label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl px-4 py-5 flex items-center justify-between text-left transition-all"
      style={{
        background: active
          ? "linear-gradient(160deg, rgba(34,211,238,0.22), rgba(8,14,26,0.5))"
          : "rgba(8,14,26,0.45)",
        boxShadow: active
          ? "inset 0 0 0 1px rgba(125,211,252,0.5)"
          : "inset 0 0 0 1px rgba(125,211,252,0.14)",
      }}
    >
      <span className="text-[15px] text-jarvis-ice/90 tracking-wide">{label}</span>
      <span className={`text-display text-[18px] tracking-[0.14em] ${active ? "text-jarvis-ice" : "text-jarvis-ice/35"}`}>
        {active ? "ON" : "OFF"}
      </span>
    </button>
  );
}

function ActionCard({
  label, onClick, danger, accent,
}: {
  label: string; onClick: () => void; danger?: boolean; accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl px-3 py-4 text-mono text-[11px] tracking-[0.14em] uppercase transition-all"
      style={{
        background: danger
          ? "rgba(251,113,133,0.1)"
          : accent
            ? "rgba(165,243,252,0.1)"
            : "rgba(8,14,26,0.4)",
        boxShadow: danger
          ? "inset 0 0 0 1px rgba(251,113,133,0.35)"
          : accent
            ? "inset 0 0 0 1px rgba(165,243,252,0.35)"
            : "inset 0 0 0 1px rgba(125,211,252,0.14)",
        color: danger
          ? "rgba(254,205,211,0.95)"
          : accent
            ? "rgba(165,243,252,0.95)"
            : "rgba(224,242,254,0.8)",
      }}
    >
      {label}
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="text-jarvis-ice/40 shrink-0">{k}</span>
      <span className="text-mono text-[10px] text-jarvis-ice/85 truncate max-w-[65%] text-right" title={v}>{v}</span>
    </div>
  );
}
