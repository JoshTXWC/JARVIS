import { useEffect, useMemo, useState } from "react";
import { getStats } from "../../lib/api";
import { useStore, nextId } from "../../lib/store";
import { startWakeListening } from "../../lib/wakeMic";
import { wsClient } from "../../lib/ws";
import Orb from "../Orb/Orb";

export default function CommandCenter() {
  const health = useStore((s) => s.health);
  const connected = useStore((s) => s.connected);
  const stats = useStore((s) => s.stats);
  const setStats = useStore((s) => s.setStats);
  const orb = useStore((s) => s.orbState);
  const micEnabled = useStore((s) => s.micEnabled);
  const audio = useStore((s) => s.audioLevel);
  const setActiveView = useStore((s) => s.setActiveView);
  const pushChat = useStore((s) => s.pushChat);
  const tools = useStore((s) => s.tools);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const s = await getStats();
        if (live) setStats(s);
      } catch { /* ignore */ }
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [setStats]);

  const listening = orb === "listening" || micEnabled;
  const healthPct = useMemo(() => {
    if (!connected) return 0;
    const cpu = stats?.cpu ?? 20;
    return Math.max(72, Math.min(99, Math.round(100 - cpu * 0.25)));
  }, [connected, stats]);

  const runQuick = (text: string, view?: string) => {
    if (view) {
      setActiveView(view);
      return;
    }
    setActiveView("conversations");
    pushChat({ id: nextId(), role: "user", text, ts: Date.now() });
    wsClient.chat(text);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = query.trim();
    if (!text) return;
    setQuery("");
    runQuick(text);
  };

  const running = tools.find((t) => t.status === "running");

  return (
    <div className="home-shell">
      <section className="home-hero">
        <div className="relative w-full max-w-[280px] aspect-square mb-2">
          <div
            className="absolute inset-[-12%] rounded-full pointer-events-none animate-orb_pulse"
            style={{
              background: "radial-gradient(circle, rgba(0,200,255,0.18), transparent 68%)",
            }}
          />
          <Orb variant="hero" />
        </div>

        <h1 className="home-brand">J.A.R.V.I.S.</h1>
        <p className="home-prompt">How can I assist you today?</p>

        <form onSubmit={submit} className="home-command">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask anything…"
            aria-label="Ask JARVIS"
          />
          <button
            type="button"
            title="Voice"
            onClick={() => void startWakeListening()}
            className={`cc-icon-btn shrink-0 ${listening ? "active" : ""}`}
            style={{ borderRadius: 999, width: 36, height: 36 }}
          >
            <MicIcon />
          </button>
          <button
            type="submit"
            title="Send"
            className="shrink-0 w-9 h-9 rounded-full grid place-items-center bg-jarvis-primary text-jarvis-bg shadow-[0_0_20px_rgba(0,200,255,0.35)]"
          >
            <SendIcon />
          </button>
        </form>

        <div className="home-actions">
          <button type="button" className="home-action" onClick={() => setActiveView("diag")}>
            <StatusIcon />
            System Status
          </button>
          <button
            type="button"
            className="home-action"
            onClick={() => runQuick("What actions can you run for me right now?")}
          >
            <BoltIcon />
            Run Action
          </button>
          <button
            type="button"
            className="home-action"
            onClick={() => runQuick("Help me schedule my next focus block.")}
          >
            <CalIcon />
            Schedule
          </button>
          <button
            type="button"
            className="home-action"
            onClick={() => runQuick("Research the latest developments relevant to my work.")}
          >
            <SearchIcon />
            Research
          </button>
        </div>
      </section>

      <section className="home-bento">
        <div className="bento-tile span-3">
          <div className="bento-label">System Health</div>
          <div className="flex items-center gap-3">
            <Ring pct={healthPct} />
            <div>
              <div className="text-sm text-jarvis-text">{connected ? "Nominal" : "Offline"}</div>
              <div className="text-mono text-[11px] text-jarvis-muted mt-0.5">
                {health?.model?.model || "Local core"}
              </div>
            </div>
          </div>
        </div>

        <div className="bento-tile span-3">
          <div className="bento-label">Voice</div>
          <VoiceWave active={listening || orb === "speaking"} level={audio} />
          <div className="text-sm text-jarvis-text mt-2 capitalize">
            {listening ? "Listening" : orb === "speaking" ? "Speaking" : orb === "thinking" ? "Thinking" : "Idle"}
          </div>
        </div>

        <div className="bento-tile span-3">
          <div className="bento-label">Next</div>
          <div className="text-sm text-jarvis-text">{running?.tool || "Team Sync"}</div>
          <div className="text-mono text-[11px] text-jarvis-muted mt-1">
            {running ? "In progress" : "Standby"}
          </div>
        </div>

        <div className="bento-tile span-3">
          <div className="bento-label">PC Controls</div>
          <div className="flex gap-2 mt-1">
            <CtrlBtn label="Sleep" onClick={() => runQuick("Put this PC to sleep.")} />
            <CtrlBtn label="Lock" onClick={() => runQuick("Lock the workstation.")} />
            <CtrlBtn label="Power" onClick={() => runQuick("Prepare a safe shutdown checklist.")} />
          </div>
        </div>

        <div className="bento-tile span-6">
          <div className="bento-label">Quick Actions</div>
          <div className="flex flex-wrap gap-2">
            <Pill onClick={() => runQuick("Open Visual Studio Code.")}>Open VS Code</Pill>
            <Pill onClick={() => runQuick("Play some focus music.")}>Play Music</Pill>
            <Pill onClick={() => setActiveView("conversations")}>Open Chat</Pill>
            <Pill onClick={() => setActiveView("tools")}>Tools</Pill>
          </div>
        </div>

        <div className="bento-tile span-6">
          <div className="bento-label">Notes</div>
          <ul className="space-y-2 text-sm text-jarvis-muted">
            <Note done>Systems online</Note>
            <Note>Review pending tools</Note>
            <Note>Ask JARVIS anything</Note>
          </ul>
        </div>
      </section>
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0">
      <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(25,40,56,1)" strokeWidth="4" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke="#00C8FF"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 28 28)"
        style={{ filter: "drop-shadow(0 0 6px rgba(0,200,255,0.55))", transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text x="28" y="32" textAnchor="middle" fill="#EAF4FF" fontSize="11" fontFamily="JetBrains Mono, monospace">
        {pct}%
      </text>
    </svg>
  );
}

function VoiceWave({ active, level }: { active: boolean; level: number }) {
  const bars = [0.35, 0.7, 1, 0.55, 0.85, 0.45, 0.75, 0.6, 0.4];
  return (
    <div className={`voice-wave ${active ? "" : "idle"}`}>
      {bars.map((b, i) => (
        <span
          key={i}
          style={{
            height: `${Math.max(20, b * (active ? Math.max(0.35, level) : 0.25) * 100)}%`,
            animationDelay: `${i * 0.08}s`,
            opacity: active ? 0.9 : 0.35,
          }}
        />
      ))}
    </div>
  );
}

function CtrlBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="preset-btn flex-1 py-2 text-[11px]">
      {label}
    </button>
  );
}

function Pill({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="preset-btn rounded-full py-2 px-3 text-[12px]">
      {children}
    </button>
  );
}

function Note({ children, done }: { children: React.ReactNode; done?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className="w-3.5 h-3.5 rounded-[3px] border shrink-0"
        style={{
          borderColor: done ? "#00C8FF" : "#192838",
          background: done ? "rgba(0,200,255,0.25)" : "transparent",
        }}
      />
      <span className={done ? "text-jarvis-text line-through opacity-60" : ""}>{children}</span>
    </li>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M13 2L4 14h7l-1 8 10-14h-7l1-6z" strokeLinejoin="round" />
    </svg>
  );
}

function CalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}
