/**
 * Cursor-style chat composer for JARVIS.
 * Rounded input · + tools menu · mode pill · model picker popup · mic + send.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import {
  ChevronDown,
  ImagePlus,
  Mic,
  Monitor,
  Plus,
  Search,
  Wrench,
  X,
  ArrowUp,
  Square,
  CloudSun,
  Globe,
  Camera,
  Terminal,
  FolderOpen,
  Sparkles,
  MemoryStick,
  LayoutGrid,
  Database,
  Download,
  Brain,
  HardDrive,
  Cpu,
  Check,
  Trash2,
  Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type LoadedModelInfo = {
  id: string;
  name: string;
  backend?: string;
  status?: string;
  size_gb?: number | null;
  size_vram_gb?: number | null;
  family?: string;
  parameter_size?: string;
  quantization?: string;
  context_length?: number;
  unloadable?: boolean;
  loadable?: boolean;
};

export type ReasoningLevel = "none" | "low" | "medium" | "high";

const VOICE_BARS = 9;

/* ── Types ─────────────────────────────────────────────────────────────── */

export type PromptModelOption = {
  id: string;
  label: string;
  skill?: string;
  skill_label?: string;
  tier?: string;
  level?: string;
  recommended?: boolean;
  cloud?: boolean;
  installed?: boolean;
  summary?: string;
  pull?: string | null;
  vram_gb?: number;
  ram_gb?: number;
  size_gb?: number | null;
  fit?: string;
  fit_label?: string;
  needs?: string;
};

export type ModelPullProgress = {
  id: string;
  percent: number | null;
  detail?: string;
  status?: string;
};

export type PromptToolOption = {
  name: string;
  description?: string;
  permission?: string;
  plugin?: string;
};

interface Attachment {
  id: string;
  file: File;
  url: string;
  name: string;
  width?: number;
  height?: number;
}

type ModeId = "Agent" | "Ask" | "Plan";

const TOOL_FAV_KEY = "jarvis.tools.favorites";

function loadStringList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const j = raw ? JSON.parse(raw) : [];
    return Array.isArray(j) ? j.map(String) : [];
  } catch {
    return [];
  }
}

/* ── Model helpers ─────────────────────────────────────────────────────── */

type ModelFamily =
  | "gpt"
  | "gemini"
  | "gemma"
  | "opus"
  | "composer"
  | "glm"
  | "kimi"
  | "grok"
  | "huggingface"
  | "qwen"
  | "meta"
  | "phi"
  | "deepseek"
  | "ollama"
  | "auto"
  | "generic";

const LOBE_ICON = (id: string) =>
  `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/${id}.svg`;

function modelFamily(model: string): ModelFamily {
  const m = model.toLowerCase();
  if (m.includes("smart auto") || m === "auto" || m.startsWith("auto ")) return "auto";
  if (m.includes("grok") || m.includes("xai")) return "grok";
  if (m.includes("huggingface") || m.includes("hugging face") || m.includes("hf.co"))
    return "huggingface";
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("openai")) return "gpt";
  if (m.includes("gemini")) return "gemini";
  if (m.includes("gemma")) return "gemma";
  if (
    m.includes("opus") ||
    m.includes("claude") ||
    m.includes("sonnet") ||
    m.includes("haiku") ||
    m.includes("anthropic")
  ) {
    return "opus";
  }
  if (m.includes("composer") || m.includes("cursor") || m.includes("fable")) return "composer";
  if (m.includes("glm") || m.includes("chatglm") || m.includes("zhipu")) return "glm";
  if (m.includes("kimi") || m.includes("moonshot")) return "kimi";
  if (m.includes("qwen") || m.includes("qwq")) return "qwen";
  if (m.includes("llama") || m.includes("meta")) return "meta";
  if (m.includes("phi") || m.includes("microsoft")) return "phi";
  if (m.includes("deepseek")) return "deepseek";
  if (m.includes("ollama")) return "ollama";
  return "generic";
}

function modelLevel(m: PromptModelOption): string {
  if (m.level) return m.level;
  if (m.id === "auto" || m.tier === "auto" || m.skill === "adaptive") return "Auto";
  if (m.skill === "reasoning" || m.skill === "coding") return "High";
  if (m.skill === "tools") return "High";
  if (m.skill === "balanced") return "Medium";
  if (m.skill === "speed") return "Low";
  if (m.cloud) return "Cloud";
  if (m.tier === "light") return "Low";
  if (m.tier === "heavy") return "Very High";
  return "Medium";
}

function reasoningCaption(m: PromptModelOption): string {
  const lvl = modelLevel(m);
  if (lvl === "Auto" || lvl === "Cloud" || lvl === "Fast") return `${lvl}`;
  return `${lvl} Reasoning`;
}

function formatGb(n?: number | null): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return n >= 10 ? `${Math.round(n)} GB` : `${n.toFixed(1)} GB`;
}

function fitBadge(fit?: string, fallback?: string): { label: string; tone: "ok" | "tight" | "bad" | "muted" } {
  if (fallback?.toLowerCase().includes("incompatible") || fallback?.toLowerCase().includes("won't")) {
    return { label: fallback, tone: "bad" };
  }
  if (fallback?.toLowerCase().includes("tight")) return { label: fallback, tone: "tight" };
  if (fallback?.toLowerCase().includes("fit")) return { label: fallback, tone: "ok" };
  switch ((fit || "").toLowerCase()) {
    case "fits":
    case "cpu":
      return { label: "Fits PC", tone: "ok" };
    case "tight":
      return { label: "Tight Fit", tone: "tight" };
    case "heavy":
    case "no":
      return { label: "Incompatible", tone: "bad" };
    default:
      return { label: fallback || "Unknown", tone: "muted" };
  }
}

type MetricTone = "good" | "mid" | "bad" | "neutral";

