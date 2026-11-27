/**
 * SETTINGS — ChatGPT-flat preset buttons.
 */
import { useStore } from "../../lib/store";
import { apiFetch } from "../../lib/session";
import { startWakeListening, stopWakeListening } from "../../lib/wakeMic";
import { resetAllLayouts } from "./Floating";
import {
  requestDesktopOverlay,
  sendDesktopControlAction,
  setDesktopInjectArmed,
} from "../../lib/hands/desktopBridge";

export default function Settings() {
  const health = useStore((s) => s.health);
  const voiceEnabled = useStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useStore((s) => s.setVoiceEnabled);
  const wakeEnabled = useStore((s) => s.wakeEnabled);
  const micEnabled = useStore((s) => s.micEnabled);
  const bargeIn = useStore((s) => s.bargeIn);
  const setBargeIn = useStore((s) => s.setBargeIn);
  const clearChat = useStore((s) => s.clearChat);
  const clearMedia = useStore((s) => s.clearMedia);
  const clearTools = useStore((s) => s.clearTools);
  const setReader = useStore((s) => s.setReader);
  const prevSessionAvailable = useStore((s) => s.prevSessionAvailable);
  const restoreLastSession = useStore((s) => s.restoreLastSession);

  const gestureEnabled = useStore((s) => s.gestureEnabled);
  const setGestureEnabled = useStore((s) => s.setGestureEnabled);
  const desktopEnabled = useStore((s) => s.desktopControlEnabled);
  const setDesktopEnabled = useStore((s) => s.setDesktopControlEnabled);
  const mode = useStore((s) => s.desktopControlMode);
  const setMode = useStore((s) => s.setDesktopControlMode);
  const setOverlay = useStore((s) => s.setDesktopOverlayEnabled);
  const setPaused = useStore((s) => s.setDesktopPaused);
  const voicePreset: "off" | "speak" | "wake" | "full" =
    !voiceEnabled && !(wakeEnabled && micEnabled)
      ? "off"
      : voiceEnabled && wakeEnabled && micEnabled
        ? "full"
        : wakeEnabled && micEnabled
          ? "wake"
          : "speak";

  const handsPreset: "off" | "hud" | "precision" =
    !gestureEnabled && !desktopEnabled
      ? "off"
      : mode === "precision" && desktopEnabled
        ? "precision"
        : "hud";

  const setVoicePreset = async (preset: "off" | "speak" | "wake" | "full") => {
    if (preset === "off") {
      setVoiceEnabled(false);
      stopWakeListening();
      return;
    }
    if (preset === "speak") {
      setVoiceEnabled(true);
      stopWakeListening();
      return;
    }
    if (preset === "wake") {
      setVoiceEnabled(false);
      await startWakeListening();
      return;
    }
    setVoiceEnabled(true);
    await startWakeListening();
  };

  const setHandsPreset = async (preset: "off" | "hud" | "precision") => {
    if (preset === "off") {
      setGestureEnabled(false);
      setDesktopEnabled(false);
      setOverlay(false);
      setPaused(true);
      setDesktopInjectArmed(false);
      void sendDesktopControlAction("pause", { paused: true });
      return;
    }
    setGestureEnabled(true);
    setDesktopEnabled(true);
    setPaused(false);
    setMode(preset === "precision" ? "precision" : "hud");
    if (preset === "precision") {
      setOverlay(true);
      setDesktopInjectArmed(true);
      void requestDesktopOverlay(true);
    } else {
      setOverlay(false);
      setDesktopInjectArmed(false);
    }
    void sendDesktopControlAction("mode", { mode: preset === "precision" ? "precision" : "hud" });
  };

  const cleanSlate = async () => {
    if (!confirm("Wipe chat, media, and tool history?")) return;
    clearChat();
    clearMedia();
    clearTools();
    setReader(null);
    try {
      await apiFetch("/api/cleanslate", { method: "POST" });
    } catch {
      /* noop */
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-[15px] text-[var(--text-secondary)]">
        {health?.model?.model || "Local"} · {health?.model?.provider || "core"}
      </p>

      <Section title="Voice">
        <div className="grid grid-cols-2 gap-2">
          <Preset active={voicePreset === "off"} onClick={() => void setVoicePreset("off")}>Off</Preset>
          <Preset active={voicePreset === "speak"} onClick={() => void setVoicePreset("speak")}>Speak</Preset>
          <Preset active={voicePreset === "wake"} onClick={() => void setVoicePreset("wake")}>Wake</Preset>
          <Preset active={voicePreset === "full"} onClick={() => void setVoicePreset("full")}>Full</Preset>
        </div>
        <div className="mt-2">
          <Preset active={bargeIn} onClick={() => setBargeIn(!bargeIn)}>
            Barge-in {bargeIn ? "On" : "Off"}
          </Preset>
        </div>
      </Section>

      <Section title="Hands">
        <div className="grid grid-cols-3 gap-2">
          <Preset active={handsPreset === "off"} onClick={() => void setHandsPreset("off")}>Off</Preset>
          <Preset active={handsPreset === "hud"} onClick={() => void setHandsPreset("hud")}>HUD</Preset>
          <Preset active={handsPreset === "precision"} onClick={() => void setHandsPreset("precision")}>
            Precision
          </Preset>
        </div>
      </Section>

      <Section title="System">
        <div className="grid grid-cols-2 gap-2">
          {prevSessionAvailable && (
            <Preset onClick={() => restoreLastSession()}>Restore session</Preset>
          )}
          <Preset
            onClick={() => {
              if (confirm("Reset panel positions?")) resetAllLayouts();
            }}
          >
            Reset layouts
          </Preset>
          <Preset
            onClick={() => {
              if (confirm("Wipe chat?")) clearChat();
            }}
          >
            Clear chat
          </Preset>
          <Preset
            onClick={() => {
              if (confirm("Wipe media?")) clearMedia();
            }}
          >
            Clear media
          </Preset>
          <Preset
            onClick={() => {
              if (confirm("Wipe tools?")) clearTools();
            }}
          >
            Clear tools
          </Preset>
          <Preset danger onClick={cleanSlate}>
            Clean slate
          </Preset>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-[var(--text-primary)]">{title}</h3>
      {children}
    </section>
  );
}

function Preset({
  children,
  active,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full rounded-lg border px-3 py-2.5 text-[15px] font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
        danger ? "!border-destructive/50 !text-destructive hover:!bg-destructive/10" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
