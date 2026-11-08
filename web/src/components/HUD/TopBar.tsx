import { useEffect, useState } from "react";
import { closeBarehands } from "../../lib/api";
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
  const barehandsEmbed = useStore((s) => s.barehandsEmbed);
  const barehandsBusy = useStore((s) => s.barehandsBusy);
  const setBarehandsOpen = useStore((s) => s.setBarehandsOpen);
  const setBarehandsBusy = useStore((s) => s.setBarehandsBusy);
  const gestureEnabled = useStore((s) => s.gestureEnabled);
  const setGestureEnabled = useStore((s) => s.setGestureEnabled);
  const backgroundMode = useStore((s) => s.backgroundMode);
  const setBackgroundMode = useStore((s) => s.setBackgroundMode);
  const neuralOn = backgroundMode === "neural";

  // Unified Hands = gesture tracker (webcam bg + cursor + scale). Fullscreen
  // Barehands stage still closes via the same button when opened by voice.
  const handsOn = gestureEnabled;
  const stageFullscreen = barehandsOpen && !barehandsEmbed;

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
      // Close any leftover embed from older sessions
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
    // One pipeline only — no second Barehands camera (that caused lag).
    setGestureEnabled(true);
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

  const barZ = stageFullscreen ? "z-[97]" : "z-40";

  return (
    <div className={`absolute top-0 inset-x-0 ${barZ} pointer-events-none px-2`}>
      <div className="relative flex items-center justify-between py-2.5 gap-3">
        <div
          className={`pointer-events-auto flex items-center gap-3 shrink-0 min-w-[140px] transition-opacity ${
            stageFullscreen ? "opacity-40" : ""
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

        {!stageFullscreen && (
          <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
            <IconDock onUndock={onUndock} />
          </div>
        )}

        <div className="pointer-events-auto flex items-center gap-2.5 shrink-0 min-w-[140px] justify-end">
          {!stageFullscreen && (
            <button
              type="button"
              onClick={() => setBackgroundMode(neuralOn ? "orb" : "neural")}
              title={
                neuralOn
                  ? "Switch to classic JARVIS orb background"
                  : "Neural cloud background — zoom, orbit, click nodes"
              }
              className={`h-9 px-2.5 rounded-lg flex items-center gap-1.5 transition-all ${
                neuralOn ? "text-jarvis-ice" : "text-jarvis-ice/70 hover:text-jarvis-ice"
              }`}
              style={{
                background: neuralOn
                  ? "rgba(167,139,250,0.18)"
                  : "rgba(14,24,42,0.55)",
                boxShadow: neuralOn
                  ? "0 0 0 1px rgba(167,139,250,0.5), 0 0 16px -4px rgba(167,139,250,0.45)"
                  : "inset 1px 1px 0 rgba(255,255,255,0.08), inset -1px -1px 0 rgba(0,0,0,0.28), inset 0 0 0 1px rgba(125,211,252,0.16)",
              }}
            >
              <NeuralIcon active={neuralOn} />
              <span className="text-mono text-[10px] tracking-[0.18em] uppercase">
                Neural
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void toggleHands()}
            disabled={!connected || barehandsBusy}
            title={
              stageFullscreen
                ? "Close Barehands stage"
                : handsOn
                  ? "Disable Hands (webcam bg · pinch=click · fist=drag · 2 hands=scale)"
                  : "Hands — webcam background + unified hand controls"
            }
            className={`h-9 px-2.5 rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-40 ${
              handsOn || stageFullscreen
                ? "text-jarvis-ice"
                : "text-jarvis-ice/70 hover:text-jarvis-ice"
            }`}
            style={{
              background:
                handsOn || stageFullscreen
                  ? "rgba(125,211,252,0.16)"
                  : "rgba(14,24,42,0.55)",
              boxShadow:
                handsOn || stageFullscreen
                  ? "0 0 0 1px rgba(125,211,252,0.45), 0 0 16px -4px rgba(125,211,252,0.5)"
                  : "inset 1px 1px 0 rgba(255,255,255,0.08), inset -1px -1px 0 rgba(0,0,0,0.28), inset 0 0 0 1px rgba(125,211,252,0.16)",
            }}
          >
            <HandIcon active={handsOn || stageFullscreen} />
            <span className="text-mono text-[10px] tracking-[0.18em] uppercase">
              {barehandsBusy ? "…" : "Hands"}
            </span>
          </button>
          {!stageFullscreen && (
            <div className="text-mono text-right leading-tight tabular-nums">
              <div className="text-[15px] text-jarvis-ice glow-text tracking-wider">{time}</div>
              <div className="text-[10px] text-jarvis-ice/40 uppercase tracking-[0.18em]">{date}</div>
            </div>
          )}
        </div>
      </div>
      {!stageFullscreen && <div className="glass-divider" />}
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

function NeuralIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={active ? "text-violet-300" : "text-jarvis-cyan/70"}
    >
      <circle cx="6" cy="7" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="12" cy="17" r="2" />
      <path d="M8 8l3.5 7M16 8l-3.5 7M8 7h8" strokeLinecap="round" />
    </svg>
  );
}