function MetricPills({
  label,
  value,
  max = 5,
  tone = "neutral",
}: {
  label: string;
  value: number;
  max?: number;
  tone?: MetricTone;
}) {
  const filled = Math.max(0, Math.min(max, Math.round(value)));
  const fill =
    tone === "good"
      ? "bg-emerald-400"
      : tone === "mid"
        ? "bg-amber-400"
        : tone === "bad"
          ? "bg-red-400"
          : "bg-sky-400";
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[5.5rem] shrink-0 text-[12px] text-[#a1a1aa]">{label}</span>
      <span className="flex flex-1 items-center gap-1">
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-2.5 flex-1 rounded-full",
              i < filled ? fill : "bg-white/[0.1]",
            )}
          />
        ))}
      </span>
    </div>
  );
}

function modelMetrics(m: PromptModelOption): {
  intelligence: number;
  intelligenceTone: MetricTone;
  speed: number;
  speedTone: MetricTone;
  size: number;
  sizeTone: MetricTone;
} {
  const lvl = modelLevel(m);
  const intelligence =
    lvl === "Very High" ? 5 : lvl === "High" ? 4 : lvl === "Medium" ? 3 : lvl === "Low" ? 2 : 3;
  const sizeGb = m.size_gb ?? m.vram_gb ?? 0;
  const speed =
    m.skill === "speed" || m.tier === "light" || (sizeGb > 0 && sizeGb < 3)
      ? 5
      : sizeGb < 6
        ? 4
        : sizeGb < 12
          ? 3
          : 2;
  const sizeScore =
    sizeGb <= 0 ? 3 : sizeGb < 4 ? 5 : sizeGb < 8 ? 4 : sizeGb < 14 ? 3 : 2;
  return {
    intelligence,
    intelligenceTone: intelligence >= 4 ? "good" : intelligence >= 3 ? "mid" : "neutral",
    speed,
    speedTone: speed >= 4 ? "good" : speed >= 3 ? "mid" : "bad",
    size: sizeScore,
    sizeTone: sizeScore >= 4 ? "good" : sizeScore >= 3 ? "mid" : "bad",
  };
}

function ContextRing({
  pct,
  size = 28,
  stroke = 2.5,
  className,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, pct));
  const dash = (filled / 100) * c;
  const tone =
    filled >= 90 ? "rgba(248,113,113,0.95)" : filled >= 70 ? "rgba(251,191,36,0.95)" : "rgba(255,255,255,0.92)";
  return (
    <svg width={size} height={size} className={cn("-rotate-90", className)} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={tone}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
      />
    </svg>
  );
}

function ContextRadial({
  pct,
  title,
  onClick,
}: {
  pct: number;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="relative inline-flex size-8 items-center justify-center rounded-full"
      aria-label={title}
      title={title}
    >
      <ContextRing pct={pct} size={28} stroke={2.5} />
    </button>
  );
}

const PROVIDER_LABEL: Partial<Record<ModelFamily | "all", string>> = {
  all: "All",
  meta: "Meta",
  qwen: "Qwen",
  gemma: "Gemma",
  gemini: "Google",
  grok: "xAI",
  phi: "Phi",
  deepseek: "DeepSeek",
  glm: "GLM",
  kimi: "Kimi",
  gpt: "OpenAI",
  opus: "Anthropic",
  huggingface: "HF",
  ollama: "Ollama",
  generic: "Other",
};

function providerName(family: ModelFamily | "all") {
  return PROVIDER_LABEL[family] || family;
}

function ContextBreakdownRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  return (
    <div className="min-w-0">
      <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px]">
        <span className="text-[#a1a1aa]">{label}</span>
        <span className="tabular-nums text-[#71767b]">{value.toLocaleString()}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Portal popups to body so the chat tile cannot clip them. */
function useAnchoredPopup(open: boolean) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const popup = popupRef.current;
      if (!anchor || !popup) return;
      const a = anchor.getBoundingClientRect();
      const pad = 10;
      const gap = 10;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pw = Math.max(popup.offsetWidth, 160);
      const ph = Math.max(popup.offsetHeight, 40);
      // Prefer sitting directly above the trigger.
      let top = a.top - ph - gap;
      if (top < pad) {
        top = Math.min(a.bottom + gap, vh - ph - pad);
      }
      // Prefer left-align with trigger; flip if it would overflow the viewport.
      let left = a.left;
      if (left + pw > vw - pad) left = Math.max(pad, a.right - pw);
      if (left < pad) left = pad;
      if (top + ph > vh - pad) top = Math.max(pad, vh - ph - pad);
      popup.style.position = "fixed";
      popup.style.left = `${Math.round(left)}px`;
      popup.style.top = `${Math.round(top)}px`;
      popup.style.right = "auto";
      popup.style.bottom = "auto";
      popup.style.zIndex = "200";
    };
    place();
    const raf = requestAnimationFrame(() => {
      place();
      requestAnimationFrame(place);
    });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return { anchorRef, popupRef };
}

const MODEL_ICON_URL: Partial<Record<ModelFamily, string>> = {
  gpt: LOBE_ICON("openai"),
  gemini: LOBE_ICON("gemini-color"),
  gemma: LOBE_ICON("gemma-color"),
  opus: LOBE_ICON("claude-color"),
  composer: "https://cdn.21st.dev/assets/mirror/7d/7dc00bc09f225fcda46cbc9c6b669c69c025a231877d6c17baa6a003f04f02b2.svg",
  glm: LOBE_ICON("zhipu-color"),
  kimi: LOBE_ICON("kimi-color"),
  grok: LOBE_ICON("grok"),
  huggingface: LOBE_ICON("huggingface-color"),
  qwen: LOBE_ICON("qwen-color"),
  meta: LOBE_ICON("meta-color"),
  phi: LOBE_ICON("microsoft-color"),
  deepseek: LOBE_ICON("deepseek-color"),
  ollama: LOBE_ICON("ollama"),
};

