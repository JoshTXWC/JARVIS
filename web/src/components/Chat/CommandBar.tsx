import { useEffect, useMemo, useState } from "react";
import { useStore, nextId, type ChatAttachment } from "../../lib/store";
import { wsClient } from "../../lib/ws";
import {
  deleteLlmModel,
  getHealth,
  getLlmModels,
  getLoadedLlmModels,
  getTools,
  pullLlmModel,
  selectLlmModel,
  setReasoningEffort,
  unloadLlmModel,
  type LlmModelInfo,
  type LoadedLlmModel,
} from "../../lib/api";
import { startWakeListening, stopWakeListening } from "../../lib/wakeMic";
import {
  PromptInput,
  type PromptModelOption,
  type PromptToolOption,
} from "@/components/ui/ai-chat-input";
import ImageActions from "./ImageActions";
import { cn } from "@/lib/utils";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export default function CommandBar({
  embedded = false,
}: {
  embedded?: boolean;
  /** @deprecated Mic status chip removed — kept for call-site compat. */
  compactStatus?: boolean;
}) {
  const [value, setValue] = useState("");
  const [models, setModels] = useState<LlmModelInfo[]>([]);
  const [tools, setTools] = useState<PromptToolOption[]>([]);
  const [autoModel, setAutoModel] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [loadedModels, setLoadedModels] = useState<LoadedLlmModel[]>([]);
  const [reasoningEffort, setReasoning] = useState("medium");
  const [reasoningLevels, setReasoningLevels] = useState<string[]>([
    "low",
    "medium",
    "high",
    "very_high",
  ]);
  const [loadBusy, setLoadBusy] = useState<string | null>(null);

  const pushChat = useStore((s) => s.pushChat);
  const micEnabled = useStore((s) => s.micEnabled);
  const audioLevel = useStore((s) => s.audioLevel);
  const orbState = useStore((s) => s.orbState);
  const health = useStore((s) => s.health);
  const setHealth = useStore((s) => s.setHealth);
  const connected = useStore((s) => s.connected);
  const pending = useStore((s) => s.pendingAttachments);
  const addAttachment = useStore((s) => s.addAttachment);
  const chat = useStore((s) => s.chat);
  const contextUsed = useStore((s) => s.contextUsed);
  const contextLimit = useStore((s) => s.contextLimit);
  const setContextMeter = useStore((s) => s.setContextMeter);

  // Soft local estimate until the server reports real usage.
  useEffect(() => {
    if (contextUsed > 0) return;
    const chars = chat.reduce((n, m) => n + (m.text?.length || 0), 0);
    const est = Math.max(0, Math.round(chars / 4));
    if (est > 0) setContextMeter(est, contextLimit);
  }, [chat, contextUsed, contextLimit, setContextMeter]);
  const imageAttachments = pending.filter((a) => a.type === "image");
  const hasImages = imageAttachments.length > 0;
  const activeModel = selectedModel || health?.model.model || "";
  const activeMeta = models.find((m) => m.id === activeModel);
  const activeLabel = activeMeta?.label || activeModel || "Model";
  const busy =
    orbState === "thinking" || orbState === "executing" || orbState === "speaking";

  const modelLabels = models.map((m) => m.label || m.id);
  const labelToId = new Map(models.map((m) => [m.label || m.id, m.id]));
  const modelOptions = useMemo<PromptModelOption[]>(
    () =>
      models.map((m) => ({
        id: m.id,
        label: m.label || m.id,
        skill: m.skill,
        skill_label: m.skill_label,
        tier: m.tier,
        recommended: m.recommended,
        cloud: m.cloud,
        installed: m.installed,
        summary: m.summary,
        pull: m.pull,
        vram_gb: m.vram_gb,
        ram_gb: m.ram_gb,
        fit: m.fit,
        fit_label: m.fit_label,
        needs: m.needs,
      })),
    [models],
  );

  const refreshCatalog = () => {
    getLlmModels()
      .then((j) => {
        setModels(j.models || []);
        setSelectedModel(j.selected || "");
        setAutoModel(Boolean(j.auto) || (j.selected || "") === "auto");
        if (j.reasoning_effort) setReasoning(String(j.reasoning_effort));
        if (j.reasoning_levels?.length) {
          const order = ["low", "medium", "high", "very_high", "none"];
          setReasoningLevels(order.filter((lvl) => j.reasoning_levels!.includes(lvl)));
        }
      })
      .catch(() => undefined);
  };

  const refreshLoaded = () => {
    getLoadedLlmModels()
      .then((j) => {
        setLoadedModels(j.loaded || []);
        if (j.reasoning_effort) setReasoning(j.reasoning_effort);
        if (j.reasoning_levels?.length) {
          const order = ["low", "medium", "high", "very_high", "none"];
          setReasoningLevels(order.filter((lvl) => j.reasoning_levels!.includes(lvl)));
        }
        if (j.context_length) setContextMeter(contextUsed, j.context_length);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    let liveFetch = true;
    getLlmModels()
      .then((j) => {
        if (!liveFetch) return;
        setModels(j.models || []);
        setSelectedModel(j.selected || "");
        setAutoModel(Boolean(j.auto) || (j.selected || "") === "auto");
        if (j.reasoning_effort) setReasoning(String(j.reasoning_effort));
        if (j.reasoning_levels?.length) {
          const order = ["low", "medium", "high", "very_high", "none"];
          setReasoningLevels(order.filter((lvl) => j.reasoning_levels!.includes(lvl)));
        }
      })
      .catch(() => undefined);
    getTools()
      .then((j) => {
        if (!liveFetch) return;
        setTools(
          (j?.tools || []).map((t: PromptToolOption) => ({
            name: t.name,
            description: t.description,
            permission: t.permission,
            plugin: t.plugin,
          })),
        );
      })
      .catch(() => undefined);
    refreshLoaded();
    return () => {
      liveFetch = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health?.model.model]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey && e.key === "/") ||
        (e.key === "/" && document.activeElement?.tagName !== "TEXTAREA")
      ) {
        e.preventDefault();
        const el = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]');
        el?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onSuggest = (ev: Event) => {
      const text = (ev as CustomEvent).detail?.text as string | undefined;
      if (text) void submitText(text);
    };
    window.addEventListener("jarvis:send-prompt", onSuggest);
    return () => window.removeEventListener("jarvis:send-prompt", onSuggest);
  }, []);

  const fileToDataURL = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });

  const ingestFiles = async (files: File[]) => {
    for (const f of files) {
      const isImage = f.type.startsWith("image/");
      if (isImage && f.size <= MAX_IMAGE_BYTES) {
        const dataUrl = await fileToDataURL(f);
        addAttachment({
          type: "image",
          name: f.name,
          data_url: dataUrl,
          size: f.size,
          mime: f.type,
        });
        continue;
      }
      const form = new FormData();
      form.append("file", f);
      try {
        const { apiFetch: af } = await import("../../lib/session");
        const resp = await af("/api/upload", { method: "POST", body: form });
        const data = await resp.json();
        if (data?.url) {
          addAttachment({
            type: isImage ? "image" : "file",
            name: f.name,
            url: data.url,
            data_url: data.data_url || undefined,
            size: f.size,
            mime: f.type,
          } as ChatAttachment);
        }
      } catch (e) {
        console.error("upload failed", e);
      }
    }
  };

  const submitText = async (text: string, files: File[] = []) => {
    if (files.length) await ingestFiles(files);
    const st = useStore.getState();
    const hasAtt = st.pendingAttachments.length > 0;
    const v = text.trim();
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

  const toggleMic = async () => {
    if (micEnabled) stopWakeListening();
    else await startWakeListening((text) => setValue(text));
  };

  const pickModelByLabel = async (label: string) => {
    const id = labelToId.get(label) || label;
    if (!id || modelBusy) return;
    if (id === activeModel) {
      setAutoModel(id === "auto");
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
      setAutoModel(selected === "auto");
      try {
        const [h, catalog] = await Promise.all([getHealth(), getLlmModels()]);
        setHealth(h);
        setModels(catalog.models || []);
        setSelectedModel(catalog.selected || selected);
        setAutoModel(Boolean(catalog.auto) || (catalog.selected || selected) === "auto");
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
    } catch (e: any) {
      setModelError(e?.message || "Could not select model");
    } finally {
      setModelBusy(false);
    }
  };

  return (
    <div className={cn(embedded ? "bg-transparent" : "bg-[var(--surface)]", "flex flex-col overflow-visible")}>
      {hasImages && (
        <div className="pb-2 shrink-0">
          <ImageActions images={imageAttachments} />
        </div>
      )}

      <div className="flex items-end justify-center min-h-[64px]">
        <PromptInput
          className="w-full"
          value={value}
          onChange={setValue}
          placeholder={connected ? "Ask anything…" : "Reconnecting…"}
          models={modelLabels.length ? modelLabels : [activeLabel]}
          modelOptions={modelOptions.length ? modelOptions : undefined}
          model={activeLabel}
          onModelChange={(label) => void pickModelByLabel(label)}
          autoModel={autoModel}
          onAutoModelChange={(enabled) => {
            if (enabled) {
              const autoLabel =
                models.find((m) => m.id === "auto")?.label || "Smart Auto";
              setAutoModel(true);
              void pickModelByLabel(autoLabel);
              return;
            }
            setAutoModel(false);
            if (activeModel === "auto") {
              const fallback =
                models.find((m) => m.id !== "auto" && m.recommended && m.installed !== false) ||
                models.find((m) => m.id !== "auto");
              if (fallback) void pickModelByLabel(fallback.label || fallback.id);
            }
          }}
          tools={tools}
          onToolSelect={(tool) => {
            const prompt =
              `Please run the tool \`${tool.name}\` if appropriate. ` +
              `Use a real tool call; confirm if required.`;
            void submitText(prompt);
          }}
          listening={micEnabled}
          audioLevel={audioLevel}
          onMicToggle={() => void toggleMic()}
          busy={busy}
          onCancel={() => wsClient.cancel()}
          disabled={!connected || modelBusy}
          hideEffort
          contextUsed={contextUsed}
          contextLimit={contextLimit}
          loadedModels={loadedModels}
          onRefreshLoaded={refreshLoaded}
          reasoningEffort={reasoningEffort}
          reasoningLevels={reasoningLevels}
          modelBusyId={loadBusy}
          onReasoningEffortChange={(effort) => {
            setReasoning(effort);
            void setReasoningEffort(effort).then((res) => {
              if (!res.ok) {
                setModelError(res.error || "Could not set reasoning");
                refreshLoaded();
                return;
              }
              setModelError(null);
              if (res.reasoning_effort) setReasoning(res.reasoning_effort);
            });
          }}
          onUnloadModel={(id) => {
            setLoadBusy(id);
            void unloadLlmModel(id)
              .then((res) => {
                if (!res.ok) {
                  setModelError(res.error || "Unload failed");
                  return;
                }
                setModelError(null);
                refreshLoaded();
              })
              .finally(() => setLoadBusy(null));
          }}
          onPullModel={(id) => {
            setLoadBusy(id);
            setModelError(null);
            void pullLlmModel(id)
              .then((res) => {
                if (!res.ok) {
                  setModelError(res.error || "Download failed");
                  return;
                }
                refreshCatalog();
                refreshLoaded();
              })
              .finally(() => setLoadBusy(null));
          }}
          onDeleteModel={(id) => {
            setLoadBusy(id);
            setModelError(null);
            void deleteLlmModel(id)
              .then((res) => {
                if (!res.ok) {
                  setModelError(res.error || "Uninstall failed");
                  return;
                }
                refreshCatalog();
                refreshLoaded();
              })
              .finally(() => setLoadBusy(null));
          }}
          onSubmit={(msg, meta) => {
            void submitText(msg, meta.attachments);
          }}
        />
      </div>

      {(modelError || activeMeta?.cloud || loadBusy) && (
        <div className="shrink-0 flex items-center justify-end gap-2 pt-2 min-w-0">
          {loadBusy && (
            <span className="text-xs text-muted-foreground truncate max-w-[12rem]">
              Working on {loadBusy}…
            </span>
          )}
          {modelError && (
            <span className="text-xs text-destructive truncate max-w-[10rem]">{modelError}</span>
          )}
          {activeMeta?.cloud && (
            <span className="rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
              cloud
            </span>
          )}
        </div>
      )}
    </div>
  );
}
