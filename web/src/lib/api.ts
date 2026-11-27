import type { Health, SystemStats } from "./store";
import { apiFetch } from "./session";

export async function getHealth(): Promise<Health> {
  const r = await fetch("/api/health");
  if (!r.ok) throw new Error(`Health request failed: ${r.status}`);
  return r.json();
}

export async function openBarehands(): Promise<{
  ok: boolean;
  url?: string;
  error?: string;
  running?: boolean;
}> {
  const r = await apiFetch("/api/barehands/open", { method: "POST" });
  return r.json();
}

export async function closeBarehands(): Promise<{ ok: boolean; error?: string }> {
  const r = await apiFetch("/api/barehands/close", { method: "POST" });
  return r.json();
}

export async function getBarehandsStatus(): Promise<{
  enabled?: boolean;
  running?: boolean;
  url?: string;
  keywords?: string[];
}> {
  const r = await apiFetch("/api/barehands/status");
  return r.json();
}

export async function getStats(): Promise<SystemStats> {
  const r = await apiFetch("/api/stats");
  return r.json();
}

export async function getProcesses(limit = 12) {
  const r = await apiFetch(`/api/processes?limit=${limit}`);
  return r.json();
}

export async function searchMemory(q: string) {
  const r = await apiFetch(`/api/memory/search?q=${encodeURIComponent(q)}`);
  return r.json();
}

export async function getAgents() {
  const r = await apiFetch("/api/agents");
  return r.json();
}

export async function getTools() {
  const r = await apiFetch("/api/tools");
  return r.json();
}

export async function getPlugins() {
  const r = await apiFetch("/api/plugins");
  return r.json();
}

export async function cleanSlate() {
  const r = await apiFetch("/api/cleanslate", { method: "POST" });
  return r.json();
}

export interface ImageModelInfo {
  key: string;
  label: string;
  family: string;
  description: string;
  repo: string;
  file: string;
  base_repo: string;
  local_path: string;
  downloaded: boolean;
  loaded: boolean;
  default_steps: number;
  default_guidance: number;
}

export async function getImageModels(): Promise<{ selected: string; models: ImageModelInfo[] }> {
  const r = await apiFetch("/api/image-models");
  return r.json();
}

