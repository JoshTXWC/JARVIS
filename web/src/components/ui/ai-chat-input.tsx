/**
 * Cursor-style chat composer for JARVIS.
 * Rounded input · + tools menu · mode pill · model picker popup · mic + send.
 */
import * as React from "react";
import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import {
  ChevronDown,
  ImagePlus,
  Mic,
  Monitor,
  Plus,
  Search,
  Star,
  Upload,
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
  CircleMinus,
  Download,
  Brain,
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

function saveStringList(key: string, values: string[]) {
  localStorage.setItem(key, JSON.stringify(values));
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
  if (m.skill === "speed") return "Fast";
  if (m.cloud) return "Cloud";
  if (m.tier === "light") return "Fast";
  return "Medium";
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
      loadedModels = [],
      onUnloadModel,
      onPullModel,
      onRefreshLoaded,
      reasoningEffort = "none",
      reasoningLevels = ["none", "low", "medium", "high"],
      onReasoningEffortChange,
    },
    ref,
  ) => {
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
    const [reasoningOpen, setReasoningOpen] = useState(false);
    const [modelQuery, setModelQuery] = useState("");
    const [toolQuery, setToolQuery] = useState("");
    const [toolFilter, setToolFilter] = useState<"fav" | "all">("all");
    const [toolFavs, setToolFavs] = useState<string[]>(() => loadStringList(TOOL_FAV_KEY));
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
      if (!modelOpen && !toolsOpen && !contextOpen && !reasoningOpen) return;
      const onDown = (e: MouseEvent) => {
        if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
          setModelOpen(false);
          setToolsOpen(false);
          setContextOpen(false);
          setReasoningOpen(false);
        }
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setModelOpen(false);
          setToolsOpen(false);
          setContextOpen(false);
          setReasoningOpen(false);
        }
      };
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("mousedown", onDown);
        document.removeEventListener("keydown", onKey);
      };
    }, [modelOpen, toolsOpen, contextOpen, reasoningOpen]);

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

    const filteredModels = useMemo(() => {
      const needle = modelQuery.trim().toLowerCase();
      // Downloaded locals/cloud + catalog entries that can still be pulled.
      let list = catalog.filter((m) => {
        if (m.id === "auto") return false;
        if (m.installed) return true;
        if (m.cloud) return true;
        if (m.pull) return true;
        return false;
      });
      if (needle) {
        list = list.filter(
          (m) =>
            m.label.toLowerCase().includes(needle) ||
            (m.skill_label || "").toLowerCase().includes(needle) ||
            (m.summary || "").toLowerCase().includes(needle) ||
            m.id.toLowerCase().includes(needle),
        );
      }
      return [...list].sort((a, b) => {
        const ai = a.installed || a.cloud ? 0 : 1;
        const bi = b.installed || b.cloud ? 0 : 1;
        if (ai !== bi) return ai - bi;
        return a.label.localeCompare(b.label);
      });
    }, [catalog, modelQuery]);

    const filteredTools = useMemo(() => {
      const needle = toolQuery.trim().toLowerCase();
      let list = tools;
      if (toolFilter === "fav") list = list.filter((t) => toolFavs.includes(t.name));
      if (needle) {
        list = list.filter(
          (t) =>
            t.name.toLowerCase().includes(needle) ||
            (t.description || "").toLowerCase().includes(needle) ||
            (t.plugin || "").toLowerCase().includes(needle),
        );
      }
      return [...list].sort((a, b) => {
        const af = toolFavs.includes(a.name) ? 0 : 1;
        const bf = toolFavs.includes(b.name) ? 0 : 1;
        if (af !== bf) return af - bf;
        return a.name.localeCompare(b.name);
      });
    }, [tools, toolQuery, toolFilter, toolFavs]);

    const toggleToolFav = (name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setToolFavs((prev) => {
        const next = prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name];
        saveStringList(TOOL_FAV_KEY, next);
        return next;
      });
    };

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
      setReasoningOpen(false);
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
      setReasoningOpen(false);
    };

    const openModels = () => {
      setModelOpen((v) => !v);
      setToolsOpen(false);
      setContextOpen(false);
      setReasoningOpen(false);
      setModelQuery("");
    };

    const openContext = () => {
      setContextOpen((v) => !v);
      setModelOpen(false);
      setToolsOpen(false);
      setReasoningOpen(false);
    };

    const openReasoning = () => {
      setReasoningOpen((v) => !v);
      setModelOpen(false);
      setToolsOpen(false);
      setContextOpen(false);
    };

    const favToolCount = toolFavs.filter((n) => tools.some((t) => t.name === n)).length;
    const reasoningLabel =
      !reasoningEffort || reasoningEffort === "none"
        ? "Reasoning"
        : `Reason ${String(reasoningEffort)}`;
    const ctxLimit = Math.max(1, contextLimit || 8192);
    const ctxUsed = Math.max(0, contextUsed || 0);
    const ctxPct = Math.min(100, Math.round((ctxUsed / ctxLimit) * 100));
    const ctxTone =
      ctxPct >= 90 ? "text-red-400" : ctxPct >= 70 ? "text-amber-300" : "text-[#71767b]";

    return (
      <>
        <div
          ref={(node) => {
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
            (rootRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }}
          className={cn("relative w-full max-w-[720px]", className)}
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
              className="w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] leading-6 text-[#e7e9ea] outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-[#71767b] disabled:opacity-60"
            />

            <div className="flex items-center gap-1.5 px-3 pb-3 pt-1">
              <div className="relative">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openTools}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.06] text-[#e7e9ea]/80 transition hover:bg-white/[0.1] hover:text-white",
                    toolsOpen && "bg-white/[0.12] text-white",
                  )}
                  aria-label="Attach or use a tool"
                >
                  <Plus className="size-4" strokeWidth={1.75} />
                </button>

                {toolsOpen && (
                  <div className="absolute bottom-[calc(100%+10px)] left-0 z-50 w-[300px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#242428] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.75)]">
                    <div className="border-b border-white/[0.06] p-2.5">
                      <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-2.5 py-2 text-[#71767b]">
                        <Search className="size-3.5 shrink-0" />
                        <input
                          value={toolQuery}
                          onChange={(e) => setToolQuery(e.target.value)}
                          placeholder="Search tools"
                          className="w-full bg-transparent text-sm text-[#e7e9ea] outline-none placeholder:text-[#71767b]"
                          autoFocus
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
                      <div className="inline-flex rounded-full bg-white/[0.04] p-0.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setToolFilter("fav")}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[#71767b]",
                            toolFilter === "fav" && "bg-white/[0.1] text-white",
                          )}
                        >
                          <Star className="size-3" />
                          fav {favToolCount}
                        </button>
                        <button
                          type="button"
                          onClick={() => setToolFilter("all")}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[#71767b]",
                            toolFilter === "all" && "bg-white/[0.1] text-white",
                          )}
                        >
                          all {tools.length}
                        </button>
                      </div>
                    </div>

                    <div className="max-h-72 overflow-y-auto px-1.5 pb-2">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => fileInputRef.current?.click()}
                        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm text-[#e7e9ea] hover:bg-white/[0.06]"
                      >
                        <span className="flex size-8 items-center justify-center rounded-full bg-sky-500/15 text-sky-300">
                          <ImagePlus className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">Upload images</span>
                          <span className="block truncate text-xs text-[#71767b]">
                            Attach photos for vision
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => anyFileInputRef.current?.click()}
                        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm text-[#e7e9ea] hover:bg-white/[0.06]"
                      >
                        <span className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white/70">
                          <Upload className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">Upload files</span>
                          <span className="block truncate text-xs text-[#71767b]">
                            PDFs, docs, and more
                          </span>
                        </span>
                      </button>

                      {filteredTools.length > 0 && (
                        <div className="my-1.5 mx-2 border-t border-white/[0.06]" />
                      )}

                      {filteredTools.map((tool) => {
                        const Icon = toolIcon(tool.name);
                        const fav = toolFavs.includes(tool.name);
                        return (
                          <button
                            key={tool.name}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              onToolSelect?.(tool);
                              setToolsOpen(false);
                            }}
                            className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm text-[#e7e9ea] hover:bg-white/[0.06]"
                          >
                            <span className="flex size-8 items-center justify-center rounded-full bg-white/[0.06] text-white/75">
                              <Icon className="size-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {prettyToolName(tool.name)}
                              </span>
                              <span className="block truncate text-xs text-[#71767b]">
                                {tool.description || tool.plugin || tool.permission || "Tool"}
                              </span>
                            </span>
                            <span
                              role="button"
                              tabIndex={-1}
                              onClick={(e) => toggleToolFav(tool.name, e)}
                              className="opacity-70 hover:opacity-100"
                              aria-label={fav ? "Unfavorite" : "Favorite"}
                            >
                              <Star
                                className={cn(
                                  "size-3.5",
                                  fav ? "fill-amber-400 text-amber-400" : "text-[#71767b]",
                                )}
                              />
                            </span>
                          </button>
                        );
                      })}

                      {tools.length === 0 && (
                        <div className="px-3 py-4 text-center text-xs text-[#71767b]">
                          Tools will appear once JARVIS connects.
                        </div>
                      )}
                      {tools.length > 0 && filteredTools.length === 0 && (
                        <div className="px-3 py-4 text-center text-xs text-[#71767b]">
                          No matching tools
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {onReasoningEffortChange && (
                <div className="relative">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={openReasoning}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 text-[13px] font-medium text-[#e7e9ea]/90 transition hover:bg-white/[0.08]",
                      reasoningOpen && "bg-white/[0.1]",
                    )}
                    aria-label={`Reasoning level. Current: ${reasoningEffort || "none"}`}
                  >
                    <Brain className="size-3.5 opacity-80" />
                    <span className="capitalize">{reasoningLabel}</span>
                    <ChevronDown className="size-3.5 opacity-60" />
                  </button>
                  {reasoningOpen && (
                    <div className="absolute bottom-[calc(100%+10px)] left-0 z-50 min-w-[160px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#242428] p-1 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.75)]">
                      {(reasoningLevels.length
                        ? reasoningLevels
                        : ["none", "low", "medium", "high"]
                      ).map((lvl) => {
                        const active = (reasoningEffort || "none") === lvl;
                        return (
                          <button
                            key={lvl}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              onReasoningEffortChange(lvl);
                              setReasoningOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center rounded-xl px-3 py-2 text-left text-sm capitalize text-[#e7e9ea]/85 hover:bg-white/[0.06]",
                              active && "bg-white/[0.08] text-white",
                            )}
                          >
                            {lvl}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="relative">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openContext}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.08] bg-transparent px-2 text-[12px] transition hover:bg-white/[0.06]",
                    contextOpen && "bg-white/[0.08]",
                    ctxTone,
                  )}
                  aria-label={`Context usage ${ctxUsed} of ${ctxLimit} tokens`}
                  title="Context usage"
                >
                  <Database className="size-3.5 shrink-0 opacity-80" />
                  <span className="tabular-nums font-medium">{ctxPct}%</span>
                </button>
                {contextOpen && (
                  <div className="absolute bottom-[calc(100%+10px)] left-0 z-50 w-[260px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#242428] p-3 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.75)]">
                    <div className="text-sm font-medium text-[#e7e9ea]">Context</div>
                    <p className="mt-1 text-[12px] text-[#71767b]">
                      Tokens in the active conversation window versus the model limit.
                    </p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          ctxPct >= 90
                            ? "bg-red-400"
                            : ctxPct >= 70
                              ? "bg-amber-400"
                              : "bg-[#1d9bf0]",
                        )}
                        style={{ width: `${ctxPct}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[12px] tabular-nums text-[#e7e9ea]/85">
                      <span>{ctxUsed.toLocaleString()} used</span>
                      <span className="text-[#71767b]">{ctxLimit.toLocaleString()} max</span>
                    </div>
                    {loadedModels[0]?.context_length ? (
                      <div className="mt-2 text-[11px] text-[#71767b]">
                        Loaded ctx · {loadedModels[0].context_length.toLocaleString()}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="relative min-w-0">
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

                {modelOpen && (
                  <div className="absolute bottom-[calc(100%+10px)] left-0 z-50 w-[320px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#242428] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.75)]">
                    <div className="space-y-2 border-b border-white/[0.06] p-2.5">
                      <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-2.5 py-2 text-[#71767b]">
                        <Search className="size-3.5 shrink-0" />
                        <input
                          value={modelQuery}
                          onChange={(e) => setModelQuery(e.target.value)}
                          placeholder="Search models"
                          className="w-full bg-transparent text-sm text-[#e7e9ea] outline-none placeholder:text-[#71767b]"
                          autoFocus
                        />
                      </div>
                      <div className="flex items-center justify-between px-1">
                        <span className="text-sm font-medium text-[#e7e9ea]">Auto</span>
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
                            "relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors",
                            autoOn ? "bg-[#1d9bf0]" : "bg-white/15",
                          )}
                        >
                          <span
                            className={cn(
                              "pointer-events-none absolute top-[2px] left-[2px] size-[18px] rounded-full bg-white shadow transition-transform duration-200",
                              autoOn && "translate-x-[18px]",
                            )}
                          />
                        </button>
                      </div>
                    </div>

                    <div className="max-h-80 overflow-y-auto px-1.5 py-2">
                      {filteredModels.map((m) => {
                        const level = modelLevel(m);
                        const active = !autoOn && m.label === selectedLabel;
                        const downloaded = !!m.installed || !!m.cloud;
                        const resident = loadedModels.some(
                          (lm) => lm.id === m.id || lm.name === m.label || lm.name === m.id,
                        );
                        const canPull = !m.installed && !m.cloud && !!m.pull && !!onPullModel;
                        return (
                          <div
                            key={m.id}
                            className={cn(
                              "group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left",
                              active && "bg-white/[0.06]",
                              downloaded && "hover:bg-white/[0.06]",
                            )}
                          >
                            <button
                              type="button"
                              disabled={canPull}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                if (canPull) return;
                                pickModel(m);
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
                            >
                              <ModelIcon model={m.label} className={cn(!downloaded && "opacity-60")} />
                              <span className="min-w-0 flex-1 truncate text-sm">
                                <span
                                  className={cn(
                                    "font-semibold",
                                    downloaded ? "text-[#e7e9ea]" : "text-[#e7e9ea]/75",
                                  )}
                                >
                                  {m.label}
                                </span>{" "}
                                <span className="text-[#71767b]">{level}</span>
                                {resident && (
                                  <span className="ml-1 text-[10px] uppercase tracking-wide text-emerald-400/90">
                                    loaded
                                  </span>
                                )}
                                {m.cloud && (
                                  <span className="ml-1 text-[10px] uppercase tracking-wide text-sky-400/90">
                                    cloud
                                  </span>
                                )}
                                {canPull && (
                                  <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-400/90">
                                    download
                                  </span>
                                )}
                              </span>
                            </button>
                            {canPull && (
                              <button
                                type="button"
                                title="Download model"
                                aria-label={`Download ${m.label}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPullModel?.(m.id);
                                }}
                                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[#71767b] hover:bg-white/[0.08] hover:text-emerald-300"
                              >
                                <Download className="size-3.5" />
                              </button>
                            )}
                            {downloaded && !m.cloud && resident && onUnloadModel && (
                              <button
                                type="button"
                                title="Unload from memory"
                                aria-label={`Unload ${m.label}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUnloadModel(m.id);
                                }}
                                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[#71767b] hover:bg-white/[0.08] hover:text-red-300"
                              >
                                <CircleMinus className="size-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {filteredModels.length === 0 && (
                        <div className="px-3 py-4 text-center text-xs text-[#71767b]">
                          No matching models
                        </div>
                      )}
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