function ModelIconFallback({ family, className }: { family: ModelFamily; className?: string }) {
  if (family === "auto") {
    return <Sparkles className={cn("size-3.5 text-[#1d9bf0]", className)} aria-hidden />;
  }
  if (family === "gpt") {
    return (
      <svg viewBox="0 0 24 24" className={cn("size-3.5", className)} fill="currentColor" aria-hidden>
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.805.805 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.844-3.373L15.119 7.21a.076.076 0 0 1 .071 0l4.83 2.785a4.494 4.494 0 0 1-.676 8.105v-5.677a.79.79 0 0 0-.407-.672zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135L6.27 11.7v-2.336a.08.08 0 0 1 .033-.062l4.827-2.784a.775.775 0 0 1 .785 0l4.78 2.76a.076.076 0 0 1 .038.052v5.575a.076.076 0 0 1-.038.056l-4.78 2.76a.746.746 0 0 1-.785 0z" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-3.5 opacity-80", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" strokeLinecap="round" />
    </svg>
  );
}

function ModelIcon({ model, className }: { model: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const family = modelFamily(model);
  const src = MODEL_ICON_URL[family];
  const invert = family === "gpt" || family === "ollama" || family === "grok";

  useEffect(() => {
    setFailed(false);
  }, [model, family]);

  if (!src || failed) {
    return <ModelIconFallback family={family} className={className} />;
  }

  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className={cn("size-3.5 shrink-0 object-contain", invert && "brightness-0 invert", className)}
      draggable={false}
    />
  );
}

/* ── Tool icons ────────────────────────────────────────────────────────── */

function toolIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("weather") || n.includes("battery")) return CloudSun;
  if (n.includes("web_agent") || n.includes("computer") || n.includes("desktop")) return Monitor;
  if (n.includes("web_search") || n.includes("web_fetch") || n.includes("browser")) return Globe;
  if (n.includes("image") || n.includes("screenshot") || n.includes("vision") || n.includes("webcam"))
    return Camera;
  if (n.includes("shell") || n.includes("powershell") || n.includes("terminal")) return Terminal;
  if (
    n.includes("file") ||
    n.includes("dir") ||
    n.includes("mkdir") ||
    n.includes("read_") ||
    n.includes("write_")
  ) {
    return FolderOpen;
  }
  if (n.includes("memory") || n.includes("remember") || n.includes("recall")) return MemoryStick;
  if (n.includes("generate") || n.includes("3d") || n.includes("media")) return Sparkles;
  if (n.includes("system") || n.includes("process") || n.includes("gpu") || n.includes("disk"))
    return LayoutGrid;
  return Wrench;
}

function prettyToolName(name: string) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Attachment bits ───────────────────────────────────────────────────── */

function AttachmentThumb({
  attachment,
  index,
  onRemove,
  onOpen,
}: {
  attachment: Attachment;
  index: number;
  onRemove: (id: string) => void;
  onOpen: (attachment: Attachment, rect: DOMRect) => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  return (
    <button
      ref={btnRef}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        if (btnRef.current) onOpen(attachment, btnRef.current.getBoundingClientRect());
      }}
      style={{ animationDelay: `${index * 35}ms` }}
      className="group relative size-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5 outline-none transition hover:scale-[1.03]"
      aria-label={`Open preview of ${attachment.name}`}
    >
      <img src={attachment.url} alt={attachment.name} className="size-full object-cover" draggable={false} />
      <span
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(attachment.id);
        }}
        className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-md bg-black/70 text-white/80 opacity-0 transition group-hover:opacity-100"
        aria-label={`Remove ${attachment.name}`}
      >
        <X className="size-2.5" />
      </span>
    </button>
  );
}

