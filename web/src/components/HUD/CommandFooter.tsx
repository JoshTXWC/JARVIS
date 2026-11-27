import { useStore } from "../../lib/store";
import { startWakeListening } from "../../lib/wakeMic";
import { wsClient } from "../../lib/ws";
import { nextId } from "../../lib/store";

export default function CommandFooter() {
  const orb = useStore((s) => s.orbState);
  const micEnabled = useStore((s) => s.micEnabled);
  const audio = useStore((s) => s.audioLevel);
  const connected = useStore((s) => s.connected);
  const stats = useStore((s) => s.stats);
  const setActiveView = useStore((s) => s.setActiveView);
  const pushChat = useStore((s) => s.pushChat);
  const listening = orb === "listening" || micEnabled;

  const host = stats?.os?.node?.split(".")[0] || "Local";
  const netLabel = connected ? "Excellent" : "Offline";

  const talk = () => {
    void startWakeListening();
  };

  const briefing = () => {
    const prompt =
      "Give me a concise executive briefing: system status, open tasks, and anything I should know right now.";
    setActiveView("conversations");
    pushChat({ id: nextId(), role: "user", text: prompt, ts: Date.now() });
    wsClient.chat(prompt);
  };

  return (
    <footer className="cc-footer shrink-0">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <Pill icon="📍" label={host} />
        <Pill icon="☁" label={stats ? `${Math.round(stats.cpu)}% load` : "—"} />
        <Pill
          icon="◉"
          label={netLabel}
          tone={connected ? "ok" : "danger"}
        />
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center">
        <button type="button" onClick={talk} className={`cc-talk-btn ${listening ? "listening" : ""}`}>
          <SideWave active={listening} level={audio} mirror={false} />
          <span className="px-4 tracking-[0.22em] uppercase font-semibold text-sm">
            Talk to Jarvis
          </span>
          <SideWave active={listening} level={audio} mirror />
        </button>
        <div className="text-[10px] tracking-[0.18em] uppercase text-jarvis-cyan/45 mt-1">
          {listening ? "I am listening…" : orb === "speaking" ? "Responding…" : "Say the wake word or tap"}
        </div>
      </div>

      <div className="flex items-center justify-end">
        <button type="button" onClick={briefing} className="cc-briefing-btn">
          <PlayIcon />
          <span>Executive Briefing</span>
        </button>
      </div>
    </footer>
  );
}

function Pill({
  icon,
  label,
  tone,
}: {
  icon: string;
  label: string;
  tone?: "ok" | "danger";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] text-jarvis-ice/75 ${
        tone === "ok" ? "text-jarvis-ok/90" : tone === "danger" ? "text-jarvis-danger/90" : ""
      }`}
      style={{
        background: "rgba(8,18,36,0.55)",
        boxShadow: "inset 0 0 0 1px rgba(34,211,238,0.12)",
      }}
    >
      <span className="opacity-70 text-[10px]">{icon}</span>
      {label}
    </span>
  );
}

function SideWave({
  active,
  level,
  mirror,
}: {
  active: boolean;
  level: number;
  mirror?: boolean;
}) {
  const bars = mirror ? [0.5, 0.85, 0.6, 1, 0.45] : [0.45, 1, 0.6, 0.85, 0.5];
  return (
    <div className="flex items-center gap-[2px] h-5">
      {bars.map((b, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-current"
          style={{
            height: `${(active ? Math.max(0.25, level) : 0.2) * b * 100}%`,
            opacity: active ? 0.9 : 0.35,
            transition: "height 70ms linear",
          }}
        />
      ))}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
