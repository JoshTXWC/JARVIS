import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Atmosphere from "./components/HUD/Atmosphere";
import BootSequence from "./components/Boot/BootSequence";
import ChatPanel from "./components/Chat/ChatPanel";
import CommandBar from "./components/Chat/CommandBar";
import DropZone from "./components/Chat/DropZone";
import TerminalPanel from "./components/HUD/TerminalPanel";
import CornerFrame from "./components/HUD/CornerFrame";
import DiagPanel from "./components/HUD/DiagPanel";
import Floating, { resetAllLayouts } from "./components/HUD/Floating";
import MissionLog from "./components/HUD/MissionLog";
import PlanPanel from "./components/HUD/PlanPanel";
import Reticle from "./components/HUD/Reticle";
import Settings from "./components/HUD/Settings";
import SwarmPanel from "./components/HUD/SwarmPanel";
import TopBar from "./components/HUD/TopBar";
import BarehandsOverlay from "./components/HUD/BarehandsOverlay";
import UptimePanel from "./components/HUD/UptimePanel";
import MediaHub from "./components/Media/MediaHub";
import Orb from "./components/Orb/Orb";
import ConfirmModal from "./components/Tools/ConfirmModal";
import ToolFeed from "./components/Tools/ToolFeed";

// Heavy components: split into separate chunks so they only load when needed.
// Saves ~30% of the initial JS payload (notably Three.js + react-three-fiber
// pull in via NeuralGalaxy/Model3DViewer, and the editor-grade prose CSS via
// ArticleReader).
const Lightbox      = lazy(() => import("./components/Media/Lightbox"));
const ArticleReader = lazy(() => import("./components/Media/ArticleReader"));
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
  const colL = 320;
  const colR = 380;
  const halfH = (H - TOP - BOTTOM - 8) / 2;
  return {
    diag:      { x: M, y: TOP, w: colL, h: 420 },
    terminal:  { x: M, y: TOP + 428, w: colL, h: Math.max(180, H - TOP - 428 - BOTTOM) },
    uptime:    { x: M + colL + 12, y: TOP, w: 220, h: 136 },
    chat:      { x: W - colR - M, y: TOP, w: colR, h: halfH * 2 - 200 },
    mission:   { x: W - colR - M, y: H - BOTTOM - 200 - 8 - 110, w: colR, h: 110 },
    toolFeed:  { x: W - colR - M, y: H - BOTTOM - 200, w: colR, h: 200 },

    // Media hubs — each kind in its own panel. Initial positions cascade
    // diagonally so they don't all stack at one spot; user can drag.
    swarm:       { x: 340,  y: 80,  w: 360, h: 320 },
    plan:        { x: 340,  y: 80,  w: 360, h: 300 },
    settings:    { x: 380,  y: 100, w: 440, h: 580 },
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

    cmd:       { x: (W - 860) / 2, y: H - BOTTOM - 118, w: 860, h: 96 },
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
  const visible = (id: string) => !dockedPanels.includes(id);

  // Helper: which hubs have at least 1 item?
  const has = (kinds: MediaKind[]) => media.some((m) => kinds.includes(m.kind));

  if (viewport.w < 900) {
    return (
      <div className="relative w-screen h-screen overflow-hidden">
        <Atmosphere />
        <Orb />
        <CornerFrame />
        <TopBar />

        <div className="fixed left-2 right-2 top-[74px] z-20 grid h-[136px] grid-cols-[minmax(0,1fr)_minmax(168px,190px)] gap-3 pointer-events-auto">
          <div className="min-w-0 overflow-hidden">
            <DiagPanel />
          </div>
          <UptimePanel />
        </div>

        <div className="fixed left-4 right-4 top-[224px] bottom-[136px] z-20 min-h-[260px] pointer-events-auto">
          <ChatPanel />
        </div>

        <div className="fixed left-4 right-4 bottom-16 z-30 h-[72px] pointer-events-auto">
          <CommandBar />
        </div>

        <Reticle />
        <Suspense fallback={null}>
          <Lightbox />
          <ArticleReader />
        </Suspense>
        <ConfirmModal />
        <DropZone />
        <BootSequence />
        <BarehandsOverlay />
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <Atmosphere />
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

      {/* Floating, movable + resizable panels */}
      {visible("diag") && (
        <Floating id="diag" defaultBox={D.diag} minW={260} minH={160}><DiagPanel /></Floating>
      )}
      {visible("uptime") && (
        <Floating id="uptime" defaultBox={D.uptime} minW={180} minH={118}><UptimePanel /></Floating>
      )}
      {visible("terminal") && (
        <Floating id="terminal" defaultBox={D.terminal} minW={260} minH={180}><TerminalPanel /></Floating>
      )}

      {visible("chat") && (
        <Floating id="chat" defaultBox={D.chat} minW={300} minH={260}><ChatPanel /></Floating>
      )}
      {visible("mission") && (
        <Floating id="mission" defaultBox={D.mission} minW={280} minH={90}><MissionLog /></Floating>
      )}
      {visible("toolFeed") && (
        <Floating id="toolFeed" defaultBox={D.toolFeed} minW={280} minH={140}><ToolFeed /></Floating>
      )}
      {hasSwarms && visible("swarm") && (
        <Floating id="swarm" defaultBox={D.swarm} minW={300} minH={200} z={23}>
          <SwarmPanel />
        </Floating>
      )}
      {hasPlan && visible("plan") && (
        <Floating id="plan" defaultBox={D.plan} minW={300} minH={180} z={24}>
          <PlanPanel />
        </Floating>
      )}
      {visible("settings") && (
        <Floating id="settings" defaultBox={D.settings} minW={340} minH={300} z={28}>
          <Settings />
        </Floating>
      )}
      {/* Pinned reader — when readerPinned=true the ArticleReader component
          renders only the inner article surface, so we wrap it in a
          Floating panel here. Modal mode (unpinned) is mounted directly
          below as fullscreen overlay. */}
      <PinnedReader defaultBox={D.reader} />

      {/* ── Per-kind media hubs. Each only renders when has items. ── */}
      {has(["image"]) && visible("hub.images") && (
        <Floating id="hub.images" defaultBox={D.images} minW={360} minH={260} z={22}>
          <MediaHub kinds={["image"]} title="IMAGE GEN" accent="#a5f3fc" />
        </Floating>
      )}
      {has(["video", "videos"]) && visible("hub.videos") && (
        <Floating id="hub.videos" defaultBox={D.videos} minW={360} minH={280} z={22}>
          <MediaHub kinds={["video", "videos"]} title="VIDEOS" accent="#fbbf24" />
        </Floating>
      )}
      {has(["search"]) && visible("hub.websearch") && (
        <Floating id="hub.websearch" defaultBox={D.websearch} minW={340} minH={260} z={22}>
          <MediaHub kinds={["search"]} title="WEB SEARCH" accent="#7dd3fc" />
        </Floating>
      )}
      {has(["news"]) && visible("hub.news") && (
        <Floating id="hub.news" defaultBox={D.news} minW={340} minH={260} z={22}>
          <MediaHub kinds={["news"]} title="NEWS" accent="#fca5a5" />
        </Floating>
      )}
      {has(["images"]) && visible("hub.imagesearch") && (
        <Floating id="hub.imagesearch" defaultBox={D.imagesearch} minW={360} minH={280} z={22}>
          <MediaHub kinds={["images"]} title="IMAGE SEARCH" accent="#7dd3fc" />
        </Floating>
      )}
      {has(["page", "pdf"]) && visible("hub.pages") && (
        <Floating id="hub.pages" defaultBox={D.pages} minW={400} minH={320} z={22}>
          <MediaHub kinds={["page", "pdf"]} title="PAGES" accent="#bae6fd" />
        </Floating>
      )}
      {has(["webcam"]) && visible("hub.webcam") && (
        <Floating id="hub.webcam" defaultBox={D.webcam} minW={340} minH={260} z={22}>
          <MediaHub kinds={["webcam"]} title="CAMERA" accent="#fb7185" />
        </Floating>
      )}
      {has(["galaxy"]) && visible("hub.memory") && (
        <Floating id="hub.memory" defaultBox={D.memory} minW={380} minH={320} z={22}>
          <MediaHub kinds={["galaxy"]} title="MEMORY" accent="#a78bfa" />
        </Floating>
      )}
      {has(["model3d"]) && visible("hub.model3d") && (
        <Floating id="hub.model3d" defaultBox={D.model3d} minW={360} minH={320} z={22}>
          <MediaHub kinds={["model3d"]} title="3D MODELS" accent="#bae6fd" />
        </Floating>
      )}

      {/* Command bar — always present; not removable */}
      <Floating id="cmd" defaultBox={D.cmd} minW={520} minH={88} autoHeight removable={false} overflowVisible>
        <CommandBar />
      </Floating>

      <Reticle />
      <Suspense fallback={null}>
        <Lightbox />
        <ArticleReader />
      </Suspense>
      <ConfirmModal />
      <DropZone />
      <BootSequence />
      <BarehandsOverlay />
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
