/**
 * Barehands stage — fullscreen takeover OR transparent dashboard embed.
 * (https://github.com/jaredrhod/barehands, AGPL-3.0)
 *
 * Embed mode (`?mode=overlay&embed=jarvis`): glass cards over the HUD,
 * no Barehands ring — JARVIS keeps its own orb. Esc / Hands toggle closes.
 */
import { useEffect, useState } from "react";
import { closeBarehands } from "../../lib/api";
import { useStore } from "../../lib/store";

export default function BarehandsOverlay() {
  const open = useStore((s) => s.barehandsOpen);
  const embed = useStore((s) => s.barehandsEmbed);
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

  if (embed) {
    return (
      <div className="fixed inset-0 z-[55] pointer-events-none bg-transparent">
        {!loaded && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 text-jarvis-ice/45 text-mono text-[10px] tracking-[0.22em] uppercase pointer-events-none">
            Hands stage…
          </div>
        )}
        {/* pointer-events none: host HUD stays clickable; Barehands drives cards via its own hand tracker */}
        <iframe
          title="Barehands embed"
          src={url}
          className="absolute inset-0 w-full h-full border-0 bg-transparent pointer-events-none"
          allow="camera; microphone; autoplay; clipboard-read; clipboard-write"
          onLoad={() => setLoaded(true)}
        />
      </div>
    );
  }

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

      <div className="absolute bottom-3 right-3 z-[91] pointer-events-none text-mono text-[9px] tracking-[0.22em] uppercase text-jarvis-ice/35">
        Esc to close
      </div>
    </div>
  );
}
