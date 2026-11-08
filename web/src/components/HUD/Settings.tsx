/**
 * SETTINGS — refined control surface for the fused Dialogue HUD.
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
  const gestureEnabled = useStore((s) => s.gestureEnabled);
  const setGestureEnabled = useStore((s) => s.setGestureEnabled);
  const gestureStatus = useStore((s) => s.gestureStatus);
  const clearChat = useStore((s) => s.clearChat);
  const clearMedia = useStore((s) => s.clearMedia);
  const clearTools = useStore((s) => s.clearTools);
  const setReader = useStore((s) => s.setReader);
  const prevSessionAvailable = useStore((s) => s.prevSessionAvailable);
  const restoreLastSession = useStore((s) => s.restoreLastSession);
  const dockPanel = useStore((s) => s.dockPanel);

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

  const modelName = health?.model.model || "—";
  const provider = health?.model.provider || "—";

  return (
    <div className="holo-panel flex flex-col h-full overflow-hidden relative">
      {/* Atmosphere wash */}
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(90% 70% at 0% 0%, rgba(125,211,252,0.16), transparent 55%)," +
            "radial-gradient(70% 50% at 100% 100%, rgba(56,189,248,0.08), transparent 50%)," +
            "linear-gradient(180deg, rgba(8,14,26,0.2), transparent 40%)",
        }}
      />

      <header className="relative shrink-0 px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-mono text-[9px] tracking-[0.38em] uppercase text-jarvis-cyan/50">
              Mission control
            </div>
            <h2 className="mt-1 text-display text-[22px] tracking-[0.18em] text-jarvis-ice/95">
              SETTINGS
            </h2>
          </div>
          <button
            type="button"
            onClick={() => dockPanel("settings")}
            className="text-mono text-[10px] tracking-[0.2em] uppercase px-2.5 py-1.5 rounded-md text-jarvis-ice/55 hover:text-jarvis-ice transition-colors"
            style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.2)" }}
            title="Dock settings"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <HeroStat label="Active model" value={modelName} />
          <HeroStat label="Provider" value={provider} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <MiniStat label="Tools" value={String(health?.tools ?? 0)} />
          <MiniStat label="Plugins" value={String(health?.plugins?.length ?? 0)} />
          <MiniStat label="Mode" value={health?.permission_mode || "—"} />
        </div>
      </header>

      <div className="relative flex-1 min-h-0 overflow-y-auto px-4 pb-5 space-y-3">
        {prevSessionAvailable && (
          <Panel title="Session">
            <p className="text-[11px] text-jarvis-ice/45 mb-3 leading-relaxed">
              A previous session is available. Memory is always preserved.
            </p>
            <ActionBtn label="Restore previous session" onClick={() => restoreLastSession()} accent />
          </Panel>
        )}

        <Panel title="Voice & input">
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
            label="Barge-in interrupt"
            hint="Talk over JARVIS to cut him off"
            value={bargeIn}
            onChange={setBargeIn}
          />
          <ToggleRow
            label="Hands"
            hint={gestureStatus || "Webcam bg · pinch=click · fist=drag · 2 hands=scale"}
            value={gestureEnabled}
            onChange={setGestureEnabled}
          />
        </Panel>

        <Panel title="Layout">
          <ActionBtn
            label="Reset panel positions"
            onClick={() => { if (confirm("Reset all panel positions?")) resetAllLayouts(); }}
          />
          <p className="pt-2 text-[10px] text-jarvis-ice/35 leading-relaxed">
            Open SYS / TERM / SET from the top icon dock. Dialogue stays on the canvas.
          </p>
        </Panel>

        <Panel title="Runtime">
          <KV k="Image model" v={health?.image_model || "—"} />
          <KV k="Endpoint" v={health?.model.endpoint || "—"} />
          <KV
            k="Agents"
            v={(agents.length ? agents : health?.agents || []).join(", ") || "—"}
          />
        </Panel>

        <Panel title="Data">
          <div className="grid grid-cols-1 gap-1.5">
            <ActionBtn label="Clear chat history" onClick={() => { if (confirm("Wipe chat?")) clearChat(); }} />
            <ActionBtn label="Clear media bay" onClick={() => { if (confirm("Wipe media?")) clearMedia(); }} />
            <ActionBtn label="Clear tool history" onClick={() => { if (confirm("Wipe tool history?")) clearTools(); }} />
            <ActionBtn label="Clean slate" danger onClick={cleanSlate} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-3 py-2.5 min-w-0"
      style={{
        background: "linear-gradient(160deg, rgba(125,211,252,0.12), rgba(8,14,26,0.55))",
        boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.22)",
      }}
    >
      <div className="text-[8px] text-mono tracking-[0.28em] text-jarvis-cyan/45 uppercase">{label}</div>
      <div className="text-[13px] text-mono text-jarvis-ice mt-1 truncate" title={value}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg px-2.5 py-2 min-w-0"
      style={{
        background: "rgba(8,14,26,0.4)",
        boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.12)",
      }}
    >
      <div className="text-[8px] text-mono tracking-[0.22em] text-jarvis-cyan/35 uppercase">{label}</div>
      <div className="text-[11px] text-mono text-jarvis-ice/85 truncate mt-0.5" title={value}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl px-3.5 py-3 space-y-1.5"
      style={{
        background: "rgba(10,18,32,0.55)",
        boxShadow:
          "inset 1px 1px 0 rgba(255,255,255,0.05), inset -1px -1px 0 rgba(0,0,0,0.35), inset 0 0 0 1px rgba(125,211,252,0.12)",
      }}
    >
      <div className="flex items-center gap-2 pb-1.5 mb-0.5"
        style={{ boxShadow: "inset 0 -1px 0 rgba(125,211,252,0.08)" }}
      >
        <span className="w-1 h-1 rounded-full bg-jarvis-cyan/70" />
        <span className="text-[10px] tracking-[0.28em] text-jarvis-cyan/65 uppercase text-mono">
          {title}
        </span>
      </div>
      <div className="space-y-0.5">{children}</div>
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
    <label className="flex items-center justify-between gap-3 cursor-pointer py-2 px-1.5 rounded-lg hover:bg-jarvis-cyan/[0.05] transition-colors">
      <div className="min-w-0">
        <div className="text-[12px] text-jarvis-ice/90">{label}</div>
        {hint && <div className="text-[10px] text-jarvis-ice/35 mt-0.5 leading-snug">{hint}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className="relative w-11 h-[22px] rounded-full transition-colors shrink-0"
        style={{
          background: value
            ? "linear-gradient(90deg, rgba(56,189,248,0.85), rgba(125,211,252,0.95))"
            : "rgba(186,230,253,0.1)",
          boxShadow: value
            ? "0 0 16px rgba(125,211,252,0.45)"
            : "inset 0 0 0 1px rgba(186,230,253,0.18)",
        }}
        aria-pressed={value}
      >
        <span
          className="absolute top-[3px] w-4 h-4 rounded-full bg-jarvis-ink transition-all"
          style={{
            left: value ? 24 : 3,
            background: value ? "#03101c" : "rgba(226,232,240,0.85)",
          }}
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
      className={`w-full text-left px-3 py-2.5 rounded-lg text-[11px] tracking-wide transition-all ${
        danger
          ? "text-jarvis-danger hover:bg-jarvis-danger/10"
          : accent
            ? "text-jarvis-aqua hover:bg-jarvis-aqua/10"
            : "text-jarvis-ice/85 hover:bg-jarvis-cyan/10"
      }`}
      style={{
        boxShadow: danger
          ? "inset 0 0 0 1px rgba(251,113,133,0.3)"
          : accent
            ? "inset 0 0 0 1px rgba(165,243,252,0.32)"
            : "inset 0 0 0 1px rgba(125,211,252,0.16)",
      }}
    >
      {label}
    </button>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 px-1 text-[11px]">
      <span className="text-jarvis-ice/40 shrink-0">{k}</span>
      <span className="text-jarvis-ice/90 truncate max-w-[64%] text-right text-mono text-[10px]" title={v}>{v}</span>
    </div>
  );
}
