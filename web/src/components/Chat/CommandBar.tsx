import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, nextId, type ChatAttachment } from "../../lib/store";
import { wsClient } from "../../lib/ws";
import { getHealth, getLlmModels, selectLlmModel, type LlmModelInfo, type LlmModelsResponse } from "../../lib/api";
import { normalizeWakeWord } from "../../lib/wakeWord";
import { startWakeListening, stopWakeListening } from "../../lib/wakeMic";
import ImageActions from "./ImageActions";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export default function CommandBar({ embedded = false }: { embedded?: boolean }) {
  const [value, setValue] = useState("");
  const [models, setModels] = useState<LlmModelInfo[]>([]);
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);
  const [cloudIds, setCloudIds] = useState<string[]>([]);
  const [hardware, setHardware] = useState<LlmModelsResponse["hardware"]>();
  const [selectedModel, setSelectedModel] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const pushChat = useStore((s) => s.pushChat);
  const micEnabled = useStore((s) => s.micEnabled);
  const micMode = useStore((s) => s.micMode);
  const wakeEnabled = useStore((s) => s.wakeEnabled);
  const micStatus = useStore((s) => s.micStatus);
  const wakeWord = useStore((s) => normalizeWakeWord(s.health?.voice?.wake_word));
  const health = useStore((s) => s.health);
  const setHealth = useStore((s) => s.setHealth);
  const connected = useStore((s) => s.connected);
  const pending = useStore((s) => s.pendingAttachments);
  const addAttachment = useStore((s) => s.addAttachment);
  const removeAttachment = useStore((s) => s.removeAttachment);
  const suggestions = useStore((s) => s.suggestions);

  const imageAttachments = pending.filter((a) => a.type === "image");
  const hasImages = imageAttachments.length > 0;
  const activeModel = selectedModel || health?.model.model || "—";
  const activeMeta = models.find((m) => m.id === activeModel);
  const activeLabel = activeMeta?.label || activeModel;

  const cloudModels = models.filter((m) => m.cloud || cloudIds.includes(m.id));
  const cloudIdSet = new Set(cloudModels.map((m) => m.id));
  const recommended = models.filter(
    (m) => recommendedIds.includes(m.id) && !cloudIdSet.has(m.id),
  );
  const otherModels = models.filter(
    (m) => !recommendedIds.includes(m.id) && !cloudIdSet.has(m.id),
  );

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  useEffect(() => { resizeTextarea(); }, [value]);

  useEffect(() => {
    let live = true;
    getLlmModels()
      .then((j) => {
        if (!live) return;
        setModels(j.models || []);
        setSelectedModel(j.selected || "");
        setRecommendedIds(j.recommended_ids || []);
        setCloudIds(j.cloud_ids || []);
        setHardware(j.hardware);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [health?.model.model]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === "/") || (e.key === "/" && document.activeElement?.tagName !== "TEXTAREA")) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
      if (e.ctrlKey && e.key === "u") {
        e.preventDefault();
        fileInputRef.current?.click();
      }
      if (e.key === "Escape") {
        if (infoId) setInfoId(null);
        else setModelOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [infoId]);

  useLayoutEffect(() => {
    if (!modelOpen) {
      setMenuPos(null);
      setInfoId(null);
      return;
    }
    const place = () => {
      const btn = modelBtnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setMenuPos({
        left: Math.min(r.left, window.innerWidth - 336),
        bottom: window.innerHeight - r.top + 8,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [modelOpen]);

  useEffect(() => {
    if (!modelOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (modelMenuRef.current?.contains(t)) return;
      if (modelBtnRef.current?.contains(t)) return;
      setModelOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [modelOpen]);

  const submit = () => {
    const v = value.trim();
    const st = useStore.getState();
    const hasAtt = st.pendingAttachments.length > 0;
    if (!v && !hasAtt) return;
    if (!v.startsWith("/")) {
      pushChat({
        id: nextId(),
        role: "user",
        text: v || (hasAtt ? "(attached)" : ""),
        ts: Date.now(),
        attachments: hasAtt ? [...st.pendingAttachments] : undefined,
      });
    }
    wsClient.chat(v);
    setValue("");
  };

  const sendSuggestion = (text: string) => {
    const t = text.trim();
    if (!t || !connected) return;
    pushChat({ id: nextId(), role: "user", text: t, ts: Date.now() });
    wsClient.chat(t);
    setValue("");
  };

  const toggleMic = async () => {
    if (micEnabled) stopWakeListening();
    else await startWakeListening((text) => setValue(text));
  };

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) await handleFile(f, addAttachment);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const pickModel = async (id: string) => {
    if (!id || modelBusy) return;
    if (id === activeModel) {
      setModelOpen(false);
      return;
    }
    setModelBusy(true);
    setModelError(null);
    try {
      const res = await selectLlmModel(id);
      if (!res.ok) {
        setModelError(res.error || "Could not select model");
        return;
      }
      const selected = res.selected || id;
      setSelectedModel(selected);
      setModelOpen(false);
      // Re-read server truth so endpoint/provider match the live brain route.
      try {
        const [h, catalog] = await Promise.all([getHealth(), getLlmModels()]);
        setHealth(h);
        setModels(catalog.models || []);
        setSelectedModel(catalog.selected || selected);
        setRecommendedIds(catalog.recommended_ids || []);
        setCloudIds(catalog.cloud_ids || []);
        setHardware(catalog.hardware);
      } catch {
        if (health) {
          setHealth({
            ...health,
            model: {
              ...health.model,
              model: selected,
              endpoint: res.endpoint || health.model.endpoint,
            },
          });
        }
      }
      if (res.cloud) {
        // Soft confirmation in the status strip when GPU locals are being dropped.
        setModelError(null);
      }
    } catch (e: any) {
      setModelError(e?.message || "Could not select model");
    } finally {
      setModelBusy(false);
    }
  };

  const canSend = (!!value.trim() || pending.length > 0) && connected;
  const statusLine = micStatus
    ? micStatus
    : micEnabled || wakeEnabled
      ? `Listening · say “${wakeWord}” to wake`
      : "Mic off · tap the mic to listen";

  return (
    <div className={`${embedded ? "bg-transparent" : "holo-panel"} h-full flex flex-col overflow-visible`}>
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-2.5 pb-1 shrink-0">
          {pending.map((a, i) => (
            <div
              key={i}
              className="group relative flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-lg bg-jarvis-aqua/8 hover:bg-jarvis-aqua/12 transition-all"
              style={{ boxShadow: "inset 0 0 0 1px rgba(165,243,252,0.28)" }}
            >
              {a.type === "image" && (a.data_url || a.url) ? (
                <img
                  src={a.data_url || a.url}
                  alt=""
                  className="w-10 h-10 object-cover rounded-lg shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-jarvis-cyan/5 flex items-center justify-center text-[9px] text-mono text-jarvis-cyan/60 shrink-0">
                  FILE
                </div>
              )}
              <span className="text-[10px] text-mono text-jarvis-aqua/80 truncate max-w-[100px]">
                {a.name}
              </span>
              <button
                onClick={() => removeAttachment(i)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-lg bg-jarvis-ink text-jarvis-danger flex items-center justify-center text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ boxShadow: "inset 0 0 0 1px rgba(251,113,133,0.45)" }}
                title="Remove"
              >−</button>
            </div>
          ))}
        </div>
      )}

      {hasImages && (
        <div className="px-3 pb-1.5 shrink-0">
          <ImageActions images={imageAttachments} />
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2 pb-0.5 shrink-0">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => sendSuggestion(s)}
              disabled={!connected}
              className="group flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-lg text-jarvis-ice/75 hover:text-jarvis-ice text-[11px] transition-all disabled:opacity-30 bg-jarvis-cyan/[0.06] hover:bg-jarvis-cyan/12"
              style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.22)" }}
              title="Send this"
            >
              <span className="text-jarvis-cyan/60 group-hover:text-jarvis-cyan text-[10px]">↳</span>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2.5 px-2.5 py-2.5 shrink-0 mt-auto">
        {/* Model switcher — menu portals to <body> so Floating drag/z-index can't trap clicks */}
        <div className="relative shrink-0">
          <button
            ref={modelBtnRef}
            type="button"
            onClick={() => setModelOpen((v) => !v)}
            disabled={!connected || modelBusy}
            title={activeMeta?.summary || "Switch model"}
            className="h-10 max-w-[168px] px-2.5 rounded-lg flex items-center gap-1.5 text-left transition-all disabled:opacity-40"
            style={{
              background: "rgba(14,24,42,0.65)",
              boxShadow:
                "inset 1px 1px 0 rgba(255,255,255,0.08), inset -1px -1px 0 rgba(0,0,0,0.3), inset 0 0 0 1px rgba(125,211,252,0.18)",
            }}
          >
            <CpuIcon />
            <span className="text-mono text-[10px] text-jarvis-ice/85 truncate tracking-wide">
              {modelBusy ? "…" : activeLabel}
            </span>
            {(activeMeta?.cloud || cloudIdSet.has(activeModel)) && (
              <span className="shrink-0 text-[8px] text-mono uppercase tracking-wider text-jarvis-aqua/80">
                cloud
              </span>
            )}
            <ChevronIcon open={modelOpen} />
          </button>
          {modelOpen && menuPos && createPortal(
            <div
              ref={modelMenuRef}
              className="fixed z-[400] w-[320px] max-h-[min(420px,55vh)] overflow-y-auto rounded-lg p-1.5"
              style={{
                left: menuPos.left,
                bottom: menuPos.bottom,
                background: "rgba(8,14,26,0.97)",
                backdropFilter: "blur(16px)",
                boxShadow:
                  "0 0 0 1px rgba(125,211,252,0.28), 0 18px 40px -12px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)",
              }}
            >
              <div className="px-2 pt-1.5 pb-2 border-b border-jarvis-cyan/10 mb-1">
                <div className="text-[9px] text-mono tracking-[0.25em] uppercase text-jarvis-cyan/45">
                  This computer
                </div>
                <div className="mt-1 text-[11px] text-jarvis-ice/80 leading-snug">
                  {hardware?.has_gpu
                    ? `${hardware.gpu_name || "GPU"} · ${Number(hardware.vram_gb || 0).toFixed(1)} GB${
                        hardware.shared_memory ? " shared" : " VRAM"
                      }${hardware.vendor === "amd" ? " · AMD / Ollama" : hardware.vendor === "intel" ? " · Intel / Ollama" : ""}`
                    : "No GPU detected · CPU / Ollama"}
                </div>
              </div>

              {modelError && (
                <div className="mx-1 mb-1.5 px-2 py-1.5 rounded-lg text-[10px] text-jarvis-warn/90 leading-snug"
                  style={{ background: "rgba(251,191,36,0.08)", boxShadow: "inset 0 0 0 1px rgba(251,191,36,0.25)" }}
                >
                  {modelError}
                </div>
              )}

              {models.length === 0 ? (
                <div className="px-2 py-2 text-[11px] text-jarvis-ice/40">No models listed</div>
              ) : (
                <>
                  {cloudModels.length > 0 && (
                    <ModelSection
                      title="Cloud · Gemini / Grok"
                      models={cloudModels}
                      activeModel={activeModel}
                      infoId={infoId}
                      onInfo={(id) => setInfoId((cur) => (cur === id ? null : id))}
                      onPick={pickModel}
                    />
                  )}
                  {recommended.length > 0 && (
                    <ModelSection
                      title="Recommended · local"
                      models={recommended}
                      activeModel={activeModel}
                      infoId={infoId}
                      onInfo={(id) => setInfoId((cur) => (cur === id ? null : id))}
                      onPick={pickModel}
                    />
                  )}
                  {otherModels.length > 0 && (
                    <ModelSection
                      title={recommended.length || cloudModels.length ? "More local" : "Models"}
                      models={otherModels}
                      activeModel={activeModel}
                      infoId={infoId}
                      onInfo={(id) => setInfoId((cur) => (cur === id ? null : id))}
                      onPick={pickModel}
                    />
                  )}
                </>
              )}
            </div>,
            document.body,
          )}
        </div>

        {/* Attach */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Add image (Ctrl+U)"
          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-all ${
            hasImages ? "text-jarvis-aqua" : "text-jarvis-ice/65 hover:text-jarvis-ice"
          }`}
          style={{
            background: hasImages ? "rgba(165,243,252,0.12)" : "rgba(14,24,42,0.55)",
            boxShadow:
              "inset 1px 1px 0 rgba(255,255,255,0.08), inset -1px -1px 0 rgba(0,0,0,0.28), inset 0 0 0 1px rgba(125,211,252,0.16)",
          }}
        >
          <PlusIcon />
        </button>
        <input ref={fileInputRef} type="file" accept="image/*,*/*" multiple className="hidden" onChange={onFileSelect} />

        {/* Mic */}
        <button
          type="button"
          onClick={toggleMic}
          title={micEnabled ? `Listening (${micMode}) — click to mute` : "Allow listening"}
          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-all ${
            !micEnabled
              ? "text-jarvis-ice/55 hover:text-jarvis-ice"
              : micMode === "armed"
                ? "text-jarvis-aqua animate-pulse_glow"
                : micMode === "speaking"
                  ? "text-jarvis-warn"
                  : "text-jarvis-cyan"
          }`}
          style={{
            background: micEnabled ? "rgba(125,211,252,0.14)" : "rgba(14,24,42,0.55)",
            boxShadow: micEnabled
              ? "0 0 0 1px rgba(125,211,252,0.45), 0 0 18px -4px rgba(125,211,252,0.55), inset 0 1px 0 rgba(255,255,255,0.1)"
              : "inset 1px 1px 0 rgba(255,255,255,0.08), inset -1px -1px 0 rgba(0,0,0,0.28), inset 0 0 0 1px rgba(125,211,252,0.16)",
          }}
        >
          <MicIcon active={micEnabled} />
        </button>

        {/* Soft text field */}
        <div className="flex-1 min-w-0 soft-field flex items-center px-3 py-[7px] gap-2">
          <span className="text-jarvis-cyan/45 text-mono select-none shrink-0">›</span>
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={connected ? "Speak to JARVIS, sir…" : "Reconnecting…"}
            disabled={!connected}
            className="flex-1 bg-transparent outline-none text-jarvis-ice text-[13.5px] placeholder:text-jarvis-ice/30 resize-none overflow-hidden leading-[1.45] min-h-[22px]"
          />
        </div>

        {/* Send */}
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          title="Send"
          className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: canSend
              ? "linear-gradient(145deg, rgba(125,211,252,0.55), rgba(34,211,238,0.28))"
              : "rgba(14,24,42,0.55)",
            boxShadow: canSend
              ? "0 0 0 1px rgba(165,243,252,0.55), 0 0 28px -4px rgba(125,211,252,0.75), inset 0 1px 0 rgba(255,255,255,0.25)"
              : "inset 0 0 0 1px rgba(125,211,252,0.18)",
            color: canSend ? "#031018" : "rgba(224,242,254,0.45)",
          }}
        >
          <SendIcon />
        </button>
      </div>

      <div className="px-3.5 pb-2 text-[10px] text-mono text-jarvis-cyan/45 shrink-0 tracking-wide">
        {statusLine}
      </div>
    </div>
  );
}

async function handleFile(f: File, add: (a: ChatAttachment) => void) {
  const isImage = f.type.startsWith("image/");
  if (isImage && f.size <= MAX_IMAGE_BYTES) {
    const dataUrl = await fileToDataURL(f);
    add({ type: "image", name: f.name, data_url: dataUrl, size: f.size, mime: f.type });
    return;
  }
  const form = new FormData();
  form.append("file", f);
  try {
    const resp = await fetch("/api/upload", { method: "POST", body: form });
    const data = await resp.json();
    if (data?.url) {
      add({
        type: isImage ? "image" : "file",
        name: f.name,
        url: data.url,
        data_url: data.data_url || undefined,
        size: f.size,
        mime: f.type,
      });
    }
  } catch (e) {
    console.error("upload failed", e);
  }
}

function fileToDataURL(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
      {active && <circle cx="12" cy="9" r="1.5" fill="currentColor" />}
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M22 2L11 13" strokeLinecap="round" />
      <path d="M22 2L15 22l-4-9-9-4 20-7z" strokeLinejoin="round" />
    </svg>
  );
}

function CpuIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-jarvis-cyan/70 shrink-0">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      className={`text-jarvis-cyan/50 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6M12 7.5h.01" strokeLinecap="round" />
    </svg>
  );
}

