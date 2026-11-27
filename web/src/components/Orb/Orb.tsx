/**
 * JARVIS Orb — VoicePoweredOrb wrapper driven by store orbState.
 */
import { useMemo } from "react";
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb";
import { useStore, type OrbState } from "../../lib/store";
import { cn } from "@/lib/utils";

const HUE: Record<OrbState, number> = {
  idle: 205,
  listening: 200,
  thinking: 265,
  speaking: 195,
  executing: 145,
  error: 350,
};

export default function Orb({
  variant = "fullscreen",
  className,
  enableVoiceControl,
}: {
  variant?: "fullscreen" | "hero" | "corner" | "inline";
  className?: string;
  enableVoiceControl?: boolean;
}) {
  const orbState = useStore((s) => s.orbState);
  const micEnabled = useStore((s) => s.micEnabled);
  const hue = useMemo(() => HUE[orbState] ?? 200, [orbState]);
  const voiceOn =
    enableVoiceControl ?? (micEnabled || orbState === "listening" || orbState === "speaking");

  const sizeClass =
    variant === "corner"
      ? "w-24 h-24"
      : variant === "inline"
        ? "w-full h-full"
        : variant === "hero"
          ? "w-[min(42vw,280px)] h-[min(42vw,280px)]"
          : "w-[min(52vw,340px)] h-[min(52vw,340px)]";

  const positionClass =
    variant === "fullscreen"
      ? "fixed left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 z-[5] pointer-events-none"
      : variant === "corner"
        ? "fixed right-6 bottom-6 z-[30] pointer-events-none"
        : variant === "hero"
          ? "relative pointer-events-none"
          : "relative";

  return (
    <div className={cn(positionClass, sizeClass, className)} aria-hidden>
      <VoicePoweredOrb
        hue={hue}
        enableVoiceControl={voiceOn}
        className="rounded-full overflow-hidden"
      />
    </div>
  );
}
