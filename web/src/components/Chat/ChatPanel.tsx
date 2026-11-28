/**
 * Chat window — llama.cpp-style transcript:
 * reasoning + tool rails, per-message stats, copy/edit/regen/delete.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  Hash,
  Pencil,
  RefreshCw,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { useStore, type ChatAttachment, type ChatEntry, type ToolCall } from "../../lib/store";
import { wsClient } from "../../lib/ws";
import {
  ThinkingState,
  Markdown,
  type TraceNode,
} from "@/components/ui/ai-thinking-and-tool-calls";
import Orb from "../Orb/Orb";
import { cn } from "@/lib/utils";

export default function ChatPanel({ embedded = false }: { embedded?: boolean }) {
  const chat = useStore((s) => s.chat);
  const tools = useStore((s) => s.tools);
  const orbState = useStore((s) => s.orbState);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (autoScroll.current) scrollToBottom();
  }, [chat, tools, orbState, scrollToBottom]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (autoScroll.current) scrollToBottom();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  const spoken = chat.filter(
    (m) => (m.role === "user" || m.role === "assistant") && !isSystemNoise(m.text),
  );

  const turns = useMemo(() => buildTurns(spoken, tools, orbState), [spoken, tools, orbState]);

  return (
    <div className={cn("flex flex-col h-full overflow-hidden bg-transparent", embedded && "min-h-0")}>
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto">
        {spoken.length === 0 && turns.every((t) => t.kind !== "tools") ? (
          <EmptyState />
        ) : (
          <div
            ref={contentRef}
            className="mx-auto w-full max-w-3xl min-w-0 px-4 pt-6 pb-8 flex flex-col gap-6 selection:bg-primary/20 antialiased [font-synthesis:none] sm:px-8"
          >
            {turns.map((turn) => {
              if (turn.kind === "user") {
                return <UserBubble key={turn.entry.id} entry={turn.entry} />;
              }
              if (turn.kind === "tools") {
                return (
                  <ThinkingState
                    key={turn.key}
                    nodes={turn.nodes}
                    autoPlay={false}
                  />
                );
              }
              return <AssistantBubble key={turn.entry.id} entry={turn.entry} />;
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}

type Turn =
  | { kind: "user"; entry: ChatEntry }
  | { kind: "assistant"; entry: ChatEntry }
  | { kind: "tools"; key: string; nodes: TraceNode[]; live: boolean };

function buildTurns(spoken: ChatEntry[], tools: ToolCall[], orbState: string): Turn[] {
  const turns: Turn[] = [];
  const usedToolIds = new Set<string>();

  for (let i = 0; i < spoken.length; i++) {
    const entry = spoken[i];
    if (entry.role === "user") {
      turns.push({ kind: "user", entry });
      continue;
    }

    const prevUserTs = (() => {
      for (let j = i - 1; j >= 0; j--) {
        if (spoken[j].role === "user") return spoken[j].ts;
      }
      return 0;
    })();
    const nextTs = spoken[i + 1]?.ts ?? Number.POSITIVE_INFINITY;
    const related = tools.filter(
      (t) => !usedToolIds.has(t.id) && t.ts >= prevUserTs && t.ts <= Math.max(entry.ts + 30_000, nextTs),
    );
    related.forEach((t) => usedToolIds.add(t.id));

    const nodes: TraceNode[] = [];
    if (entry.reasoning?.trim()) {
      nodes.push({
        type: "reasoning",
        sentences: splitReasoning(entry.reasoning),
        durationSeconds: entry.usage?.duration_ms
          ? Math.max(0.1, entry.usage.duration_ms / 1000)
          : undefined,
        status: entry.streaming ? "running" : "completed",
      });
    }
    nodes.push(...related.map(toolToNode));

    // Real tool/reasoning traces only — streaming response uses the inline Orb.
    if (nodes.length > 0 && !entry.streaming) {
      turns.push({
        kind: "tools",
        key: `tools-${entry.id}`,
        nodes,
        live: related.some((t) => t.status === "running" || t.status === "proposed"),
      });
    } else if (nodes.length > 0 && entry.streaming) {
      // Keep live tool cards while streaming, but never synthetic "thinking" copy.
      const toolNodes = nodes.filter((n) => n.type !== "reasoning");
      if (toolNodes.length > 0) {
        turns.push({
          kind: "tools",
          key: `tools-${entry.id}`,
          nodes: toolNodes,
          live: true,
        });
      }
    }

    turns.push({ kind: "assistant", entry });
  }

  const leftover = tools.filter((t) => !usedToolIds.has(t.id));
  const liveLeftover = leftover.filter(
    (t) => t.status === "running" || t.status === "proposed" || Date.now() - t.ts < 60_000,
  );
  if (liveLeftover.length > 0) {
    const lastUser = [...spoken].reverse().find((m) => m.role === "user");
    const afterUser = lastUser
      ? liveLeftover.filter((t) => t.ts >= lastUser.ts)
      : liveLeftover;
    if (afterUser.length > 0) {
      turns.push({
        kind: "tools",
        key: `tools-live-${afterUser.map((t) => t.id).join("-")}`,
        nodes: afterUser.map(toolToNode),
        live: afterUser.some((t) => t.status === "running" || t.status === "proposed"),
      });
    }
  } else if (
    (orbState === "thinking" || orbState === "executing" || orbState === "speaking") &&
    spoken.length > 0 &&
    spoken[spoken.length - 1]?.role === "user"
  ) {
    // Pending reply: Orb sits where the assistant message will land.
    turns.push({
      kind: "assistant",
      entry: {
        id: "__pending_stream__",
        role: "assistant",
        text: "",
        streaming: true,
        ts: Date.now(),
      },
    });
  }

  return turns;
}

function splitReasoning(text: string): string[] {
  return text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 48);
}

function toolToNode(t: ToolCall): TraceNode {
  const name = (t.tool || "tool").toLowerCase();
  const isShell = /shell|exec|command|powershell|bash|cmd|run_shell/.test(name);
  const isSearch = /search|web_search|browse|fetch/.test(name);
  const isRead = /read|file_read|get_file/.test(name);
  const isWrite = /write|edit|patch|apply_patch|file_write/.test(name);
  const failed = t.status === "fail" || t.status === "denied";
  const status =
    t.status === "ok"
      ? "completed"
      : failed
        ? "failed"
        : t.status === "running" || t.status === "proposed"
          ? "running"
          : "completed";

  if (isShell) {
    const cmd =
      (typeof t.args?.command === "string" && t.args.command) ||
      (typeof t.args?.cmd === "string" && t.args.cmd) ||
      t.preview ||
      t.tool;
    return {
      id: t.id,
      type: "terminal",
      toolName: t.tool,
      command: String(cmd),
      output: t.result,
      exitCode: failed ? 1 : 0,
      durationMs: t.duration_s != null ? Math.round(t.duration_s * 1000) : undefined,
      status,
    };
  }

  if (isSearch) {
    return {
      id: t.id,
      type: "search",
      toolName: t.tool,
      secondary: t.preview || singleArg(t.args) || t.tool,
      details: t.result
        ? t.result.split("\n").slice(0, 24).map((text) => ({ text, tone: "muted" as const }))
        : undefined,
      status,
    };
  }

  return {
    id: t.id,
    type: "tool",
    toolName: isRead ? "read_file" : isWrite ? "edit_file" : t.tool,
    primary: prettyToolLabel(t.tool),
    secondary: t.preview || singleArg(t.args),
    args: t.args,
    details: t.result
      ? t.result.split("\n").slice(0, 24).map((text) => ({
          text,
          tone: failed ? ("error" as const) : ("muted" as const),
        }))
      : undefined,
    status,
    durationSeconds: t.duration_s,
  };
}

function singleArg(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  const path = args.path ?? args.file ?? args.query ?? args.url ?? args.pattern;
  if (typeof path === "string" && path.trim()) return path;
  try {
    const s = JSON.stringify(args);
    return s === "{}" ? undefined : s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return undefined;
  }
}

function prettyToolLabel(tool: string): string {
  return (tool || "Tool")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isSystemNoise(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (t.startsWith("[brain error]")) return true;
  return false;
}

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDuration(ms?: number): string {
  if (ms == null || ms <= 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
}

function MessageStats({ entry }: { entry: ChatEntry }) {
  const u = entry.usage;
  const tokenTotal =
    u?.prompt_tokens != null || u?.completion_tokens != null
      ? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)
      : u?.total_tokens;
  const tokenDetail =
    u?.prompt_tokens != null || u?.completion_tokens != null
      ? `${u.prompt_tokens ?? 0}↑ ${u.completion_tokens ?? 0}↓`
      : null;
  const duration = formatDuration(u?.duration_ms);
  const time = formatTs(entry.ts);
  if (!entry.model && !time && tokenTotal == null && !duration) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground/80 tabular-nums">
      {entry.model && <span className="truncate max-w-[140px]">{entry.model}</span>}
      {time && (
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3 opacity-70" aria-hidden />
          {time}
        </span>
      )}
      {tokenTotal != null && tokenTotal > 0 && (
        <span className="inline-flex items-center gap-1" title={tokenDetail || undefined}>
          <Hash className="size-3 opacity-70" aria-hidden />
          {tokenTotal.toLocaleString()}
          {tokenDetail && <span className="opacity-60">({tokenDetail})</span>}
        </span>
      )}
      {duration && (
        <span className="inline-flex items-center gap-1">
          <Timer className="size-3 opacity-70" aria-hidden />
          {duration}
        </span>
      )}
    </div>
  );
}

function MessageActions({
  entry,
  align = "left",
  onEdit,
}: {
  entry: ChatEntry;
  align?: "left" | "right";
  onEdit?: () => void;
}) {
  const dropChat = useStore((s) => s.dropChat);
  const truncateChatFrom = useStore((s) => s.truncateChatFrom);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(entry.text || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  const regenerate = () => {
    if (entry.role === "assistant") {
      // Find preceding user message and resend it after truncating this reply onward.
      const chat = useStore.getState().chat;
      const idx = chat.findIndex((c) => c.id === entry.id);
      let userText = "";
      for (let i = idx - 1; i >= 0; i--) {
        if (chat[i].role === "user") {
          userText = chat[i].text;
          break;
        }
      }
      truncateChatFrom(entry.id);
      if (userText.trim()) wsClient.chat(userText);
      return;
    }
    // User message: truncate from next message and resend.
    const chat = useStore.getState().chat;
    const idx = chat.findIndex((c) => c.id === entry.id);
    const next = chat[idx + 1];
    if (next) truncateChatFrom(next.id);
    else {
      // No assistant yet — just resend
    }
    dropChat(entry.id);
    if (entry.text.trim()) wsClient.chat(entry.text);
  };

  const remove = () => {
    dropChat(entry.id);
  };

  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
        align === "right" && "justify-end",
      )}
    >
      <ActionBtn label={copied ? "Copied" : "Copy"} onClick={() => void copy()}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </ActionBtn>
      {onEdit && (
        <ActionBtn label="Edit" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </ActionBtn>
      )}
      <ActionBtn label="Regenerate" onClick={regenerate}>
        <RefreshCw className="size-3.5" />
      </ActionBtn>
      <ActionBtn label="Delete" onClick={remove}>
        <Trash2 className="size-3.5" />
      </ActionBtn>
    </div>
  );
}

function ActionBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground outline-none"
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      <p className="text-base font-semibold text-foreground">Start a conversation</p>
      <p className="mt-1 text-sm text-muted-foreground max-w-xs">
        Use the prompt below the orb. Replies show up here with tokens, timing, and tools.
      </p>
    </div>
  );
}

function UserBubble({ entry }: { entry: ChatEntry }) {
  const { text, attachments } = entry;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const truncateChatFrom = useStore((s) => s.truncateChatFrom);

  const beginSave = () => {
    const next = draft.trim();
    if (!next) return;
    // Branch like llama.cpp: truncate from this message onward, then resend.
    truncateChatFrom(entry.id);
    setEditing(false);
    wsClient.chat(next);
  };

  return (
    <div className="group flex flex-col items-end">
      <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-[14px] leading-relaxed text-foreground text-balance shadow-xs">
        {attachments && attachments.length > 0 && <AttachmentRow atts={attachments} />}
        {editing ? (
          <div className="flex flex-col gap-2 min-w-[220px]">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full min-h-[72px] resize-y rounded-lg bg-background/60 px-2 py-1.5 text-sm outline-none"
              autoFocus
            />
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => {
                  setDraft(text);
                  setEditing(false);
                }}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06]"
                aria-label="Cancel edit"
              >
                <X className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={beginSave}
                className="inline-flex size-7 items-center justify-center rounded-md text-primary hover:bg-primary/10"
                aria-label="Save edit"
              >
                <Check className="size-3.5" />
              </button>
            </div>
          </div>
        ) : (
          text && <p className="whitespace-pre-wrap break-words">{text}</p>
        )}
      </div>
      {!editing && (
        <>
          <MessageStats entry={entry} />
          <MessageActions entry={entry} align="right" onEdit={() => setEditing(true)} />
        </>
      )}
    </div>
  );
}

function AssistantBubble({ entry }: { entry: ChatEntry }) {
  const { text, streaming } = entry;
  if (streaming) {
    return (
      <div className="group flex min-w-0 items-start" aria-busy="true" aria-label="Responding">
        <Orb variant="inline" className="!h-20 !w-20" enableVoiceControl />
      </div>
    );
  }
  return (
    <div className="group flex flex-col gap-1 min-w-0">
      <div className="font-sans text-[14px] leading-[22px] text-foreground/90 select-text text-pretty">
        <Markdown text={text || ""} />
      </div>
      <MessageStats entry={entry} />
      <MessageActions entry={entry} align="left" />
    </div>
  );
}

function AttachmentRow({ atts }: { atts: ChatAttachment[] }) {
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {atts.map((a, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-border/60">
          {a.type === "image" && (a.data_url || a.url) ? (
            <img src={a.data_url || a.url} alt="" className="w-16 h-16 object-cover" />
          ) : (
            <span className="block px-3 py-2 text-xs truncate max-w-[140px]">{a.name}</span>
          )}
        </div>
      ))}
    </div>
  );
}