function fitTone(fit?: string) {
  if (fit === "fits") return "text-emerald-300/80";
  if (fit === "tight") return "text-amber-300/80";
  if (fit === "cpu") return "text-jarvis-cyan/70";
  if (fit === "heavy") return "text-rose-300/75";
  return "text-jarvis-ice/50";
}

function ModelSection({
  title,
  models,
  activeModel,
  infoId,
  onInfo,
  onPick,
}: {
  title: string;
  models: LlmModelInfo[];
  activeModel: string;
  infoId: string | null;
  onInfo: (id: string) => void;
  onPick: (id: string) => void;
}) {
  return (
    <div className="mb-1">
      <div className="px-2 py-1.5 text-[9px] text-mono tracking-[0.25em] uppercase text-jarvis-cyan/45">
        {title}
      </div>
      {models.map((m) => {
        const active = m.id === activeModel;
        const open = infoId === m.id;
        return (
          <div key={m.id} className="mb-0.5">
            <div
              className={`flex items-stretch rounded-lg transition-colors ${
                active ? "bg-jarvis-cyan/15" : "hover:bg-jarvis-cyan/10"
              }`}
            >
              <button
                type="button"
                onClick={() => onPick(m.id)}
                className={`flex-1 min-w-0 text-left px-2.5 py-1.5 rounded-lg ${
                  active ? "text-jarvis-ice" : "text-jarvis-ice/75"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-mono truncate">{m.label || m.id}</span>
                  {m.cloud && (
                    <span className="shrink-0 text-[8px] text-mono uppercase tracking-wider text-jarvis-aqua/75">
                      cloud
                    </span>
                  )}
                  {!m.installed && m.id !== "auto" && (
                    <span className="shrink-0 text-[8px] text-mono uppercase tracking-wider text-jarvis-warn/70">
                      {m.cloud ? "key" : "pull"}
                    </span>
                  )}
                </div>
                <div className="text-[9px] text-jarvis-cyan/55 truncate mt-0.5">
                  {m.skill_label || m.skill || "model"}
                  {m.cloud
                    ? ` · ${m.provider_label || "cloud"}`
                    : m.vram_gb
                      ? ` · ~${m.vram_gb} GB`
                      : ""}
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onInfo(m.id);
                }}
                title="Requirements & skill"
                className={`shrink-0 w-8 flex items-center justify-center rounded-lg transition-colors ${
                  open ? "text-jarvis-ice bg-jarvis-cyan/20" : "text-jarvis-cyan/45 hover:text-jarvis-ice"
                }`}
              >
                <InfoIcon />
              </button>
            </div>
            {open && (
              <div
                className="mx-1 mb-1 mt-0.5 px-2.5 py-2 rounded-lg text-[10px] leading-relaxed text-jarvis-ice/75"
                style={{
                  background: "rgba(14,24,42,0.72)",
                  boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.16)",
                }}
              >
                <div className="text-jarvis-ice/90">{m.summary || m.label || m.id}</div>
                <div className="mt-1.5 space-y-1">
                  <InfoRow k="Skill" v={m.skill_label || m.skill || "—"} />
                  <InfoRow k="Best for" v={(m.best_for || []).join(", ") || "—"} />
                  <InfoRow k="Needs" v={m.needs || "—"} />
                  <InfoRow
                    k="Tools"
                    v={m.tool_calling ? String(m.tool_calling) : "—"}
                  />
                  <InfoRow
                    k="This PC"
                    v={m.fit_label || m.fit || "—"}
                    valueClass={fitTone(m.fit)}
                  />
                  {m.cloud && m.api_key_env && (
                    <InfoRow k="Key" v={`${m.api_key_env} in .env`} mono />
                  )}
                  {m.pull && !m.installed && (
                    <InfoRow k="Install" v={m.pull} mono />
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InfoRow({
  k,
  v,
  mono,
  valueClass,
}: {
  k: string;
  v: string;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 w-[52px] text-mono uppercase tracking-wider text-jarvis-cyan/40 text-[8px] pt-0.5">
        {k}
      </span>
      <span className={`${mono ? "text-mono text-[9px]" : ""} ${valueClass || ""}`}>{v}</span>
    </div>
  );
}
