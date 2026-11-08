import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Atmosphere from "./components/HUD/Atmosphere";
import BootSequence from "./components/Boot/BootSequence";
import ChatPanel from "./components/Chat/ChatPanel";
import CommandBar from "./components/Chat/CommandBar";
import DropZone from "./components/Chat/DropZone";
import CornerFrame from "./components/HUD/CornerFrame";
import DiagPanel from "./components/HUD/DiagPanel";
import Floating, { resetAllLayouts } from "./components/HUD/Floating";
import PlanPanel from "./components/HUD/PlanPanel";
import Reticle from "./components/HUD/Reticle";
import Settings from "./components/HUD/Settings";
import SwarmPanel from "./components/HUD/SwarmPanel";
import TopBar from "./components/HUD/TopBar";
import BarehandsOverlay from "./components/HUD/BarehandsOverlay";
import GestureOverlay from "./components/HUD/GestureOverlay";
import SystemLog from "./components/HUD/SystemLog";
import TaskManager from "./components/HUD/TaskManager";
import UptimePanel from "./components/HUD/UptimePanel";
import WorkspacePanel from "./components/HUD/WorkspacePanel";
import MediaHub from "./components/Media/MediaHub";
import Orb from "./components/Orb/Orb";
import ConfirmModal from "./components/Tools/ConfirmModal";
import ToolFeed from "./components/Tools/ToolFeed";
import ToolsPanel from "./components/Tools/ToolsPanel";
import CommandPalette from "./components/HUD/CommandPalette";

// Heavy components: split into separate chunks so they only load when needed.
// Saves ~30% of the initial JS payload (notably Three.js + react-three-fiber
// pull in via NeuralGalaxy/Model3DViewer, and the editor-grade prose CSS via
// ArticleReader).
const Lightbox      = lazy(() => import("./components/Media/Lightbox"));
const ArticleReader = lazy(() => import("./components/Media/ArticleReader"));
const NeuralCloudBackground = lazy(() => import("./components/Media/NeuralCloudBackground"));
import { getHealth } from "./lib/api";
import { useStore, nextId, type MediaKind } from "./lib/store";
import { refreshVoiceProfile, streamSpeak } from "./lib/voice";
import { startWakeListening } from "./lib/wakeMic";
import { wsClient } from "./lib/ws";

const GREETING_SESSION_KEY = "jarvis.greeting.sent.v1";

/**
 * Default panel positions. Recomputed at first load for current viewport.
 * Stored sizes/positions persist in localStorage thereafter.
 */
function defaults() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const M = 8;
  const TOP = 66;
  const BOTTOM = 46;
  const dialogueW = Math.min(720, Math.max(420, Math.floor(W * 0.42)));
  const dialogueH = Math.min(H - TOP - BOTTOM - 24, Math.floor(H * 0.72));
  return {
    // Fused chat + command bar — the only panel open by default.
    dialogue:  {
      x: W - dialogueW - M,
      y: TOP + 8,
      w: dialogueW,
      h: dialogueH,
    },
    diag:      { x: M, y: TOP, w: 196, h: 360 },
    terminal:  { x: M, y: TOP + 380, w: 320, h: Math.max(180, H - TOP - 380 - BOTTOM) },
    uptime:    { x: M + 212, y: TOP, w: 200, h: 136 },
    mission:   { x: M, y: H - BOTTOM - 120, w: 320, h: 110 },
    toolFeed:  { x: M, y: H - BOTTOM - 220, w: 320, h: 200 },

    swarm:       { x: 340,  y: 80,  w: 360, h: 320 },
    plan:        { x: 340,  y: 80,  w: 360, h: 300 },
    settings:    { x: Math.max(M, (W - 420) / 2), y: TOP + 40, w: 420, h: Math.min(640, H - TOP - BOTTOM - 48) },
    tools:       { x: M + 8, y: TOP + 40, w: 420, h: Math.min(560, H - TOP - BOTTOM - 48) },
    tasks:       { x: M + 40, y: TOP + 80, w: 360, h: 420 },
    workspace:   { x: Math.max(M, (W - 440) / 2), y: TOP + 60, w: 440, h: 480 },
    reader:      { x: 480,  y: 140, w: 720, h: 640 },
    images:      { x: 380,  y: 120, w: 640, h: 480 },
    videos:      { x: 420,  y: 160, w: 680, h: 460 },
    websearch:   { x: 460,  y: 200, w: 560, h: 480 },
    imagesearch: { x: 500,  y: 240, w: 600, h: 500 },
    news:        { x: 540,  y: 280, w: 580, h: 520 },
    pages:       { x: 580,  y: 320, w: 720, h: 520 },
    webcam:      { x: 620,  y: 360, w: 520, h: 420 },
    memory:      { x: 660,  y: 400, w: 600, h: 520 },
    model3d:     { x: 700,  y: 200, w: 560, h: 520 },
  };
}

