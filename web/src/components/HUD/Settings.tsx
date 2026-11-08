/**
 * SETTINGS — premium glass popup matching the HUD mock.
 */
import { useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import { startWakeListening, stopWakeListening } from "../../lib/wakeMic";
import { resetAllLayouts } from "./Floating";

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

  const [agents, setAgents] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((j) => setAgents(j?.agents || []))
      .catch(() => undefined);
  }, []);

  const cleanSlate = async () => {
    if (!confirm("Wipe all chat, media, and tool history? Backend memory is preserved.")) return;
    clearChat();
    clearMedia();
    clearTools();
    setReader(null);
    try { await fetch("/api/cleanslate", { method: "POST" }); } catch { /* noop */ }
  };

  return (
    <div className="holo-panel flex flex-col h-full overflow-hidden">
      {/* Hero header */}
      <div
        className="relative px-5 pt-4 pb-3 shrink-0"
        style={{
          background:
            "radial-gradient(120% 140% at 0% 0%, rgba(125,211,252,0.18), transparent 55%), " +
            "linear-gradient(180deg, rgba(14,24,42,0.35), transparent)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-display text-[12px] tracking-[0.42em] text-shimmer">SETTINGS</div>
            <div className="mt-1 text-mono text-[10px] text-jarvis-ice/45 tracking-wide">
              Mission control preferences
            </div>
          </div>
          <div
            className="px-2 py-1 rounded-lg text-mono text-[9px] tracking-[0.2em] uppercase text-jarvis-cyan/70"
            style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.25)", background: "rgba(125,211,252,0.08)" }}
          >
            LIVE
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <StatPill label="MODEL" value={health?.model.model || "—"} />
          <StatPill label="PROVIDER" value={health?.model.provider || "—"} />
          <StatPill label="TOOLS" value={String(health?.tools ?? 0)} />
        </div>
        <div className="absolute bottom-0 left-4 right-4 glass-divider" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {prevSessionAvailable && (
          <Section title="Session" icon="◎">
            <p className="text-[11px] text-jarvis-ice/45 mb-2 leading-relaxed">
              A previous session was kept aside on launch. Memory is always preserved.
            </p>
            <ActionBtn label="Restore previous session" onClick={() => restoreLastSession()} accent />
          </Section>
        )}

        <Section title="Voice" icon="◈">
          <ToggleRow
            label="Speak aloud"
            hint="JARVIS replies with TTS"
            value={voiceEnabled}
            onChange={setVoiceEnabled}
          />
          <ToggleRow
            label="Wake listening"
            hint="Mic stays open for “Hey JARVIS”"
            value={wakeEnabled && micEnabled}
            onChange={async (v) => {
              if (v) await startWakeListening();
              else stopWakeListening();
            }}
          />
          <ToggleRow
            label="Barge-in cancel"
            hint="Say “cancel” while speaking"
            value={bargeIn}
            onChange={setBargeIn}
          />
        </Section>

        <Section title="Display" icon="▣">
          <ActionBtn
            label="Reset panel layout"
            onClick={() => { if (confirm("Reset all panel positions?")) resetAllLayouts(); }}
          />
        </Section>

        <Section title="System" icon="⬡">
          <KV k="Image model"  v={health?.image_model || "—"} />
          <KV k="Permissions"  v={health?.permission_mode || "—"} />
          <KV k="Plugins"      v={String(health?.plugins?.length ?? 0)} />
          <KV k="Agents"       v={(agents.length ? agents : health?.agents || []).join(", ") || "—"} />
          <p className="pt-2 text-[10px] text-jarvis-ice/35 leading-relaxed">
            Core model endpoint lives in <span className="text-jarvis-aqua">config.yaml</span>.
            Use the command bar model switcher for hot-swaps.
          </p>
        </Section>

        <Section title="Data" icon="▤">
          <div className="grid grid-cols-1 gap-1.5">
            <ActionBtn label="Clear chat history" onClick={() => { if (confirm("Wipe chat?")) clearChat(); }} />
            <ActionBtn label="Clear media bay" onClick={() => { if (confirm("Wipe media?")) clearMedia(); }} />
            <ActionBtn label="Clear tool history" onClick={() => { if (confirm("Wipe tool history?")) clearTools(); }} />
            <ActionBtn
              label="Clean slate"
              danger
              onClick={cleanSlate}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg px-2.5 py-2 min-w-0"
      style={{
        background: "rgba(8,14,26,0.45)",
        boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.14)",
      }}
    >
      <div className="text-[8px] text-mono tracking-[0.28em] text-jarvis-cyan/40 uppercase">{label}</div>
      <div className="text-[11px] text-mono text-jarvis-ice/90 truncate mt-0.5" title={value}>{value}</div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-lg p-3.5 space-y-2.5"
      style={{
        background: "rgba(14,24,42,0.35)",
        boxShadow:
          "inset 1px 1px 0 rgba(255,255,255,0.06), inset -1px -1px 0 rgba(0,0,0,0.28), inset 0 0 0 1px rgba(125,211,252,0.10)",
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-jarvis-cyan/55 text-[11px]">{icon}</span>
        <span className="text-[10px] tracking-[0.32em] text-jarvis-cyan/70 uppercase text-mono">
          {title}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer py-1.5 px-1 rounded-lg hover:bg-jarvis-cyan/[0.04] transition-colors">
      <div className="min-w-0">
        <div className="text-[12px] text-jarvis-ice/90">{label}</div>
        {hint && <div className="text-[10px] text-jarvis-ice/35 mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className="relative w-10 h-5 rounded-full transition-colors shrink-0"
        style={{
          background: value ? "rgba(125,211,252,0.75)" : "rgba(186,230,253,0.12)",
          boxShadow: value
            ? "0 0 14px rgba(125,211,252,0.55)"
            : "inset 0 0 0 1px rgba(186,230,253,0.2)",
        }}
        aria-pressed={value}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-jarvis-ice transition-all"
          style={{ left: value ? 22 : 2 }}
        />
      </button>
    </label>
  );
}

function ActionBtn({
  label,
  onClick,
  danger = false,
  accent = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg text-[11px] transition-all ${
        danger
          ? "text-jarvis-danger hover:bg-jarvis-danger/10"
          : accent
            ? "text-jarvis-aqua hover:bg-jarvis-aqua/10"
            : "text-jarvis-ice/85 hover:bg-jarvis-cyan/10"
      }`}
      style={{
        boxShadow: danger
          ? "inset 0 0 0 1px rgba(251,113,133,0.28)"
          : accent
            ? "inset 0 0 0 1px rgba(165,243,252,0.3)"
            : "inset 0 0 0 1px rgba(125,211,252,0.14)",
      }}
    >
      {label}
    </button>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 px-1 text-[11px]">
      <span className="text-jarvis-ice/40">{k}</span>
      <span className="text-jarvis-ice/90 truncate max-w-[62%] text-right" title={v}>{v}</span>
    </div>
  );
}
