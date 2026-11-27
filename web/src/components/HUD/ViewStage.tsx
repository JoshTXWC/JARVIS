import { lazy, Suspense } from "react";
import ChatPanel from "../Chat/ChatPanel";
import CommandBar from "../Chat/CommandBar";
import MediaHub from "../Media/MediaHub";
import ToolFeed from "../Tools/ToolFeed";
import ToolsPanel from "../Tools/ToolsPanel";
import DiagPanel from "./DiagPanel";
import PlanPanel from "./PlanPanel";
import Settings from "./Settings";
import SwarmPanel from "./SwarmPanel";
import SystemLog from "./SystemLog";
import TaskManager from "./TaskManager";
import UptimePanel from "./UptimePanel";
import WorkspacePanel from "./WorkspacePanel";
import { useStore, nextId, type MediaKind } from "../../lib/store";
import { wsClient } from "../../lib/ws";
import CommandCenter from "./CommandCenter";

const ArticleReader = lazy(() => import("../Media/ArticleReader"));

export default function ViewStage() {
  const activeView = useStore((s) => s.activeView);
  const media = useStore((s) => s.media);
  const hasSwarms = useStore((s) => s.swarms.length > 0);
  const hasPlan = useStore((s) => s.plan != null);
  const has = (kinds: MediaKind[]) => media.some((m) => kinds.includes(m.kind));

  if (activeView === "command" || activeView === "ai-core") {
    return <CommandCenter />;
  }

  if (activeView === "conversations") {
    return (
      <div className="h-full min-h-0 flex flex-col p-4 lg:p-6">
        <div className="cc-panel flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            <ChatPanel embedded />
          </div>
          <div className="shrink-0 border-t border-jarvis-border">
            <CommandBar embedded />
          </div>
        </div>
      </div>
    );
  }

  if (activeView === "settings") {
    return <Settings />;
  }
  if (activeView === "tools") {
    return <PanelFrame title="Tools"><ToolsPanel /></PanelFrame>;
  }
  if (activeView === "tasks") {
    return <PanelFrame title="Tasks"><TaskManager /></PanelFrame>;
  }
  if (activeView === "workspace") {
    return <PanelFrame title="Files"><WorkspacePanel /></PanelFrame>;
  }
  if (activeView === "diag") {
    return (
      <PanelFrame title="System">
        <div className="space-y-4">
          <DiagPanel />
          <UptimePanel />
        </div>
      </PanelFrame>
    );
  }
  if (activeView === "terminal" || activeView === "toolFeed") {
    return (
      <PanelFrame title="Activity">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full min-h-0">
          <SystemLog />
          <ToolFeed />
        </div>
      </PanelFrame>
    );
  }
  if (activeView === "agents") {
    return (
      <PanelFrame title="Agents">
        {hasSwarms ? (
          <SwarmPanel />
        ) : (
          <Empty
            title="Agents"
            body="No active swarm yet."
            cta="Open Chat"
            view="conversations"
          />
        )}
        {hasPlan && (
          <div className="mt-4">
            <PlanPanel />
          </div>
        )}
      </PanelFrame>
    );
  }
  if (activeView === "memory") {
    return (
      <PanelFrame title="Memory">
        {has(["galaxy"]) ? (
          <div className="h-full min-h-[420px]">
            <MediaHub kinds={["galaxy"]} title="MEMORY" accent="#A78BFA" />
          </div>
        ) : (
          <Empty
            title="Memory"
            body="Memory appears as JARVIS learns from sessions."
            cta="Ask JARVIS"
            view="conversations"
          />
        )}
      </PanelFrame>
    );
  }
  if (activeView === "calendar") {
    return (
      <PanelFrame title="Schedule">
        <Empty
          title="Schedule"
          body="Ask JARVIS to plan your day."
          cta="Plan my day"
          view="conversations"
          prompt="Help me plan my calendar for today. Suggest a focused schedule."
        />
      </PanelFrame>
    );
  }
  if (activeView === "knowledge") {
    return (
      <PanelFrame title="Knowledge">
        {has(["page", "pdf", "search", "news"]) ? (
          <div className="space-y-4">
            {has(["search"]) && <MediaHub kinds={["search"]} title="WEB SEARCH" accent="#79E6FF" />}
            {has(["news"]) && <MediaHub kinds={["news"]} title="NEWS" accent="#F87171" />}
            {has(["page", "pdf"]) && <MediaHub kinds={["page", "pdf"]} title="PAGES" accent="#EAF4FF" />}
          </div>
        ) : (
          <Empty
            title="Knowledge"
            body="Search results and pages collect here."
            cta="Search"
            view="conversations"
            prompt="Search the web for recent breakthroughs in AI assistants."
          />
        )}
        <Suspense fallback={null}>
          <ArticleReader />
        </Suspense>
      </PanelFrame>
    );
  }
  if (activeView === "workflows") {
    return (
      <PanelFrame title="Automations">
        <Empty
          title="Automations"
          body="Chain tools into repeatable workflows from chat."
          cta="Design one"
          view="conversations"
          prompt="Propose a useful automation workflow I can run from JARVIS."
        />
      </PanelFrame>
    );
  }
  if (activeView === "media") {
    return (
      <PanelFrame title="Media">
        <div className="space-y-4">
          {has(["image"]) && <MediaHub kinds={["image"]} title="IMAGE GEN" accent="#79E6FF" />}
          {has(["video", "videos"]) && <MediaHub kinds={["video", "videos"]} title="VIDEOS" accent="#FBBF24" />}
          {has(["images"]) && <MediaHub kinds={["images"]} title="IMAGE SEARCH" accent="#00C8FF" />}
          {has(["webcam"]) && <MediaHub kinds={["webcam"]} title="CAMERA" accent="#F87171" />}
          {has(["model3d"]) && <MediaHub kinds={["model3d"]} title="3D MODELS" accent="#EAF4FF" />}
          {!media.length && (
            <Empty title="Media" body="Generated media will appear here." cta="Create" view="conversations" />
          )}
        </div>
      </PanelFrame>
    );
  }

  return <CommandCenter />;
}

function PanelFrame({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto p-5 lg:p-6">
      {title && (
        <h2 className="font-display text-xl tracking-[0.1em] text-jarvis-text mb-4">{title}</h2>
      )}
      <div className="min-h-0">{children}</div>
    </div>
  );
}

function Empty({
  title,
  body,
  cta,
  view,
  prompt,
}: {
  title: string;
  body: string;
  cta: string;
  view: string;
  prompt?: string;
}) {
  const setActiveView = useStore((s) => s.setActiveView);
  const pushChat = useStore((s) => s.pushChat);

  return (
    <div className="flex flex-col items-start justify-center min-h-[240px] max-w-md py-8">
      <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-jarvis-muted mb-2">{title}</div>
      <p className="text-jarvis-muted text-sm leading-relaxed mb-5">{body}</p>
      <button
        type="button"
        className="btn-primary px-5 py-2.5 text-sm"
        onClick={() => {
          setActiveView(view);
          if (prompt) {
            pushChat({ id: nextId(), role: "user", text: prompt, ts: Date.now() });
            wsClient.chat(prompt);
          }
        }}
      >
        {cta}
      </button>
    </div>
  );
}
