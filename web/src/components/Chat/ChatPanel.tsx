/**
 * CHAT PANEL — holographic dialogue tiles.
 *
 * Every message renders as an icon + title row (no card background),
 * and modern sci-fi chrome (max rounded-lg).
 */
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useStore, type ChatAttachment, type ChatEntry } from "../../lib/store";
import SafeMarkdown from "./SafeMarkdown";

export default function ChatPanel({ embedded = false }: { embedded?: boolean }) {
  const chat = useStore((s) => s.chat);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  // Sticky autoscroll: stays pinned to the bottom unless the user scrolls
  // up. Re-engages when they scroll back within 40 px of the bottom.
  const autoScroll = useRef(true);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    if (autoScroll.current) scrollToBottom();
  }, [chat, scrollToBottom]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (autoScroll.current) scrollToBottom();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  return (
    <div className={`${embedded ? "bg-transparent" : "holo-panel"} flex flex-col h-full overflow-hidden`}>
      <Header />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 text-[13px] leading-[1.55] text-jarvis-ice/90"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(125,211,252,0.025) 0%, rgba(3,7,15,0) 30%)",
        }}
      >
        {(() => {
          // Spoken dialogue only — hide system/info/error and boot greetings.
          const spoken = chat.filter(
            (m) =>
              (m.role === "user" || m.role === "assistant") &&
              !isSystemNoise(m.text),
          );
          if (spoken.length === 0) return <EmptyState />;
          return (
            <div ref={contentRef} className="flex flex-col gap-3.5">
              {spoken.map((m) => (
                <MessageTile key={m.id} entry={m} />
              ))}
              <div ref={bottomRef} />
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function Header() {
  const health = useStore((s) => s.health);
  const model = health?.model?.model;
  return (
    <div className="relative flex items-center justify-between px-4 py-2.5 shrink-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-1.5 h-1.5 bg-jarvis-aqua rounded-full animate-pulse_glow shrink-0" />
        <span className="text-display text-[11px] tracking-[0.35em] text-shimmer font-semibold">DIALOGUE</span>
        {model && (
          <span
            className="text-mono text-[9px] text-jarvis-cyan/55 tracking-wide truncate max-w-[160px] px-1.5 py-0.5 rounded-lg"
            style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.18)" }}
            title={model}
          >
            {model}
          </span>
        )}
      </div>
      <div className="text-mono text-[10px] text-jarvis-ice/35 shrink-0">/help</div>
      <div className="absolute bottom-0 left-3 right-3 glass-divider" />
    </div>
  );
}

function isSystemNoise(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (t.startsWith("[brain error]")) return true;
  return false;
}

function EmptyState() {
  return (
    <div className="flex flex-col gap-3.5 mt-1">
      <div className="chat-tile">
        <div className="chat-tile-icon" aria-hidden>
          <PromptIcon />
        </div>
        <div className="chat-tile-body">
          <div className="chat-tile-title mb-2">Awaiting input</div>
          <p className="text-[12px] text-jarvis-ice/50 mb-3 leading-relaxed">
            Speak or type a command to begin.
          </p>
          <div className="space-y-1.5">
            {[
              "what is the system status?",
              "scan this folder: C:\\Users\\Me\\projects\\foo",
              "search memory for python",
              "write a hello-world script and run it",
            ].map((s) => (
              <div key={s} className="flex items-center gap-2 group cursor-default">
                <span className="text-jarvis-cyan/45 group-hover:text-jarvis-cyan transition-colors text-mono text-[11px]">›</span>
                <span className="text-mono text-[11px] text-jarvis-ice/45 group-hover:text-jarvis-ice/75 transition-colors">
                  {s}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageTile({ entry }: { entry: ChatEntry }) {
  const { role, text, streaming, attachments, ts } = entry;
  const time = formatTime(ts);

  if (role !== "user" && role !== "assistant") return null;

  if (role === "user") {
    return (
      <Tile
        icon={<UserIcon />}
        title="You"
        time={time}
        variant="user"
      >
        {attachments && attachments.length > 0 && <AttachmentRow atts={attachments} />}
        {text && (
          <p className="text-jarvis-ice whitespace-pre-wrap break-words">{text}</p>
        )}
      </Tile>
    );
  }

  // assistant
  return (
    <Tile
      icon={<DeltaIcon />}
      title="Jarvis"
      time={time}
    >
      <div className="text-jarvis-ice/95 whitespace-pre-wrap break-words">
        <SafeMarkdown text={text} />
        {streaming && (
          <span className="inline-block w-[7px] h-[13px] bg-jarvis-aqua/80 ml-0.5 align-middle animate-pulse" />
        )}
      </div>
    </Tile>
  );
}

function Tile({
  icon,
  title,
  time,
  children,
  variant,
}: {
  icon: ReactNode;
  title: string;
  time?: string;
  children: ReactNode;
  variant?: "user" | "error";
}) {
  const variantClass =
    variant === "user" ? "chat-tile-user" :
    variant === "error" ? "chat-tile-error" :
    "";

  return (
    <div className={`chat-tile animate-boot_in ${variantClass}`}>
      <div className="chat-tile-icon" aria-hidden>
        {icon}
      </div>
      <div className="chat-tile-body">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <div className="chat-tile-title">{title}</div>
          {time && (
            <div className="text-mono text-[9px] tracking-wider text-jarvis-ice/35 shrink-0 tabular-nums">
              {time}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function AttachmentRow({ atts }: { atts: ChatAttachment[] }) {
  return (
    <div className="flex flex-wrap gap-2 mb-2.5">
      {atts.map((a, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-1.5 py-1 rounded-lg border border-jarvis-aqua/30 bg-jarvis-aqua/5 text-[10px] text-mono text-jarvis-aqua"
        >
          {a.type === "image" && (a.data_url || a.url) ? (
            <img
              src={a.data_url || a.url}
              alt=""
              className="w-14 h-14 object-cover rounded-lg border border-jarvis-aqua/30"
            />
          ) : (
            <span className="px-1.5 py-1 rounded-md border border-jarvis-aqua/40">FILE</span>
          )}
          <span className="truncate max-w-[160px] pr-1">{a.name}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────── */

function CubeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5Z" />
      <path d="M12 12v9.5M12 12 3.5 7M12 12l8.5-5" />
    </svg>
  );
}

function DeltaIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <path d="M12 7.2 17.2 16.5H6.8L12 7.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(125,211,252,0.12)" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8.5" r="3.2" />
      <path d="M5.5 19.2c1.6-3.2 4-4.8 6.5-4.8s4.9 1.6 6.5 4.8" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M12 3.8 21 19.5H3L12 3.8Z" />
      <path d="M12 10v4.2" />
      <circle cx="12" cy="16.6" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PromptIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M8 12h3.5l2 2.2L16.5 9" />
    </svg>
  );
}

