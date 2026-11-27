/**
 * In-memory desktop session credential (never localStorage).
 * Bootstrapped from loopback `/api/session/bootstrap`.
 */

let _session: string | null = null;
let _bootPromise: Promise<string | null> | null = null;

export function getSessionToken(): string | null {
  return _session;
}

export async function ensureSession(): Promise<string | null> {
  if (_session) return _session;
  if (_bootPromise) return _bootPromise;
  _bootPromise = (async () => {
    try {
      const r = await fetch("/api/session/bootstrap", { cache: "no-store" });
      if (!r.ok) return null;
      const data = await r.json();
      _session = typeof data.session === "string" ? data.session : null;
      return _session;
    } catch {
      return null;
    } finally {
      _bootPromise = null;
    }
  })();
  return _bootPromise;
}

/** Authenticated fetch — attaches X-Jarvis-Session when available. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = (await ensureSession()) || _session;
  const headers = new Headers(init.headers || {});
  if (token) headers.set("X-Jarvis-Session", token);
  return fetch(input, { ...init, headers });
}

export function wsUrlWithSession(base?: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const root = base ?? `${proto}//${location.host}/ws`;
  const token = _session;
  if (!token) return root;
  const join = root.includes("?") ? "&" : "?";
  return `${root}${join}session=${encodeURIComponent(token)}`;
}