function useViewport() {
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1200,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  }));

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    const onResize = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(update);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return viewport;
}

export default function App() {
  const setHealth = useStore((s) => s.setHealth);
  const media = useStore((s) => s.media);
  const viewport = useViewport();
  const hiddenRef = useRef(false);
  const lastMediaLenRef = useRef(0);

  useEffect(() => {
    wsClient.connect();
    refreshVoiceProfile();
    getHealth().then(setHealth).catch(() => undefined);
    const id = setInterval(() => {
      getHealth().then(setHealth).catch(() => undefined);
    }, 15_000);
    return () => clearInterval(id);
  }, [setHealth]);

  // Barehands 2.0 — overlay chip + global shortcuts (Electron IPC).
  useEffect(() => {
    const cycleMode = () => {
      const st = useStore.getState();
      const order = ["hud", "precision", "spatial"] as const;
      const i = order.indexOf(st.desktopControlMode);
      const next = order[(i + 1) % order.length];
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
      const st = useStore.getState();
      if (action === "open_jarvis") window.jarvis?.send?.("jarvis:show");
      else if (action === "open_settings") st.undockPanel("settings");
      else if (action === "open_tools") st.undockPanel("tools");
      else if (action === "open_diagnostics") st.undockPanel("diag");
      else if (action === "open_workspace") st.undockPanel("workspace");
      else if (action === "activate_voice") {
        void startWakeListening();
      } else if (action === "open_command_palette") {
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
  }, []);

  // Resume wake listening after reload if the user left it enabled.
  // Settings used to flip the flag without starting the mic — this heals that.
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
      return () => { cancelled = true; };
    }
    const unsub = persistApi?.onFinishHydration?.(() => { void tryResume(); });
    // Fallback if persist API is unavailable.
    if (!unsub) {
      const t = setTimeout(() => { void tryResume(); }, 200);
      return () => { cancelled = true; clearTimeout(t); };
    }
    return () => { cancelled = true; unsub(); };
  }, []);

  // ── Electron integration: track window visibility ───────────────────────
  useEffect(() => {
    const j = (window as any).jarvis;
    if (!j) return; // running in a plain browser — skip

    const offVis = j.on("jarvis:visibility-changed", (visible: boolean) => {
      hiddenRef.current = !visible;
    });
    return () => { offVis?.(); };
  }, []);

  // ── Show window when new media arrives while hidden ─────────────────────
  useEffect(() => {
    const prev = lastMediaLenRef.current;
    const total = media.reduce((n, m) => n + (m.items?.length || 0), 0);
    if (total > prev && hiddenRef.current) {
      const j = (window as any).jarvis;
      if (j) j.send("jarvis:show");
    }
    lastMediaLenRef.current = total;
  }, [media]);

  useEffect(() => {
    let lastLen = 0;
    let lastId = "";
    return useStore.subscribe((state) => {
      const last = state.chat[state.chat.length - 1];
      if (!last || last.role !== "assistant") return;
      // Never speak transport / brain errors (they belong in TERM only).
      if (last.text.trimStart().startsWith("[brain error]")) return;
      if (last.id !== lastId) {
        lastId = last.id;
        lastLen = 0;
      }
      const grew = last.text.length !== lastLen;
      lastLen = last.text.length;
      if (grew || !last.streaming) {
        console.log("[App:TTS] streamSpeak id=%s len=%d grew=%s isFinal=%s streaming=%s", last.id, last.text.length, grew, !last.streaming, last.streaming);
        streamSpeak(last.id, last.text, !last.streaming);
      }
    });
  }, []);

  // ── One-shot, time-aware greeting once the boot sequence clears.
  // Pushed as an assistant chat entry so the TTS subscribe above speaks it
  // automatically (honours the voice-enabled toggle; no double-speak).
  const pushChat = useStore((s) => s.pushChat);
  const booted = useStore((s) => s.booted);
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
    } catch { /* noop */ }
    // Small beat so it lands after the boot overlay finishes fading out.
    const t = setTimeout(() => {
      pushChat({ id: nextId(), role: "assistant", text, ts: Date.now() });
    }, 600);
    return () => clearTimeout(t);
  }, [booted, pushChat]);

  const D = defaults();
  const swarms = useStore((s) => s.swarms);
  const hasSwarms = swarms.length > 0;
  const hasPlan = useStore((s) => s.plan != null);
  const layoutEdit = useStore((s) => s.layoutEdit);
  const setLayoutEdit = useStore((s) => s.setLayoutEdit);
  const dockedPanels = useStore((s) => s.dockedPanels);
  const clearDockedPanels = useStore((s) => s.clearDockedPanels);
  const backgroundMode = useStore((s) => s.backgroundMode);
  const barehandsOpen = useStore((s) => s.barehandsOpen);
  const barehandsEmbed = useStore((s) => s.barehandsEmbed);
  const gestureEnabled = useStore((s) => s.gestureEnabled);
  const visible = (id: string) => !dockedPanels.includes(id);
  // Neural can run together with Hands (finger cursor drives the cloud).
  const showNeuralBg =
    backgroundMode === "neural" && !(barehandsOpen && !barehandsEmbed);

  // Helper: which hubs have at least 1 item?
  const has = (kinds: MediaKind[]) => media.some((m) => kinds.includes(m.kind));

  if (viewport.w < 900) {
    return (
      <div className="relative w-screen h-screen overflow-hidden">
        {!gestureEnabled && !showNeuralBg && <Atmosphere />}
        {showNeuralBg && (
          <Suspense fallback={null}>
            <NeuralCloudBackground />
          </Suspense>
        )}
        <Orb />
        <CornerFrame />
        <TopBar />

        <div className="fixed left-3 right-3 top-[74px] bottom-4 z-20 pointer-events-auto flex flex-col min-h-0 rounded-xl overflow-hidden"
          style={{ boxShadow: "0 0 0 1px rgba(125,211,252,0.18), 0 24px 60px -20px rgba(0,0,0,0.65)" }}
        >
          <div className="flex-1 min-h-0 holo-panel rounded-none border-0">
            <ChatPanel embedded />
          </div>
          <div className="shrink-0 border-t border-jarvis-cyan/15 holo-panel rounded-none border-0">
            <CommandBar embedded />
          </div>
        </div>

        {visible("settings") && (
          <div className="fixed inset-3 top-[74px] z-40 pointer-events-auto">
            <Settings />
          </div>
        )}

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

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      {!gestureEnabled && !showNeuralBg && <Atmosphere />}
      {showNeuralBg && (
        <Suspense fallback={null}>
          <NeuralCloudBackground />
        </Suspense>
      )}
      <Orb />

      {/* Fixed HUD chrome — not draggable */}
      <CornerFrame />
      <TopBar />

      {/* Layout / chrome controls */}
      <div className="fixed bottom-2 right-2 z-50 flex items-center gap-2 pointer-events-auto">
        <button
          onClick={() => setLayoutEdit(!layoutEdit)}
          title={layoutEdit ? "Done editing layout" : "Edit layout"}
          className={`glass-chip transition-colors ${
            layoutEdit
              ? "bg-jarvis-cyan/20 text-jarvis-ice"
              : "hover:bg-jarvis-cyan/10 hover:text-jarvis-ice"
          }`}
        >
          Edit Layout
        </button>
      </div>

      {layoutEdit && (
        <div className="fixed bottom-[5.25rem] right-2 z-50 flex items-center gap-2 pointer-events-auto">
          <button
            onClick={() => {
              if (!confirm("Reset all panel positions and sizes?")) return;
              resetAllLayouts();
            }}
            title="Reset layout"
            className="glass-chip hover:bg-jarvis-warn/15 hover:text-jarvis-warn transition-colors"
          >
            ⟲ reset layout
          </button>
          <button
            onClick={() => {
              if (!confirm("Open all docked panels onto the canvas?")) return;
              clearDockedPanels();
            }}
            className="glass-chip hover:bg-jarvis-cyan/10 hover:text-jarvis-ice transition-colors"
          >
            open all
          </button>
          <button
            onClick={() => setLayoutEdit(false)}
            className="glass-chip hover:bg-jarvis-cyan/10 hover:text-jarvis-ice transition-colors"
          >
            done
          </button>
        </div>
      )}

      {/* Dialogue = chat + command bar fused. Always on canvas. */}
      <Floating id="dialogue" defaultBox={D.dialogue} minW={380} minH={420} z={26} overflowVisible>
        <div className="holo-panel flex flex-col h-full overflow-visible">
          <div className="flex-1 min-h-0 overflow-hidden">
            <ChatPanel embedded />
          </div>
          <div className="shrink-0 border-t border-jarvis-cyan/15 overflow-visible">
            <CommandBar embedded />
          </div>
        </div>
      </Floating>

      {/* Optional tiles — start docked; open from the top icon dock */}
      {visible("diag") && (
        <Floating id="diag" defaultBox={D.diag} autoHeight fixedWidth={196} noResize>
          <DiagPanel />
        </Floating>
      )}
      {visible("uptime") && (
        <Floating id="uptime" defaultBox={D.uptime} autoHeight fixedWidth={200} noResize>
          <UptimePanel />
        </Floating>
      )}
      {visible("toolFeed") && (
        <Floating id="toolFeed" defaultBox={D.toolFeed} minW={280} minH={140}><ToolFeed /></Floating>
      )}
      {visible("terminal") && (
        <Floating id="terminal" defaultBox={D.terminal} minW={300} minH={180} z={25}>
          <SystemLog />
        </Floating>
      )}
      {hasSwarms && (
        <Floating id="swarm" defaultBox={D.swarm} minW={300} minH={200} z={23}>
          <SwarmPanel />
        </Floating>
      )}
      {hasPlan && (
        <Floating id="plan" defaultBox={D.plan} minW={300} minH={180} z={24}>
          <PlanPanel />
        </Floating>
      )}
      {visible("settings") && (
        <Floating id="settings" defaultBox={D.settings} minW={360} minH={420} z={28}>
          <Settings />
        </Floating>
      )}
      {visible("tools") && (
        <Floating id="tools" defaultBox={D.tools} minW={340} minH={380} z={27}>
          <ToolsPanel />
        </Floating>
      )}
      {visible("tasks") && (
        <Floating id="tasks" defaultBox={D.tasks} minW={300} minH={320} z={27}>
          <TaskManager />
        </Floating>
      )}
      {visible("workspace") && (
        <Floating id="workspace" defaultBox={D.workspace} minW={360} minH={360} z={27}>
          <WorkspacePanel />
        </Floating>
      )}
      <PinnedReader defaultBox={D.reader} />

      {/* Media hubs — appear only when they have content */}
      {has(["image"]) && (
        <Floating id="hub.images" defaultBox={D.images} minW={360} minH={260} z={22}>
          <MediaHub kinds={["image"]} title="IMAGE GEN" accent="#a5f3fc" />
        </Floating>
      )}
      {has(["video", "videos"]) && (
        <Floating id="hub.videos" defaultBox={D.videos} minW={360} minH={280} z={22}>
          <MediaHub kinds={["video", "videos"]} title="VIDEOS" accent="#fbbf24" />
        </Floating>
      )}
      {has(["search"]) && (
        <Floating id="hub.websearch" defaultBox={D.websearch} minW={340} minH={260} z={22}>
          <MediaHub kinds={["search"]} title="WEB SEARCH" accent="#7dd3fc" />
        </Floating>
      )}
      {has(["news"]) && (
        <Floating id="hub.news" defaultBox={D.news} minW={340} minH={260} z={22}>
          <MediaHub kinds={["news"]} title="NEWS" accent="#fca5a5" />
        </Floating>
      )}
      {has(["images"]) && (
        <Floating id="hub.imagesearch" defaultBox={D.imagesearch} minW={360} minH={280} z={22}>
          <MediaHub kinds={["images"]} title="IMAGE SEARCH" accent="#7dd3fc" />
        </Floating>
      )}
      {has(["page", "pdf"]) && (
        <Floating id="hub.pages" defaultBox={D.pages} minW={400} minH={320} z={22}>
          <MediaHub kinds={["page", "pdf"]} title="PAGES" accent="#bae6fd" />
        </Floating>
      )}
      {has(["webcam"]) && (
        <Floating id="hub.webcam" defaultBox={D.webcam} minW={340} minH={260} z={22}>
          <MediaHub kinds={["webcam"]} title="CAMERA" accent="#fb7185" />
        </Floating>
      )}
      {has(["galaxy"]) && backgroundMode !== "neural" && (
        <Floating id="hub.memory" defaultBox={D.memory} minW={380} minH={320} z={22}>
          <MediaHub kinds={["galaxy"]} title="MEMORY" accent="#a78bfa" />
        </Floating>
      )}
      {has(["model3d"]) && (
        <Floating id="hub.model3d" defaultBox={D.model3d} minW={360} minH={320} z={22}>
          <MediaHub kinds={["model3d"]} title="3D MODELS" accent="#bae6fd" />
        </Floating>
      )}

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

/**
 * When the user pins the article reader, render it inside a Floating panel.
 * Otherwise the modal-mode ArticleReader handles its own portal.
 */
function PinnedReader({ defaultBox }: { defaultBox: { x: number; y: number; w: number; h: number } }) {
  const url = useStore((s) => s.reader);
  const pinned = useStore((s) => s.readerPinned);
  if (!url || !pinned) return null;
  return (
    <Floating id="reader.pinned" defaultBox={defaultBox} minW={420} minH={320} z={29}>
      <Suspense fallback={null}>
        <ArticleReader />
      </Suspense>
    </Floating>
  );
}
