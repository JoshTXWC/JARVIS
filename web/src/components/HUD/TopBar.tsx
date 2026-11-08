import { useEffect, useState } from "react";
import { openBarehands, closeBarehands } from "../../lib/api";
import { useStore } from "../../lib/store";
import IconDock from "./IconDock";
import type { DockableId } from "../../lib/dockCatalog";

interface Props {
  onUndock?: (id: DockableId) => void;
}

export default function TopBar({ onUndock }: Props) {
  const [now, setNow] = useState(new Date());
  const connected = useStore((s) => s.connected);
  const barehandsOpen = useStore((s) => s.barehandsOpen);
  const barehandsBusy = useStore((s) => s.barehandsBusy);
  const setBarehandsOpen = useStore((s) => s.setBarehandsOpen);
  const setBarehandsBusy = useStore((s) => s.setBarehandsBusy);

  const toggleBarehands = async () => {
    if (barehandsBusy) return;
    setBarehandsBusy(true);
    try {
      if (barehandsOpen) {
        setBarehandsOpen(false);
        await closeBarehands().catch(() => undefined);
      } else {
        const res = await openBarehands();
        if (res.ok) setBarehandsOpen(true, res.url);
        else console.warn("[barehands]", res.error);
      }
    } finally {
      setBarehandsBusy(false);
    }
  };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const date = now.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  // Stay above the Barehands stage so the Hands toggle remains usable.
  const barZ = barehandsOpen ? "z-[97]" : "z-40";

  return (
    <div className={`absolute top-0 inset-x-0 ${barZ} pointer-events-none px-2`}>
      <div className="relative flex items-center justify-between py-2.5 gap-3">
        {/* Brand — dim while Barehands owns the screen */}
        <div
          className={`pointer-events-auto flex items-center gap-3 shrink-0 min-w-[140px] transition-opacity ${
            barehandsOpen ? "opacity-40" : ""
          }`}
        >
          <div className="relative w-8 h-8 grid place-items-center">
            <div
              className={`absolute inset-0 rounded-lg ${
                connected ? "bg-jarvis-cyan/15" : "bg-jarvis-danger/15"
              }`}
              style={{
                boxShadow: connected
                  ? "0 0 18px rgba(125,211,252,0.45), inset 0 0 0 1px rgba(125,211,252,0.35)"
                  : "inset 0 0 0 1px rgba(251,113,133,0.4)",
              }}
            />
            <ReactorIcon online={connected} />
          </div>
          <div className="leading-tight">
            <div className="text-display text-[13px] tracking-[0.42em] text-shimmer font-medium">
              J.A.R.V.I.S.
            </div>
            <div className="text-mono text-[9px] text-jarvis-cyan/40 tracking-[0.3em]">
              MK II · LOCAL
            </div>
          </div>
        </div>

        {/* Centered icon dock — hidden while Barehands is fullscreen */}
        {!barehandsOpen && (
          <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
            <IconDock onUndock={onUndock} />
          </div>
        )}

        {/* Top-right: Barehands + clock */}
        <div className="pointer-events-auto flex items-center gap-2.5 shrink-0 min-w-[140px] justify-end">
          <button
            type="button"
            onClick={() => void toggleBarehands()}
            disabled={!connected || barehandsBusy}
            title={
              barehandsOpen
                ? "Close Barehands (or say “close barehands”)"
                : "Open Barehands — hand-tracked glass stage (or say “barehands”)"
            }
            className={`h-9 px-2.5 rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-40 ${
              barehandsOpen ? "text-jarvis-ice" : "text-jarvis-ice/70 hover:text-jarvis-ice"
            }`}
            style={{
              background: barehandsOpen
                ? "rgba(125,211,252,0.16)"
                : "rgba(14,24,42,0.55)",
              boxShadow: barehandsOpen
                ? "0 0 0 1px rgba(125,211,252,0.45), 0 0 16px -4px rgba(125,211,252,0.5)"
                : "inset 1px 1px 0 rgba(255,255,255,0.08), inset -1px -1px 0 rgba(0,0,0,0.28), inset 0 0 0 1px rgba(125,211,252,0.16)",
            }}
          >
            <HandIcon active={barehandsOpen} />
            <span className="text-mono text-[10px] tracking-[0.18em] uppercase">
              {barehandsBusy ? "…" : "Hands"}
            </span>
          </button>
          {!barehandsOpen && (
            <div className="text-mono text-right leading-tight tabular-nums">
              <div className="text-[15px] text-jarvis-ice glow-text tracking-wider">{time}</div>
              <div className="text-[10px] text-jarvis-ice/40 uppercase tracking-[0.18em]">{date}</div>
            </div>
          )}
        </div>
      </div>
      {!barehandsOpen && <div className="glass-divider" />}
    </div>
  );
}

function ReactorIcon({ online }: { online: boolean }) {
  const c = online ? "#7dd3fc" : "#fb7185";
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="relative z-10">
      <circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.2" opacity="0.5" />
      <circle cx="12" cy="12" r="5.5" stroke={c} strokeWidth="1.4" />
      <circle cx="12" cy="12" r="2.2" fill={c} opacity="0.9" />
    </svg>
  );
}

function HandIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={active ? "text-jarvis-cyan" : "text-jarvis-cyan/70"}
    >
      <path
        d="M8 13V7.5a1.5 1.5 0 0 1 3 0V12M11 12V5.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6.5a1.5 1.5 0 0 1 3 0V14c0 3.5-2.2 6-5.5 6S6 17.5 6 14v-3.5a1.5 1.5 0 0 1 3 0V13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