function AttachmentGalleryModal({
  attachment,
  originRect,
  onClose,
}: {
  attachment: Attachment;
  originRect: DOMRect;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"opening" | "open" | "closing">("opening");
  const [targetRect, setTargetRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    radius: number;
  } | null>(null);

  useEffect(() => {
    const maxW = Math.min(window.innerWidth * 0.86, 560);
    const maxH = Math.min(window.innerHeight * 0.78, 720);
    const naturalW = attachment.width || 800;
    const naturalH = attachment.height || 600;
    const scale = Math.min(maxW / naturalW, maxH / naturalH, 1.6);
    const width = naturalW * scale;
    const height = naturalH * scale;
    setTargetRect({
      top: (window.innerHeight - height) / 2,
      left: (window.innerWidth - width) / 2,
      width,
      height,
      radius: 20,
    });
    const raf = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(raf);
  }, [attachment]);

  const handleClose = useCallback(() => setPhase("closing"), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const isOpen = phase === "open";
  const geometry =
    isOpen && targetRect
      ? targetRect
      : {
          top: originRect.top,
          left: originRect.left,
          width: originRect.width,
          height: originRect.height,
          radius: 12,
        };

  return (
    <div className="fixed inset-0 z-[100]" onClick={handleClose} role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 transition-opacity" style={{ opacity: isOpen ? 1 : 0 }} />
      <div
        style={{
          position: "fixed",
          top: geometry.top,
          left: geometry.left,
          width: geometry.width,
          height: geometry.height,
          borderRadius: geometry.radius,
          transition: "all 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
          overflow: "hidden",
        }}
        className="bg-[#1a1a1e]"
        onTransitionEnd={() => {
          if (phase === "closing") onClose();
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={attachment.url} alt={attachment.name} className="size-full object-cover" draggable={false} />
      </div>
    </div>
  );
}

/* ── Props ─────────────────────────────────────────────────────────────── */

export interface PromptInputProps {
  onSubmit?: (
    value: string,
    meta: { model: string; mode: ModeId; attachments: File[] },
  ) => void;
  placeholder?: string;
  className?: string;
  /** Preferred rich catalog. Falls back to `models` string labels. */
  modelOptions?: PromptModelOption[];
  models?: string[];
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  maxAttachments?: number;
  model?: string;
  onModelChange?: (model: string) => void;
  autoModel?: boolean;
  onAutoModelChange?: (enabled: boolean) => void;
  tools?: PromptToolOption[];
  onToolSelect?: (tool: PromptToolOption) => void;
  listening?: boolean;
  onMicToggle?: () => void;
  /** 0–1 mic energy for voice-memo waves while listening. */
  audioLevel?: number;
  /** True while a reply is streaming / tools are running. */
  busy?: boolean;
  onCancel?: () => void;
  disabled?: boolean;
  /** Kept for CommandBar compatibility; effort UI removed. */
  hideEffort?: boolean;
  defaultExpanded?: boolean;
  efforts?: string[];
  /** Context window fill (llama.cpp-style meter). */
  contextUsed?: number;
  contextLimit?: number;
  /** Models currently resident in VRAM/RAM. */
  loadedModels?: LoadedModelInfo[];
  onUnloadModel?: (id: string) => void;
  onPullModel?: (id: string) => void;
  onCancelPull?: (id: string) => void;
  onDeleteModel?: (id: string) => void;
  pullProgress?: ModelPullProgress[];
  onRefreshLoaded?: () => void;
  reasoningEffort?: ReasoningLevel | string;
  reasoningLevels?: string[];
  onReasoningEffortChange?: (effort: string) => void;
}

/* ── Component ─────────────────────────────────────────────────────────── */

export const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(
  (
    {
      onSubmit,
      placeholder = "Ask anything…",
      className,
      modelOptions,
      models = [],
      defaultValue = "",
      value: controlledValue,
      onChange,
      maxAttachments = 6,
      model: controlledModel,
      onModelChange,
      autoModel,
      onAutoModelChange,
      tools = [],
      onToolSelect,
      listening,
      onMicToggle,
      audioLevel = 0,
      busy = false,
      onCancel,
      disabled = false,
      contextUsed = 0,
      contextLimit = 8192,
      loadedModels: _loadedModels = [],
      onUnloadModel: _onUnloadModel,
      onPullModel,
      onCancelPull,
      onDeleteModel,
      pullProgress = [],
      onRefreshLoaded,
      reasoningEffort: _reasoningEffort = "none",
      reasoningLevels: _reasoningLevels = ["none", "low", "medium", "high"],
      onReasoningEffortChange: _onReasoningEffortChange,
    },
    ref,
  ) => {
    void _loadedModels;
    void _onUnloadModel;
    void _reasoningEffort;
    void _reasoningLevels;
    void _onReasoningEffortChange;
    const catalog = useMemo<PromptModelOption[]>(() => {
      if (modelOptions?.length) return modelOptions;
      return (models.length ? models : ["Model"]).map((label) => ({
        id: label,
        label,
      }));
    }, [modelOptions, models]);

    const [localValue, setLocalValue] = useState(defaultValue);
    const [selectedLabel, setSelectedLabel] = useState(
      controlledModel || catalog[0]?.label || "Model",
    );
    const mode: ModeId = "Agent";
    const [modelOpen, setModelOpen] = useState(false);
    const [toolsOpen, setToolsOpen] = useState(false);
    const [contextOpen, setContextOpen] = useState(false);
    const [modelQuery, setModelQuery] = useState("");
    const [previewModel, setPreviewModel] = useState<PromptModelOption | null>(null);
    const [detailSide, setDetailSide] = useState<"left" | "right">("right");
    const previewClearRef = useRef<number | null>(null);
    const modelAnchor = useAnchoredPopup(modelOpen);

    const showPreview = useCallback((m: PromptModelOption | null) => {
      if (previewClearRef.current) {
        window.clearTimeout(previewClearRef.current);
        previewClearRef.current = null;
      }
      setPreviewModel(m);
    }, []);

    const scheduleClearPreview = useCallback(() => {
      if (previewClearRef.current) window.clearTimeout(previewClearRef.current);
      previewClearRef.current = window.setTimeout(() => setPreviewModel(null), 140);
    }, []);

    useEffect(() => {
      if (!modelOpen) setPreviewModel(null);
    }, [modelOpen]);

    useLayoutEffect(() => {
      if (!modelOpen || !previewModel) return;
      const list = modelAnchor.popupRef.current;
      if (!list) return;
      const rect = list.getBoundingClientRect();
      const detailW = 288;
      const gap = 8;
      const pad = 10;
      const spaceRight = window.innerWidth - rect.right - gap - pad;
      const spaceLeft = rect.left - gap - pad;
      setDetailSide(spaceRight >= detailW || spaceRight >= spaceLeft ? "right" : "left");
    }, [modelOpen, previewModel?.id, modelAnchor.popupRef]);
    const [toolFavs] = useState<string[]>(() => loadStringList(TOOL_FAV_KEY));
    const [autoOn, setAutoOn] = useState(!!autoModel);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [activeAttachment, setActiveAttachment] = useState<{
      attachment: Attachment;
      rect: DOMRect;
    } | null>(null);

    const externalMic = typeof onMicToggle === "function";
    const [isRecording, setIsRecording] = useState(false);
    const recording = externalMic ? !!listening : isRecording;

    const isControlled = controlledValue !== undefined;
    const value = isControlled ? controlledValue! : localValue;
    const hasValue = value.trim() !== "" || attachments.length > 0;

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const anyFileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (controlledModel) setSelectedLabel(controlledModel);
    }, [controlledModel]);

    useEffect(() => {
      if (typeof autoModel === "boolean") setAutoOn(autoModel);
    }, [autoModel]);

    useEffect(() => {
      if (!catalog.length) return;
      if (!catalog.some((m) => m.label === selectedLabel)) {
        setSelectedLabel(catalog[0].label);
      }
    }, [catalog, selectedLabel]);

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "0px";
      el.style.height = `${Math.max(44, Math.min(el.scrollHeight, 160))}px`;
    }, [value]);

    useEffect(() => {
      if (!modelOpen && !toolsOpen && !contextOpen) return;
      const onDown = (e: MouseEvent) => {
        const t = e.target as Node | null;
        if (!t) return;
        const el = t instanceof Element ? t : t.parentElement;
        if (rootRef.current?.contains(t)) return;
        if (el?.closest?.("[data-jarvis-popup]")) return;
        setModelOpen(false);
        setToolsOpen(false);
        setContextOpen(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setModelOpen(false);
          setToolsOpen(false);
          setContextOpen(false);
        }
      };
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("mousedown", onDown);
        document.removeEventListener("keydown", onKey);
      };
    }, [modelOpen, toolsOpen, contextOpen]);

    useEffect(() => {
      if (modelOpen) onRefreshLoaded?.();
    }, [modelOpen, onRefreshLoaded]);

    useEffect(() => {
      return () => {
        attachments.forEach((a) => URL.revokeObjectURL(a.url));
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleValueChange = useCallback(
      (val: string) => {
        if (!isControlled) setLocalValue(val);
        onChange?.(val);
      },
      [isControlled, onChange],
    );

    const selectedMeta = catalog.find((m) => m.label === selectedLabel) || catalog[0];
    const selectedLevel = selectedMeta ? modelLevel(selectedMeta) : "";

    const localCatalog = useMemo(
      () => catalog.filter((m) => m.id !== "auto" && !m.cloud),
      [catalog],
    );

    const filteredModels = useMemo(() => {
      const needle = modelQuery.trim().toLowerCase();
      let list = localCatalog;
      if (needle) {
        list = list.filter(
          (m) =>
            m.label.toLowerCase().includes(needle) ||
            (m.skill_label || "").toLowerCase().includes(needle) ||
            (m.summary || "").toLowerCase().includes(needle) ||
            m.id.toLowerCase().includes(needle) ||
            providerName(modelFamily(m.label)).toLowerCase().includes(needle),
        );
      }
      return [...list].sort((a, b) => {
        const ai = a.installed ? 0 : 1;
        const bi = b.installed ? 0 : 1;
        if (ai !== bi) return ai - bi;
        const ar = a.recommended ? 0 : 1;
        const br = b.recommended ? 0 : 1;
        if (ar !== br) return ar - br;
        return (a.vram_gb || 0) - (b.vram_gb || 0) || a.label.localeCompare(b.label);
      });
    }, [localCatalog, modelQuery]);

    const progressFor = (id: string, label: string) =>
      pullProgress.find(
        (p) =>
          p.id === id ||
          p.id === label ||
          id.endsWith(p.id) ||
          p.id.endsWith(id) ||
          label.toLowerCase().includes(p.id.toLowerCase()),
      );

    const filteredTools = useMemo(() => {
      return [...tools].sort((a, b) => {
        const af = toolFavs.includes(a.name) ? 0 : 1;
        const bf = toolFavs.includes(b.name) ? 0 : 1;
        if (af !== bf) return af - bf;
        return a.name.localeCompare(b.name);
      });
    }, [tools, toolFavs]);

    const pickModel = (m: PromptModelOption) => {
      setSelectedLabel(m.label);
      onModelChange?.(m.label);
      setAutoOn(m.id === "auto");
      onAutoModelChange?.(m.id === "auto");
      setModelOpen(false);
    };

    const setAuto = (enabled: boolean) => {
      setAutoOn(enabled);
      if (enabled) {
        const auto = catalog.find((m) => m.id === "auto");
        if (auto) setSelectedLabel(auto.label);
        setPreviewModel(null);
      } else if (selectedMeta?.id === "auto") {
        const fallback =
          catalog.find((m) => m.id !== "auto" && m.recommended && m.installed !== false) ||
          catalog.find((m) => m.id !== "auto");
        if (fallback) setSelectedLabel(fallback.label);
      }
      onAutoModelChange?.(enabled);
    };

    const addAttachment = (file: File, url: string, width: number, height: number) => {
      const id = `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
      setAttachments((prev) => [...prev, { id, file, url, name: file.name, width, height }]);
    };

    const handleImageFiles = async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      const room = Math.max(0, maxAttachments - attachments.length);
      for (const file of images.slice(0, room)) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => addAttachment(file, url, img.naturalWidth, img.naturalHeight);
        img.onerror = () => addAttachment(file, url, 800, 600);
        img.src = url;
      }
    };

    const handleAnyFiles = async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      const others = files.filter((f) => !f.type.startsWith("image/"));
      await handleImageFiles(images);
      const used = Math.min(images.length, Math.max(0, maxAttachments - attachments.length));
      const room = Math.max(0, maxAttachments - attachments.length - used);
      for (const file of others.slice(0, room)) {
        const url = URL.createObjectURL(file);
        addAttachment(file, url, 0, 0);
      }
    };

    const removeAttachment = (id: string) => {
      setAttachments((prev) => {
        const target = prev.find((a) => a.id === id);
        if (target) URL.revokeObjectURL(target.url);
        return prev.filter((a) => a.id !== id);
      });
    };

    const handleSubmit = () => {
      if (disabled || busy) return;
      if (value.trim() === "" && !attachments.length) return;
      onSubmit?.(value, {
        model: selectedLabel,
        mode,
        attachments: attachments.map((a) => a.file),
      });
      handleValueChange("");
      attachments.forEach((a) => URL.revokeObjectURL(a.url));
      setAttachments([]);
      setModelOpen(false);
      setToolsOpen(false);
      setContextOpen(false);
    };

    const onMicClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (externalMic) onMicToggle?.();
      else setIsRecording((v) => !v);
    };

    const onPrimaryAction = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (busy) {
        onCancel?.();
        return;
      }
      handleSubmit();
    };

    const [waveTick, setWaveTick] = useState(0);
    useEffect(() => {
      if (!recording) return;
      let raf = 0;
      const loop = () => {
        setWaveTick(performance.now());
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(raf);
    }, [recording]);

    const voiceBars = useMemo(() => {
      const level = Math.min(1, Math.max(0.04, audioLevel));
      const t = waveTick / 180;
      return Array.from({ length: VOICE_BARS }, (_, i) => {
        const center = (VOICE_BARS - 1) / 2;
        const dist = Math.abs(i - center) / Math.max(center, 1);
        const shape = 1 - dist * 0.68;
        const wave = 0.55 + 0.45 * Math.sin(t + i * 0.7);
        const energy = level * 1.35;
        return Math.max(0.14, Math.min(1, energy * shape * wave + 0.1 * shape));
      });
    }, [audioLevel, waveTick]);

    const openTools = () => {
      setToolsOpen((v) => !v);
      setModelOpen(false);
      setContextOpen(false);
    };

    const openModels = () => {
      setModelOpen((v) => !v);
      setToolsOpen(false);
      setContextOpen(false);
      setModelQuery("");
    };

    const openContext = () => {
      setContextOpen((v) => !v);
      setModelOpen(false);
      setToolsOpen(false);
    };

    const ctxLimit = Math.max(1, contextLimit || 8192);
    const ctxUsed = Math.max(0, contextUsed || 0);
    const ctxPct = Math.min(100, Math.round((ctxUsed / ctxLimit) * 100));
    const ctxFree = Math.max(0, ctxLimit - ctxUsed);
    const ctxSystem = Math.min(ctxUsed, Math.round(ctxLimit * 0.08));
    const ctxChat = Math.max(0, ctxUsed - ctxSystem);

    return (
      <>
        <div
          ref={(node) => {
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
            (rootRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }}
          className={cn("relative w-full min-w-0", className)}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              void handleImageFiles(Array.from(e.target.files || []));
              e.target.value = "";
              setToolsOpen(false);
            }}
          />
          <input
            ref={anyFileInputRef}
            type="file"
            multiple
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              void handleAnyFiles(Array.from(e.target.files || []));
              e.target.value = "";
              setToolsOpen(false);
            }}
          />

          {attachments.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
              {attachments.map((a, i) => (
                <AttachmentThumb
                  key={a.id}
                  attachment={a}
                  index={i}
                  onRemove={removeAttachment}
                  onOpen={(att, rect) => setActiveAttachment({ attachment: att, rect })}
                />
              ))}
            </div>
          )}

          <div
            className="gemini-metal-border relative rounded-[28px] p-[1.5px] shadow-[0_12px_40px_-16px_rgba(0,0,0,0.75)]"
          >
          <div
            className="relative rounded-[26.5px] bg-[#1a1a1e]/[0.96] backdrop-blur-xl outline-none"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) textareaRef.current?.focus();
            }}
          >
            <div className="flex items-start gap-1 px-2 pt-3">
              <div className="relative shrink-0 pt-0.5">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openTools}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-[#e7e9ea]/80 transition hover:bg-white/[0.08] hover:text-white",
                    toolsOpen && "bg-white/[0.12] text-white",
                  )}
                  aria-label="Attach or use a tool"
                >
                  <Plus className="size-4" strokeWidth={1.75} />
                </button>

                {toolsOpen && (
                  <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[min(340px,78vw)] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#2f2f2f] py-1.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.75)]">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        anyFileInputRef.current?.click();
                        setToolsOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.08]"
                    >
                      <Paperclip className="size-4 shrink-0 text-[#e7e9ea]/85" />
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        <span className="font-medium text-white">Add photos &amp; files</span>{" "}
                        <span className="text-[#9b9b9b]">Upload from computer</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        fileInputRef.current?.click();
                        setToolsOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.08]"
                    >
                      <ImagePlus className="size-4 shrink-0 text-sky-300" />
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        <span className="font-medium text-white">Add photos</span>{" "}
                        <span className="text-[#9b9b9b]">Images for vision</span>
                      </span>
                    </button>

                    {filteredTools.length > 0 && (
                      <div className="my-1 border-t border-white/[0.08]" />
                    )}

                    <div className="max-h-64 overflow-y-auto">
                      {filteredTools.map((tool) => {
                        const Icon = toolIcon(tool.name);
                        return (
                          <button
                            key={tool.name}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              onToolSelect?.(tool);
                              setToolsOpen(false);
                            }}
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.08]"
                          >
                            <Icon className="size-4 shrink-0 text-[#e7e9ea]/85" />
                            <span className="min-w-0 flex-1 truncate text-[13px]">
                              <span className="font-medium text-white">{prettyToolName(tool.name)}</span>{" "}
                              <span className="text-[#9b9b9b]">
                                {tool.description || tool.plugin || tool.permission || "Tool"}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                      {tools.length === 0 && (
                        <div className="px-3 py-3 text-[12px] text-[#9b9b9b]">
                          Tools appear once JARVIS connects.
                        </div>
                      )}
                      {tools.length > 0 && filteredTools.length === 0 && (
                        <div className="px-3 py-3 text-[12px] text-[#9b9b9b]">No matching tools</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => handleValueChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (busy) return;
                    handleSubmit();
                  }
                }}
                placeholder={placeholder}
                aria-label="Prompt"
                disabled={recording || disabled}
                rows={1}
                className="min-w-0 flex-1 resize-none bg-transparent px-1 pt-1.5 pb-2 text-[15px] leading-6 text-[#e7e9ea] outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-[#71767b] disabled:opacity-60"
              />
            </div>

            <div className="flex items-center gap-1.5 px-3 pb-3 pt-1">
              <div className="relative min-w-0" ref={modelAnchor.anchorRef}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openModels}
                  className={cn(
                    "inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-full border border-white/[0.08] bg-transparent px-2 text-[13px] transition hover:bg-white/[0.06]",
                    modelOpen && "bg-white/[0.08]",
                  )}
                  aria-label={`Select model. Current: ${selectedLabel}`}
                >
                  <ModelIcon model={autoOn ? "Smart Auto" : selectedLabel} className="size-4" />
                  <span className="truncate font-semibold text-[#e7e9ea]">
                    {autoOn ? "Auto" : selectedLabel}
                  </span>
                  {!autoOn && selectedLevel && selectedLevel !== "Auto" && (
                    <span className="shrink-0 text-[#71767b]">{selectedLevel}</span>
                  )}
                  <ChevronDown className="size-3.5 shrink-0 opacity-55" />
                </button>

                {modelOpen &&
                  typeof document !== "undefined" &&
                  createPortal(
                    <div
                      ref={modelAnchor.popupRef as React.RefObject<HTMLDivElement>}
                      data-jarvis-popup
                      className="relative w-[min(17.5rem,calc(100vw-1.5rem))] text-sm text-[#e7e9ea]"
                    >
                      <div className="flex max-h-[min(360px,62vh)] flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#1c1c20] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.75)]">
                        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-2.5 py-2">
                          <Search className="size-3.5 shrink-0 text-[#71767b]" />
                          <input
                            value={modelQuery}
                            onChange={(e) => setModelQuery(e.target.value)}
                            placeholder="Search models…"
                            className="h-5 w-full min-w-0 bg-transparent text-[13px] text-[#e7e9ea] outline-none placeholder:text-[#71767b]"
                            autoFocus
                          />
                        </div>

                        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-2.5 py-1.5">
                          <span className="text-[12px] font-medium">Auto</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={autoOn}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setAuto(!autoOn);
                            }}
                            className={cn(
                              "relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors",
                              autoOn ? "bg-[#1d9bf0]" : "bg-white/15",
                            )}
                          >
                            <span
                              className={cn(
                                "pointer-events-none absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow transition-transform duration-200",
                                autoOn && "translate-x-[14px]",
                              )}
                            />
                          </button>
                        </div>

                        {!autoOn && (
                        <div className="flex max-h-[min(14rem,44dvh)] flex-col gap-0.5 overflow-y-auto p-1 [scrollbar-width:thin]">
                          {filteredModels.map((m) => {
                            const active = m.label === selectedLabel;
                            const downloaded = !!m.installed;
                            const canPull = !m.installed && !!m.pull && !!onPullModel;
                            const job = progressFor(m.id, m.label);
                            const pulling =
                              !!job &&
                              (job.status === "pulling" ||
                                job.status === "queued" ||
                                (job.percent != null && job.percent < 100));
                            const fam = modelFamily(m.label);
                            const previewing = previewModel?.id === m.id;
                            return (
                              <div
                                key={m.id}
                                onMouseEnter={() => showPreview(m)}
                                onMouseLeave={scheduleClearPreview}
                                className={cn(
                                  "flex items-center gap-1.5 rounded-xl px-2 py-1.5 transition",
                                  (active || previewing) && "bg-white/[0.08]",
                                  !active && !previewing && "hover:bg-white/[0.05]",
                                )}
                              >
                                <button
                                  type="button"
                                  disabled={(canPull && !downloaded) || pulling}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    if ((canPull && !downloaded) || pulling) return;
                                    pickModel(m);
                                  }}
                                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                                >
                                  <span className="grid size-6 shrink-0 place-items-center">
                                    <ModelIcon model={m.label} className="size-3.5" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1">
                                      <span className="truncate text-[12.5px] font-semibold tracking-tight">
                                        {m.label}
                                      </span>
                                      {active && <Check className="size-3 shrink-0 opacity-80" />}
                                    </span>
                                    <span className="mt-0.5 block truncate text-[10px] text-[#71767b]">
                                      {providerName(fam)}
                                    </span>
                                  </span>
                                </button>

                                {!downloaded && (
                                  <button
                                    type="button"
                                    title="Install"
                                    aria-label={`Install ${m.label}`}
                                    disabled={!canPull && !pulling}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onPullModel?.(m.id);
                                    }}
                                    className={cn(
                                      "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium",
                                      pulling
                                        ? "bg-emerald-500/25 text-emerald-200"
                                        : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30",
                                      "disabled:opacity-40",
                                    )}
                                  >
                                    <Download className={cn("size-3", pulling && "animate-pulse")} />
                                    {pulling ? "…" : "Install"}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                          {filteredModels.length === 0 && (
                            <div className="px-3 py-5 text-center text-[11px] text-[#71767b]">
                              {modelQuery.trim()
                                ? `No models match "${modelQuery.trim()}"`
                                : "No matching models"}
                            </div>
                          )}
                        </div>
                        )}
                        {autoOn && (
                          <p className="px-3 py-3 text-[12px] text-[#71767b]">
                            Auto picks the best local model. Turn Auto off to choose manually.
                          </p>
                        )}
                      </div>

                      {!autoOn && previewModel && (
                        <div
                          onMouseEnter={() => showPreview(previewModel)}
                          onMouseLeave={scheduleClearPreview}
                          className={cn(
                            "absolute top-0 z-10 flex w-[min(17.5rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#1c1c20] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.75)]",
                            detailSide === "right" ? "left-[calc(100%+8px)]" : "right-[calc(100%+8px)]",
                          )}
                        >
                          {(() => {
                            const m = previewModel;
                            const fam = modelFamily(m.label);
                            const metrics = modelMetrics(m);
                            const badge = fitBadge(m.fit, m.fit_label);
                            const size = formatGb(m.size_gb ?? m.vram_gb ?? null);
                            const ram = formatGb(m.ram_gb);
                            const downloaded = !!m.installed;
                            const canPull = !m.installed && !!m.pull && !!onPullModel;
                            const job = progressFor(m.id, m.label);
                            const pulling =
                              !!job &&
                              (job.status === "pulling" ||
                                job.status === "queued" ||
                                (job.percent != null && job.percent < 100));
                            return (
                              <>
                                <div className="border-b border-white/[0.06] px-3 py-2.5">
                                  <div className="flex items-start gap-2">
                                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.06]">
                                      <ModelIcon model={m.label} className="size-4" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-[13px] font-semibold">{m.label}</div>
                                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[#71767b]">
                                        <span>{providerName(fam)}</span>
                                        {downloaded && (
                                          <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">
                                            Installed
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <p className="mt-2 text-[11px] leading-relaxed text-[#a1a1aa]">
                                    {m.summary ||
                                      m.skill_label ||
                                      `${reasoningCaption(m)} · ${badge.label}${size ? ` · ${size}` : ""}`}
                                  </p>
                                </div>

                                <div className="space-y-2 px-3 py-2.5">
                                  <MetricPills
                                    label="Reasoning"
                                    value={metrics.intelligence}
                                    tone={metrics.intelligenceTone}
                                  />
                                  <MetricPills
                                    label="Speed"
                                    value={metrics.speed}
                                    tone={metrics.speedTone}
                                  />
                                  <MetricPills
                                    label="Footprint"
                                    value={metrics.size}
                                    tone={metrics.sizeTone}
                                  />
                                </div>

                                <div className="space-y-1.5 border-t border-white/[0.06] px-3 py-2.5 text-[11px]">
                                  <div className="flex items-center justify-between gap-2 text-[#a1a1aa]">
                                    <span className="inline-flex items-center gap-1.5">
                                      <HardDrive className="size-3" /> Disk
                                    </span>
                                    <span className="font-medium text-[#e7e9ea]">{size || "—"}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2 text-[#a1a1aa]">
                                    <span className="inline-flex items-center gap-1.5">
                                      <Cpu className="size-3" /> RAM
                                    </span>
                                    <span className="font-medium text-[#e7e9ea]">
                                      {ram ? `≈ ${ram}` : "—"}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2 text-[#a1a1aa]">
                                    <span className="inline-flex items-center gap-1.5">
                                      <Brain className="size-3" /> Level
                                    </span>
                                    <span className="font-medium text-[#e7e9ea]">
                                      {reasoningCaption(m)}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2 text-[#a1a1aa]">
                                    <span>Compatibility</span>
                                    <span
                                      className={cn(
                                        "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                                        badge.tone === "ok" && "bg-emerald-500/20 text-emerald-300",
                                        badge.tone === "tight" && "bg-amber-500/20 text-amber-300",
                                        badge.tone === "bad" && "bg-red-500/20 text-red-300",
                                        badge.tone === "muted" && "bg-white/10 text-[#71767b]",
                                      )}
                                    >
                                      {badge.label}
                                    </span>
                                  </div>
                                  {m.needs && (
                                    <p className="text-[10px] leading-relaxed text-[#71767b]">{m.needs}</p>
                                  )}
                                </div>

                                <div className="mt-auto flex gap-2 border-t border-white/[0.06] px-3 py-2.5">
                                  {downloaded ? (
                                    <button
                                      type="button"
                                      disabled={!onDeleteModel}
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => onDeleteModel?.(m.id)}
                                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500/20 px-3 py-1.5 text-[11px] font-medium text-red-300 hover:bg-red-500/30 disabled:opacity-40"
                                    >
                                      <Trash2 className="size-3.5" />
                                      Delete
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={!canPull && !pulling}
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => onPullModel?.(m.id)}
                                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500/20 px-3 py-1.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                                    >
                                      <Download className={cn("size-3.5", pulling && "animate-pulse")} />
                                      {pulling ? "Installing…" : "Install"}
                                    </button>
                                  )}
                                  {downloaded && (
                                    <button
                                      type="button"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => pickModel(m)}
                                      className="inline-flex flex-1 items-center justify-center rounded-xl bg-white/[0.08] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-white/[0.12]"
                                    >
                                      Select
                                    </button>
                                  )}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>,
                    document.body,
                  )}
              </div>

              <div className="relative">
                <ContextRadial
                  pct={ctxPct}
                  title={`Context ${ctxPct}% · ${ctxUsed.toLocaleString()} / ${ctxLimit.toLocaleString()}`}
                  onClick={openContext}
                />
                {contextOpen && (
                  <div className="absolute bottom-[calc(100%+10px)] left-0 z-50 w-[260px] rounded-xl border border-white/[0.08] bg-[#1c1c20] p-3.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.75)]">
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <ContextRing pct={ctxPct} size={72} stroke={7} />
                        <div className="absolute inset-0 grid place-items-center">
                          <span className="text-sm font-semibold tabular-nums text-[#e7e9ea]">
                            {ctxPct}%
                          </span>
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[#e7e9ea]">Context</div>
                        <p className="mt-0.5 text-[11px] text-[#71767b]">
                          {ctxUsed.toLocaleString()} / {ctxLimit.toLocaleString()} tokens
                        </p>
                        <div className="mt-2.5 space-y-1.5">
                          <ContextBreakdownRow
                            label="Conversation"
                            value={ctxChat}
                            total={ctxLimit}
                            color="bg-sky-400"
                          />
                          <ContextBreakdownRow
                            label="System"
                            value={ctxSystem}
                            total={ctxLimit}
                            color="bg-violet-400"
                          />
                          <ContextBreakdownRow
                            label="Free"
                            value={ctxFree}
                            total={ctxLimit}
                            color="bg-white/25"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                {recording ? (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={onMicClick}
                    className="flex h-8 items-center justify-center gap-[2px] rounded-full border border-white/[0.1] bg-white/[0.06] px-2.5 outline-none transition hover:bg-white/[0.1]"
                    aria-label="Stop listening"
                    title="Stop listening"
                  >
                    {voiceBars.map((h, i) => (
                      <span
                        key={i}
                        className="w-[2.5px] rounded-full bg-white transition-[height] duration-75 ease-out"
                        style={{
                          height: `${Math.max(4, Math.round(h * 18))}px`,
                          opacity: 0.55 + h * 0.45,
                        }}
                      />
                    ))}
                  </button>
                ) : (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={onMicClick}
                    className="flex size-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[#e7e9ea]/85 outline-none transition hover:bg-white/[0.1]"
                    aria-label="Use voice input"
                  >
                    <Mic className="size-3.5" strokeWidth={1.75} />
                  </button>
                )}

                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={onPrimaryAction}
                  disabled={!busy && (disabled || !hasValue)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full outline-none transition",
                    busy
                      ? "bg-[#2a2a2e] text-white hover:bg-[#333338]"
                      : hasValue && !disabled
                        ? "bg-white text-black hover:bg-white/90"
                        : "cursor-default bg-white/[0.08] text-white/35",
                  )}
                  aria-label={busy ? "Stop generating" : "Send prompt"}
                  title={busy ? "Stop" : "Send"}
                >
                  {busy ? (
                    <Square className="size-3 fill-white text-white" strokeWidth={0} />
                  ) : (
                    <ArrowUp className="size-3.5" strokeWidth={2.25} />
                  )}
                </button>
              </div>
            </div>
          </div>
          </div>
        </div>

        {activeAttachment && (
          <AttachmentGalleryModal
            attachment={activeAttachment.attachment}
            originRect={activeAttachment.rect}
            onClose={() => setActiveAttachment(null)}
          />
        )}

      </>
    );
  },
);

PromptInput.displayName = "PromptInput";