export async function selectImageModel(model: string): Promise<{ ok: boolean; selected?: string; error?: string }> {
  const r = await apiFetch("/api/image-models/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  return r.json();
}

export interface LlmModelInfo {
  id: string;
  label?: string;
  skill?: string;
  skill_label?: string;
  vram_gb?: number;
  ram_gb?: number;
  tier?: string;
  best_for?: string[];
  needs?: string;
  pull?: string | null;
  tool_calling?: string;
  recommended?: boolean;
  summary?: string;
  installed?: boolean;
  installed_id?: string;
  fit?: "fits" | "tight" | "heavy" | "cpu" | string;
  fit_label?: string;
  active?: boolean;
  owned_by?: string;
  cloud?: boolean;
  section?: string;
  provider_label?: string;
  api_key_env?: string;
}

export interface LlmModelsResponse {
  selected: string;
  provider: string;
  endpoint: string;
  auto?: boolean;
  installed?: string[];
  recommended_ids?: string[];
  cloud_ids?: string[];
  hardware?: {
    gpu_name?: string | null;
    vram_gb?: number | null;
    has_gpu?: boolean;
    vendor?: string | null;
    shared_memory?: boolean;
  };
  skills?: { id: string; label: string }[];
  models: LlmModelInfo[];
  reasoning_effort?: string;
  reasoning_levels?: string[];
}

export async function getLlmModels(): Promise<LlmModelsResponse> {
  const r = await apiFetch("/api/models");
  return r.json();
}

export async function selectLlmModel(model: string): Promise<{
  ok: boolean;
  selected?: string;
  endpoint?: string;
  api_key_env?: string;
  cloud?: boolean;
  persisted?: boolean;
  error?: string;
}> {
  try {
    const r = await apiFetch("/api/models/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok && data?.ok !== true) {
      return {
        ok: false,
        error: data?.error || `Select failed (${r.status})`,
      };
    }
    return data;
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error selecting model" };
  }
}

export interface LoadedLlmModel {
  id: string;
  name: string;
  backend?: string;
  size_gb?: number | null;
  size_vram_gb?: number | null;
  family?: string;
  parameter_size?: string;
  quantization?: string;
  context_length?: number;
  expires_at?: string;
  status?: string;
  unloadable?: boolean;
}

export interface LoadedModelsResponse {
  ok: boolean;
  source?: string;
  loaded: LoadedLlmModel[];
  available?: LoadedLlmModel[];
  context_length?: number;
  selected?: string;
  endpoint?: string;
  reasoning_effort?: string;
  reasoning_levels?: string[];
}

export async function getLoadedLlmModels(): Promise<LoadedModelsResponse> {
  const r = await apiFetch("/api/models/loaded");
  const data = await r.json().catch(() => ({}));
  return {
    ok: !!data?.ok,
    source: data?.source,
    loaded: Array.isArray(data?.loaded) ? data.loaded : [],
    available: Array.isArray(data?.available) ? data.available : [],
    context_length: data?.context_length,
    selected: data?.selected,
    endpoint: data?.endpoint,
    reasoning_effort: data?.reasoning_effort,
    reasoning_levels: Array.isArray(data?.reasoning_levels) ? data.reasoning_levels : undefined,
  };
}

export async function unloadLlmModel(model: string): Promise<{
  ok: boolean;
  unloaded?: string;
  backend?: string;
  error?: string;
}> {
  try {
    const r = await apiFetch("/api/models/unload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok && data?.ok !== true) {
      return { ok: false, error: data?.error || `Unload failed (${r.status})` };
    }
    return data;
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error unloading model" };
  }
}

export async function loadLlmModel(model: string): Promise<{
  ok: boolean;
  loaded?: string;
  backend?: string;
  error?: string;
}> {
  try {
    const r = await apiFetch("/api/models/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok && data?.ok !== true) {
      return { ok: false, error: data?.error || `Load failed (${r.status})` };
    }
    return data;
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error loading model" };
  }
}

export async function setReasoningEffort(effort: string): Promise<{
  ok: boolean;
  reasoning_effort?: string;
  persisted?: boolean;
  error?: string;
}> {
  try {
    const r = await apiFetch("/api/models/reasoning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effort }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok && data?.ok !== true) {
      return { ok: false, error: data?.error || `Reasoning update failed (${r.status})` };
    }
    return data;
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error setting reasoning" };
  }
}

export async function pullLlmModel(model: string): Promise<{
  ok: boolean;
  pulled?: string;
  error?: string;
}> {
  try {
    const r = await apiFetch("/api/models/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok && data?.ok !== true) {
      return { ok: false, error: data?.error || `Pull failed (${r.status})` };
    }
    return data;
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error pulling model" };
  }
}

// ── Image analysis / img2img / image→3D ─────────────────────────────────

/**
 * Upload an image file to the server.
 * Returns { ok, name, url, data_url, size, mime }.
 */
export async function uploadImage(file: File): Promise<{
  ok: boolean;
  name: string;
  url: string;
  data_url?: string;
  size: number;
  mime: string;
}> {
  const form = new FormData();
  form.append("file", file);
  const r = await apiFetch("/api/upload", { method: "POST", body: form });
  return r.json();
}

/**
 * Send an image to the LLM for vision analysis.
 * Returns { ok, analysis }.
 */
export async function analyzeImage(
  file: File,
  prompt?: string
): Promise<{ ok: boolean; analysis?: string; error?: string }> {
  const form = new FormData();
  form.append("file", file);
  if (prompt) form.append("prompt", prompt);
  const r = await apiFetch("/api/analyze-image", { method: "POST", body: form });
  return r.json();
}

/**
 * Convert an image to a 3D model via SF3D / TripoSR.
 * Returns { ok, result }.
 */
export async function imageTo3D(
  file: File
): Promise<{ ok: boolean; result?: string; error?: string }> {
  const form = new FormData();
  form.append("file", file);
  const r = await apiFetch("/api/image-to-3d", { method: "POST", body: form });
  return r.json();
}

/**
 * Image-to-image generation: upload an init image + prompt, returns a new
 * image generated using FLUX img2img mode.
 * Returns { ok, result }.
 */
export async function img2img(
  file: File,
  prompt: string,
  strength = 0.65,
  steps = 4,
  guidance = 4.0
): Promise<{ ok: boolean; result?: string; error?: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("prompt", prompt);
  form.append("strength", String(strength));
  form.append("steps", String(steps));
  form.append("guidance_scale", String(guidance));
  const r = await apiFetch("/api/img2img", { method: "POST", body: form });
  return r.json();
}

// ── Local model manager (Ollama) ────────────────────────────────────────

export interface OllamaStatus {
  ok: boolean;
  base: string;
  running: boolean;
  version?: string | null;
  installed: boolean;
  download_url: string;
  active_model: string;
  active_endpoint: string;
}

export interface OllamaInstalledModel {
  name: string;
  size_gb?: number | null;
  modified_at?: string;
  family?: string;
  parameter_size?: string;
  quantization?: string;
  running?: boolean;
  active?: boolean;
}

export interface OllamaLibraryModel {
  id: string;
  label: string;
  size_gb?: number | null;
  tags: string[];
  summary: string;
  recommended?: boolean;
  fit?: string;
  installed?: boolean;
}

export interface OllamaPullJob {
  name: string;
  status: "queued" | "pulling" | "success" | "error" | "cancelled" | string;
  detail: string;
  completed: number;
  total: number;
  percent: number | null;
  error: string;
}

async function jsonOrError<T>(r: Response): Promise<T & { ok: boolean; error?: string }> {
  const data = await r.json().catch(() => ({}));
  if (!r.ok && data?.ok !== true) {
    return { ...(data || {}), ok: false, error: data?.error || `Request failed (${r.status})` };
  }
  return data;
}

async function postModel(path: string, model: string) {
  try {
    const r = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    return jsonOrError<Record<string, unknown>>(r);
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  return jsonOrError<OllamaStatus>(await apiFetch("/api/ollama/status"));
}

export async function startOllama() {
  try {
    return jsonOrError<{ status: string }>(await apiFetch("/api/ollama/start", { method: "POST" }));
  } catch (e: any) {
    return { ok: false, status: "", error: e?.message || "Network error" };
  }
}

export async function getOllamaModels(): Promise<{
  ok: boolean;
  error?: string;
  installed: OllamaInstalledModel[];
  active_model?: string;
}> {
  const d = await jsonOrError<{ installed: OllamaInstalledModel[]; active_model?: string }>(
    await apiFetch("/api/ollama/models"),
  );
  return { ...d, installed: Array.isArray(d.installed) ? d.installed : [] };
}

export async function getOllamaLibrary(): Promise<{ ok: boolean; models: OllamaLibraryModel[]; browse_url?: string }> {
  const d = await jsonOrError<{ models: OllamaLibraryModel[]; browse_url?: string }>(
    await apiFetch("/api/ollama/library"),
  );
  return { ...d, models: Array.isArray(d.models) ? d.models : [] };
}

export async function getOllamaPulls(): Promise<OllamaPullJob[]> {
  const d = await jsonOrError<{ jobs: OllamaPullJob[] }>(await apiFetch("/api/ollama/pulls"));
  return Array.isArray(d.jobs) ? d.jobs : [];
}

export const pullOllamaModel = (model: string) => postModel("/api/ollama/pull", model);
export const cancelOllamaPull = (model: string) => postModel("/api/ollama/pull/cancel", model);
export const deleteOllamaModel = (model: string) => postModel("/api/ollama/delete", model);
