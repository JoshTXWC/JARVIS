/**
 * Fullscreen in-app Barehands stage — no separate tab.
 * (https://github.com/jaredrhod/barehands, AGPL-3.0)
 *
 * Edge-to-edge iframe; JARVIS orb relocates to a corner via Orb.tsx.
 * Close with Esc or the top-right Hands toggle.
 */
import { useEffect, useState } from "react";
import { closeBarehands } from "../../lib/api";
import { useStore } from "../../lib/store";

export default function BarehandsOverlay() {
  const open = useStore((s) => s.barehandsOpen);
  const url = useStore((s) => s.barehandsUrl);
  const setOpen = useStore((s) => s.setBarehandsOpen);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) setLoaded(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const dismiss = async () => {
    setOpen(false);
    try { await closeBarehands(); } catch { /* noop */ }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black">
      {!loaded && (
        <div className="absolute inset-0 grid place-items-center text-jarvis-ice/55 text-mono text-[12px] tracking-wider z-[1]">
          Starting Barehands…
        </div>
      )}

      <iframe
        title="Barehands"
        src={url}
        className="absolute inset-0 w-full h-full border-0 bg-black"
        allow="camera; microphone; autoplay; clipboard-read; clipboard-write"
        allowFullScreen
        onLoad={() => setLoaded(true)}
      />

      {/* Esc hint only — Hands toggle in the top bar closes the stage */}
      <div className="absolute bottom-3 right-3 z-[91] pointer-events-none text-mono text-[9px] tracking-[0.22em] uppercase text-jarvis-ice/35">
        Esc to close
      </div>
    </div>
  );
}
