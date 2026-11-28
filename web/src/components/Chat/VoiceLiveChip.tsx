/**
 * Large left-side voice chip — live transcript + audio bars while talking.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import { cn } from "@/lib/utils";
import JarvisLogo from "../Brand/JarvisLogo";

const BARS = 12;

export default function VoiceLiveChip() {
  const micEnabled = useStore((s) => s.micEnabled);
  const micStatus = useStore((s) => s.micStatus);
  const micMode = useStore((s) => s.micMode);
  const orbState = useStore((s) => s.orbState);
  const audioLevel = useStore((s) => s.audioLevel);
  const liveTranscript = useStore((s) => s.liveTranscript);
  const chat = useStore((s) => s.chat);
  const [tick, setTick] = useState(0);

  const active =
    micEnabled ||
    orbState === "listening" ||
    orbState === "speaking" ||
    orbState === "thinking" ||
    micMode === "speaking";

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      setTick(performance.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const lastAssistant = useMemo(() => {
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i].role === "assistant" && chat[i].text?.trim()) return chat[i];
    }
    return null;
  }, [chat]);

  const speaking = orbState === "speaking" || micMode === "speaking";
  const listening = orbState === "listening" || (micEnabled && !speaking);

  const headline = speaking
    ? "JARVIS speaking"
    : listening
      ? "Listening"
      : orbState === "thinking"
        ? "Thinking"
        : "Voice";

  const body = speaking
    ? (lastAssistant?.text || liveTranscript || "…").trim()
    : liveTranscript.trim() ||
      (micStatus && !micStatus.startsWith("listening · say") ? micStatus : "") ||
      (listening ? "Speak naturally…" : "…");

  const bars = useMemo(() => {
    const level = Math.min(1, Math.max(0.05, audioLevel || (speaking || listening ? 0.2 : 0.08)));
    const t = tick / 180;
    return Array.from({ length: BARS }, (_, i) => {
      const center = (BARS - 1) / 2;
      const dist = Math.abs(i - center) / Math.max(center, 1);
      const shape = 1 - dist * 0.55;
      const wave = 0.55 + 0.45 * Math.sin(t + i * 0.65);
      return Math.max(0.12, Math.min(1, level * 1.4 * shape * wave));
    });
  }, [audioLevel, speaking, listening, tick]);

  if (!active) return null;

  return (
    <aside
      className={cn(
        "pointer-events-none absolute left-[84px] top-1/2 z-[25] w-[min(320px,34vw)] -translate-y-1/2",
        "rounded-3xl border border-white/12 bg-[#141418]/92 p-4 shadow-[0_20px_60px_-24px_rgba(0,0,0,0.8)] backdrop-blur-lg",
      )}
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/[0.06]">
          <JarvisLogo size={36} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#71767b]">
            {headline}
          </div>
          <div className="mt-2 flex h-7 items-end gap-[3px]">
            {bars.map((h, i) => (
              <span
                key={i}
                className={cn(
                  "w-[3px] rounded-full transition-[height] duration-75",
                  speaking ? "bg-sky-300" : "bg-emerald-300",
                )}
                style={{
                  height: `${Math.max(4, Math.round(h * 26))}px`,
                  opacity: 0.45 + h * 0.55,
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 max-h-[40vh] overflow-y-auto text-[14px] leading-relaxed text-[#e7e9ea]">
        {body.length > 420 ? `${body.slice(0, 420).trim()}…` : body}
      </p>
    </aside>
  );
}
