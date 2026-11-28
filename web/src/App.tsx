import { lazy, Suspense, useEffect, useRef } from "react";
import BootSequence from "./components/Boot/BootSequence";
import DropZone from "./components/Chat/DropZone";
import BarehandsOverlay from "./components/HUD/BarehandsOverlay";
import CanvasTiles from "./components/HUD/CanvasTiles";
import GestureOverlay from "./components/HUD/GestureOverlay";
import CommandPalette from "./components/HUD/CommandPalette";
import IconDock from "./components/HUD/IconDock";
import Reticle from "./components/HUD/Reticle";
import ConfirmModal from "./components/Tools/ConfirmModal";
import FullChatStage from "./components/Chat/FullChatStage";
import Orb from "./components/Orb/Orb";
import { getHealth } from "./lib/api";
import { useStore, nextId } from "./lib/store";
import { refreshVoiceProfile, streamSpeak } from "./lib/voice";
import { startWakeListening } from "./lib/wakeMic";
import { wsClient } from "./lib/ws";

const Lightbox = lazy(() => import("./components/Media/Lightbox"));
const ArticleReader = lazy(() => import("./components/Media/ArticleReader"));

const GREETING_SESSION_KEY = "jarvis.greeting.sent.v1";

export default function App() {
  const setHealth = useStore((s) => s.setHealth);
  const media = useStore((s) => s.media);
  const hiddenRef = useRef(false);
  const lastMediaLenRef = useRef(0);
  const undockPanel = useStore((s) => s.undockPanel);
  const setOrb = useStore((s) => s.setOrb);

  useEffect(() => {
    wsClient.connect();
    refreshVoiceProfile();
    getHealth().then(setHealth).catch(() => undefined);
    const id = setInterval(() => {
      getHealth().then(setHealth).catch(() => undefined);
    }, 15_000);
    return () => clearInterval(id);
  }, [setHealth]);

  useEffect(() => {
    return useStore.subscribe((state) => {
      const current = state.orbState;
      if (current === "listening" || current === "thinking" || current === "speaking") return;
      const running = state.tools.some((t) => t.status === "running");
      const err = !state.connected || state.health?.status === "error";
      if (err && current !== "error") setOrb("error");
      else if (!err && running && current !== "executing") setOrb("executing");
      else if (!err && !running && (current === "executing" || current === "error")) setOrb("idle");
    });
  }, [setOrb]);

  useEffect(() => {
    const cycleMode = () => {
      const st = useStore.getState();
      const next = st.desktopControlMode === "hud" ? "precision" : "hud";
      st.setDesktopControlMode(next);
      wsClient.send({ type: "desktop_control", action: "mode", mode: next });
      window.jarvis?.send?.("jarvis:desktop-overlay-meta", { mode: next });
    };
    const onOverlayAction = (payload: any) => {
      const action = payload?.action;
      const st = useStore.getState();
      if (action === "toggle-pause") {
        const paused = typeof payload?.paused === "boolean" ? payload.paused : !st.desktopPaused;
        st.setDesktopPaused(paused);
        wsClient.send({ type: "desktop_control", action: "pause", paused });
      } else if (action === "cycle-mode") {
        cycleMode();
      }
    };
    const onEmergency = () => {
      useStore.getState().setDesktopPaused(true);
      wsClient.send({ type: "desktop_control", action: "emergency_stop" });
      wsClient.killSwitch();
    };
    const onJarvisAction = (ev: Event) => {
      const action = (ev as CustomEvent).detail?.action as string | undefined;
      if (action === "open_jarvis") window.jarvis?.send?.("jarvis:show");
      else if (action === "open_settings") undockPanel("settings");
      else if (action === "open_tools" || action === "open_workspace") undockPanel("chat");
      else if (action === "activate_voice") void startWakeListening();
      else if (action === "open_command_palette") {
        window.dispatchEvent(new CustomEvent("jarvis:open-command-palette"));
      }
    };
    const offAction = window.jarvis?.on?.("jarvis:desktop-overlay-action", onOverlayAction);
    const offStop = window.jarvis?.on?.("jarvis:desktop-emergency-stop", onEmergency);
    window.addEventListener("jarvis:desktop-action", onJarvisAction);
    return () => {
      offAction?.();
      offStop?.();
      window.removeEventListener("jarvis:desktop-action", onJarvisAction);
    };
  }, [undockPanel]);

  useEffect(() => {
    let cancelled = false;
    const tryResume = async () => {
      if (cancelled) return;
      const { wakeEnabled, micEnabled } = useStore.getState();
      if (wakeEnabled && !micEnabled) {
        try {
          await startWakeListening();
        } catch (e) {
          console.warn("[wake] auto-resume failed:", e);
        }
      }
    };
    const persistApi = (useStore as typeof useStore & {
      persist?: {
        hasHydrated?: () => boolean;
        onFinishHydration?: (cb: () => void) => () => void;
      };
    }).persist;
    if (persistApi?.hasHydrated?.()) {
      void tryResume();
      return () => {
        cancelled = true;
      };
    }
    const unsub = persistApi?.onFinishHydration?.(() => {
      void tryResume();
    });
    if (!unsub) {
      const t = setTimeout(() => {
        void tryResume();
      }, 200);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    const j = (window as any).jarvis;
    if (!j) return;
    const offVis = j.on("jarvis:visibility-changed", (visible: boolean) => {
      hiddenRef.current = !visible;
    });
    return () => {
      offVis?.();
    };
  }, []);

  useEffect(() => {
    const prev = lastMediaLenRef.current;
    const total = media.reduce((n, m) => n + (m.items?.length || 0), 0);
    if (total > prev && hiddenRef.current) {
      (window as any).jarvis?.send?.("jarvis:show");
    }
    if (total > prev && useStore.getState().backgroundMode !== "chat") {
      undockPanel("chat");
    }
    lastMediaLenRef.current = total;
  }, [media, undockPanel]);

  useEffect(() => {
    let lastLen = 0;
    let lastId = "";
    return useStore.subscribe((state) => {
      const last = state.chat[state.chat.length - 1];
      if (!last || last.role !== "assistant") return;
      if (last.text.trimStart().startsWith("[brain error]")) return;
      if (last.id !== lastId) {
        lastId = last.id;
        lastLen = 0;
      }
      const grew = last.text.length !== lastLen;
      lastLen = last.text.length;
      if (grew || !last.streaming) {
        streamSpeak(last.id, last.text, !last.streaming);
      }
    });
  }, []);

  const pushChat = useStore((s) => s.pushChat);
  const booted = useStore((s) => s.booted);
  const backgroundMode = useStore((s) => s.backgroundMode);
  const chatStage = backgroundMode === "chat";
  const greetedRef = useRef(false);
  useEffect(() => {
    if (!booted || greetedRef.current) return;
    greetedRef.current = true;
    const h = new Date().getHours();
    const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
    const text = `Good ${part}, sir. All systems are online and at your service.`;
    try {
      if (sessionStorage.getItem(GREETING_SESSION_KEY) === "1") return;
      sessionStorage.setItem(GREETING_SESSION_KEY, "1");
    } catch {
      /* noop */
    }
    const t = setTimeout(() => {
      pushChat({ id: nextId(), role: "assistant", text, ts: Date.now() });
      if (useStore.getState().backgroundMode !== "chat") undockPanel("chat");
    }, 600);
    return () => clearTimeout(t);
  }, [booted, pushChat, undockPanel]);

  return (
    <div className="relative w-screen h-screen overflow-hidden cc-root bg-background">
      {!chatStage && <Orb variant="fullscreen" />}
      {chatStage && <FullChatStage />}

      <IconDock />
      <CanvasTiles />

      <Reticle />
      <Suspense fallback={null}>
        <Lightbox />
        <ArticleReader />
      </Suspense>
      <ConfirmModal />
      <CommandPalette />
      <DropZone />
      <BootSequence />
      <BarehandsOverlay />
      <GestureOverlay />
    </div>
  );
}
