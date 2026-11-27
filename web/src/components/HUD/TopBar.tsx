import { useEffect, useState } from "react";
import { closeBarehands } from "../../lib/api";
import { useStore } from "../../lib/store";

export default function TopBar() {
  const [now, setNow] = useState(new Date());
  const [query, setQuery] = useState("");
  const connected = useStore((s) => s.connected);
  const health = useStore((s) => s.health);
  const setActiveView = useStore((s) => s.setActiveView);
  const barehandsOpen = useStore((s) => s.barehandsOpen);
  const barehandsEmbed = useStore((s) => s.barehandsEmbed);
  const barehandsBusy = useStore((s) => s.barehandsBusy);
  const setBarehandsOpen = useStore((s) => s.setBarehandsOpen);
  const setBarehandsBusy = useStore((s) => s.setBarehandsBusy);
  const gestureEnabled = useStore((s) => s.gestureEnabled);
  const setGestureEnabled = useStore((s) => s.setGestureEnabled);
  const backgroundMode = useStore((s) => s.backgroundMode);
  const setBackgroundMode = useStore((s) => s.setBackgroundMode);

  const handsOn = gestureEnabled;
  const stageFullscreen = barehandsOpen && !barehandsEmbed;
  const neuralOn = backgroundMode === "neural";
  const statusOk = connected && health?.status !== "error";

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const date = now.toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const toggleHands = async () => {
    if (barehandsBusy) return;
    if (stageFullscreen) {
      setBarehandsBusy(true);
      try {
        setBarehandsOpen(false);
        await closeBarehands().catch(() => undefined);
      } finally {
        setBarehandsBusy(false);
      }
      return;
    }
    if (handsOn) {
      setGestureEnabled(false);
      if (barehandsOpen) {
        setBarehandsBusy(true);
        try {
          setBarehandsOpen(false);
          await closeBarehands().catch(() => undefined);
        } finally {
          setBarehandsBusy(false);
        }
      }
      return;
    }
    setGestureEnabled(true);
  };

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setActiveView("conversations");
    window.dispatchEvent(new CustomEvent("jarvis:prefill-command", { detail: { text: query.trim() } }));
    setQuery("");
  };

  return (
    <header className="cc-topbar shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative w-9 h-9 grid place-items-center shrink-0">
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: statusOk
                ? "radial-gradient(circle, rgba(34,211,238,0.25), transparent 70%)"
                : "radial-gradient(circle, rgba(251,113,133,0.25), transparent 70%)",
              boxShadow: statusOk
                ? "0 0 16px rgba(34,211,238,0.45)"
                : "0 0 12px rgba(251,113,133,0.4)",
            }}
          />
          <ReactorIcon online={statusOk} />
        </div>
        <div className="leading-tight min-w-0">
          <div className="text-[13px] font-semibold tracking-[0.18em] uppercase text-jarvis-ice glow-text truncate">
            JARVIS Command Center
          </div>
          <div
            className={`inline-flex items-center gap-1.5 mt-0.5 px-2 py-0.5 rounded-full text-[9px] tracking-[0.16em] uppercase ${
              statusOk ? "text-jarvis-ok" : "text-jarvis-danger"
            }`}
            style={{
              background: statusOk ? "rgba(74,222,128,0.1)" : "rgba(251,113,133,0.1)",
              boxShadow: statusOk
                ? "0 0 0 1px rgba(74,222,128,0.35), 0 0 12px rgba(74,222,128,0.2)"
                : "0 0 0 1px rgba(251,113,133,0.35)",
            }}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${statusOk ? "bg-jarvis-ok" : "bg-jarvis-danger"} animate-pulse`} />
            System Status: {statusOk ? "Optimal" : "Offline"}
          </div>
        </div>
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none">
        <div className="text-[11px] tracking-[0.14em] text-jarvis-cyan/55 uppercase">{date}</div>
        <div className="text-[28px] font-light tabular-nums tracking-wider text-jarvis-cyan glow-text leading-none mt-0.5">
          {time}
        </div>
      </div>

      <div className="flex items-center gap-2 justify-end min-w-0">
        <form onSubmit={onSearch} className="hidden md:block">
          <div className="cc-search">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search systems…"
              className="bg-transparent border-0 outline-none text-sm text-jarvis-ice placeholder:text-jarvis-ice/30 w-36 lg:w-48"
            />
          </div>
        </form>

        <IconBtn
          title={neuralOn ? "Classic orb" : "Neural cloud"}
          active={neuralOn}
          onClick={() => setBackgroundMode(neuralOn ? "orb" : "neural")}
        >
          <NeuralIcon />
        </IconBtn>
        <IconBtn
          title={handsOn || stageFullscreen ? "Disable Hands" : "Hands mode"}
          active={handsOn || stageFullscreen}
          onClick={() => void toggleHands()}
          disabled={!connected || barehandsBusy}
        >
          <HandIcon />
        </IconBtn>
        <IconBtn title="Notifications" onClick={() => setActiveView("conversations")}>
          <BellIcon />
        </IconBtn>
        <IconBtn title="Settings" onClick={() => setActiveView("settings")}>
          <GearIcon />
        </IconBtn>

        <button
          type="button"
          onClick={() => setActiveView("settings")}
          className="hidden sm:flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full text-left transition-colors hover:bg-white/5"
          style={{ boxShadow: "inset 0 0 0 1px rgba(34,211,238,0.18)" }}
        >
          <span
            className="w-7 h-7 rounded-full grid place-items-center text-[10px] font-semibold text-jarvis-ink"
            style={{ background: "linear-gradient(135deg, #22d3ee, #818cf8)" }}
          >
            OC
          </span>
          <span className="text-xs text-jarvis-ice/80 leading-tight">
            <span className="block text-[9px] uppercase tracking-[0.16em] text-jarvis-cyan/45">Operator</span>
            Commander
          </span>
        </button>
      </div>
    </header>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`cc-icon-btn ${active ? "active" : ""}`}
    >
      {children}
    </button>
  );
}

function ReactorIcon({ online }: { online: boolean }) {
  const c = online ? "#22d3ee" : "#fb7185";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="relative z-10">
      <circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.2" opacity="0.45" />
      <circle cx="12" cy="12" r="5.5" stroke={c} strokeWidth="1.4" />
      <circle cx="12" cy="12" r="2.2" fill={c} opacity="0.95" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-jarvis-cyan/50 shrink-0">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M6 9a6 6 0 0 1 12 0c0 7 2 7 2 7H4s2 0 2-7" strokeLinejoin="round" />
      <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
    </svg>
  );
}

function HandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M8 13V7.5a1.5 1.5 0 0 1 3 0V12M11 12V5.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6.5a1.5 1.5 0 0 1 3 0V14c0 3.5-2.2 6-5.5 6S6 17.5 6 14v-3.5a1.5 1.5 0 0 1 3 0V13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NeuralIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="6" cy="7" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="12" cy="17" r="2" />
      <path d="M8 8l3.5 7M16 8l-3.5 7M8 7h8" strokeLinecap="round" />
    </svg>
  );
}
