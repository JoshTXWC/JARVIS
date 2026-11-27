/**
 * MODELS — local model manager in the spirit of the Ollama desktop app:
 * see installed models, switch the active chat model, pull new ones with
 * live progress, unload from memory, and delete from disk.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelOllamaPull,
  deleteOllamaModel,
  getOllamaLibrary,
  getOllamaModels,
  getOllamaPulls,
  getOllamaStatus,
  pullOllamaModel,
  selectLlmModel,
  startOllama,
  unloadLlmModel,
  type OllamaInstalledModel,
  type OllamaLibraryModel,
  type OllamaPullJob,
  type OllamaStatus,
} from "../../lib/api";
import { useStore } from "../../lib/store";

type Tab = "installed" | "library";

export default function ModelManager() {
  const [tab, setTab] = useState<Tab>("installed");
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [installed, setInstalled] = useState<OllamaInstalledModel[]>([]);
  const [library, setLibrary] = useState<OllamaLibraryModel[]>([]);
  const [jobs, setJobs] = useState<OllamaPullJob[]>([]);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const setHealth = useStore((s) => s.setHealth);
  const prevActive = useRef<string>("");

  const refresh = useCallback(async () => {
    try {
      const st = await getOllamaStatus();
      setStatus(st);
      if (!st.running) {
        setInstalled([]);
        return;
      }
      const [m, lib, pj] = await Promise.all([getOllamaModels(), getOllamaLibrary(), getOllamaPulls()]);
      setInstalled(m.installed);
      setLibrary(lib.models);
      setJobs(pj);
    } catch (e: any) {
      setMessage({ text: e?.message || "Could not reach JARVIS backend", error: true });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll pull progress while anything is downloading.
  const pulling = jobs.some((j) => j.status === "pulling" || j.status === "queued");
  useEffect(() => {
    if (!pulling) return;
    const id = setInterval(async () => {
      const pj = await getOllamaPulls().catch(() => [] as OllamaPullJob[]);
      setJobs(pj);
      if (!pj.some((j) => j.status === "pulling" || j.status === "queued")) void refresh();
    }, 1000);
    return () => clearInterval(id);
  }, [pulling, refresh]);

  const active = status?.active_model || "";
  useEffect(() => {
    if (active && prevActive.current && prevActive.current !== active) {
      setMessage({ text: `Active model: ${active}` });
    }
    prevActive.current = active;
  }, [active]);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => {
    setBusy(key);
    setMessage(null);
    const res = await fn();
    setBusy(null);
    setMessage(res.ok ? { text: okText } : { text: res.error || "Failed", error: true });
    await refresh();
    return res.ok;
  };

  const onUse = (name: string) =>
    run(`use:${name}`, () => selectLlmModel(name), `Now chatting with ${name}`).then((ok) => {
      if (ok) {
        import("../../lib/api").then(({ getHealth }) => getHealth().then(setHealth).catch(() => undefined));
      }
    });
  const onPull = (name: string) => {
    const n = name.trim();
    if (!n) return;
    return run(`pull:${n}`, () => pullOllamaModel(n), `Downloading ${n}…`);
  };
  const onDelete = (name: string) => {
    if (!window.confirm(`Delete ${name} from disk?`)) return;
    return run(`del:${name}`, () => deleteOllamaModel(name), `Deleted ${name}`);
  };

  const libFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library.filter(
      (m) => !q || m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q) || m.tags.some((t) => t.includes(q)),
    );
  }, [library, query]);

  const visibleJobs = jobs.filter((j) => j.status !== "success");

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 text-[14px]">
      <StatusRow status={status} onStart={() => run("start", startOllama, "Ollama started")} busy={busy === "start"} />

      {message && (
        <div
          className={`rounded-lg border px-3 py-2 text-[13px] ${
            message.error ? "border-destructive/50 text-destructive" : "border-border text-muted-foreground"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {(["installed", "library"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg border px-3 py-2 font-medium transition-colors ${
              tab === t
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {t === "installed" ? `Installed (${installed.length})` : "Get models"}
          </button>
        ))}
      </div>

      {visibleJobs.length > 0 && (
        <div className="space-y-2">
          {visibleJobs.map((j) => (
              <PullRow key={j.name} job={j} onCancel={() => run(`cancel:${j.name}`, () => cancelOllamaPull(j.name), "Cancelled")} />
            ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === "installed" ? (
          installed.length === 0 ? (
            <p className="text-muted-foreground">
              {status?.running ? "No models installed yet. Open “Get models” to download one." : "Ollama isn't running."}
            </p>
          ) : (
            <ul className="space-y-2">
              {installed.map((m) => (
                <li key={m.name} className="rounded-lg border border-border bg-card/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">
                        {m.name}
                        {m.active && <Badge tone="primary">active</Badge>}
                        {m.running && <Badge>in memory</Badge>}
                      </div>
                      <div className="text-[12px] text-muted-foreground">
                        {[m.parameter_size, m.quantization, m.size_gb ? `${m.size_gb} GB` : null, m.family]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {!m.active && !/embed/i.test(m.name) && (
                        <SmallBtn onClick={() => onUse(m.name)} disabled={!!busy}>
                          Use
                        </SmallBtn>
                      )}
                      {m.running && (
                        <SmallBtn
                          onClick={() => run(`unload:${m.name}`, () => unloadLlmModel(m.name), `Unloaded ${m.name}`)}
                          disabled={!!busy}
                        >
                          Unload
                        </SmallBtn>
                      )}
                      {!m.active && (
                        <SmallBtn danger onClick={() => onDelete(m.name)} disabled={!!busy}>
                          Delete
                        </SmallBtn>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onPull(custom)}
                placeholder="Any Ollama model, e.g. qwen3:8b"
                className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-foreground outline-none focus:border-primary"
              />
              <SmallBtn onClick={() => onPull(custom)} disabled={!custom.trim() || !status?.running}>
                Pull
              </SmallBtn>
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter: tools, code, vision, 7b…"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground outline-none focus:border-primary"
            />
            <ul className="space-y-2">
              {libFiltered.map((m) => (
                <li key={m.id} className="rounded-lg border border-border bg-card/60 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">
                        {m.label}
                        {m.recommended && <Badge tone="primary">pick</Badge>}
                        {m.tags.map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                      </div>
                      <div className="text-[12px] text-muted-foreground">
                        {m.id}
                        {m.size_gb ? ` · ~${m.size_gb} GB` : ""}
                        {m.fit ? ` · ${fitLabel(m.fit)}` : ""}
                      </div>
                      {m.summary && <div className="mt-0.5 text-[12px] text-muted-foreground">{m.summary}</div>}
                    </div>
                    <div className="shrink-0">
                      {m.installed ? (
                        <span className="text-[12px] text-muted-foreground">Installed</span>
                      ) : (
                        <SmallBtn onClick={() => onPull(m.id)} disabled={!status?.running || jobs.some((j) => j.name === m.id && j.status === "pulling")}>
                          Pull
                        </SmallBtn>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-muted-foreground">
              Full catalogue at{" "}
              <a className="underline" href="https://ollama.com/library" target="_blank" rel="noreferrer">
                ollama.com/library
              </a>{" "}
              — type any name above to pull it. Models tagged “tools” work best with JARVIS.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function fitLabel(fit: string) {
  return (
    { fits: "fits your GPU", tight: "tight on VRAM", heavy: "too big for GPU", cpu: "runs on CPU" } as Record<string, string>
  )[fit] || fit;
}

function StatusRow({ status, onStart, busy }: { status: OllamaStatus | null; onStart: () => void; busy: boolean }) {
  if (!status) return <div className="text-muted-foreground">Checking Ollama…</div>;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/60 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <span className={`inline-block h-2 w-2 rounded-full ${status.running ? "bg-emerald-400" : "bg-red-400"}`} />
          {status.running ? `Ollama ${status.version || ""} running` : status.installed ? "Ollama is stopped" : "Ollama not installed"}
        </div>
        <div className="truncate text-[12px] text-muted-foreground">
          Chat model: {status.active_model} · {status.active_endpoint}
        </div>
      </div>
      {!status.running &&
        (status.installed ? (
          <SmallBtn onClick={onStart} disabled={busy}>
            {busy ? "Starting…" : "Start"}
          </SmallBtn>
        ) : (
          <a
            href={status.download_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-primary px-2.5 py-1 text-[13px] text-primary"
          >
            Download
          </a>
        ))}
    </div>
  );
}

function PullRow({ job, onCancel }: { job: OllamaPullJob; onCancel: () => void }) {
  const pct = job.percent ?? 0;
  const live = job.status === "pulling" || job.status === "queued";
  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="truncate font-medium text-foreground">{job.name}</span>
        <span className={job.status === "error" ? "text-destructive" : "text-muted-foreground"}>
          {job.status === "error" ? "failed" : live ? `${pct.toFixed(0)}%` : job.status}
        </span>
      </div>
      {live && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-white/10">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span className="truncate">{job.error || job.detail}</span>
        {live && (
          <button type="button" className="underline" onClick={onCancel}>
            cancel
          </button>
        )}
      </div>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "primary" }) {
  return (
    <span
      className={`ml-1.5 inline-block rounded px-1.5 py-[1px] align-middle text-[10px] uppercase tracking-wide ${
        tone === "primary" ? "bg-primary/20 text-primary" : "bg-white/10 text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function SmallBtn({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2.5 py-1 text-[13px] transition-colors disabled:opacity-40 ${
        danger
          ? "border-destructive/50 text-destructive hover:bg-destructive/10"
          : "border-border bg-card text-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}
