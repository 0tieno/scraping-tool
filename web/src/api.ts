import type { ActivityEntry, Analysis, Meta, Opportunity, PipelineStatus, ScrapeRun, SourceStatus, Stats } from "./types";

const TOKEN_KEY = "kipeo-radar-token";
const ACTOR_KEY = "kipeo-radar-actor";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const session = {
  token: () => safeGet(TOKEN_KEY),
  setToken: (t: string) => safeSet(TOKEN_KEY, t),
  actor: () => safeGet(ACTOR_KEY),
  setActor: (a: string) => safeSet(ACTOR_KEY, a),
};

function safeGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — the session simply isn't remembered */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = session.token();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const actor = session.actor();
  if (actor) headers.set("X-Actor", actor);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) window.dispatchEvent(new Event("radar:unauthorized"));
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export interface ListParams {
  q?: string;
  status?: PipelineStatus[];
  tier?: string[];
  source?: string[];
  type?: string[];
  minScore?: number;
  includeExpired?: boolean;
  sort?: "score" | "deadline" | "newest";
  limit?: number;
  offset?: number;
}

export function toQuery(p: ListParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    qs.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return qs.toString();
}

export const api = {
  meta: () => request<Meta>("/api/meta"),
  stats: () => request<Stats>("/api/stats"),
  list: (p: ListParams) => request<{ items: Opportunity[]; total: number }>(`/api/opportunities?${toQuery(p)}`),
  get: (id: string) =>
    request<{ opportunity: Opportunity; analysis: Analysis | null; activity: ActivityEntry[] }>(`/api/opportunities/${encodeURIComponent(id)}`),
  update: (id: string, patch: { status?: PipelineStatus; notes?: string; owner?: string | null }) =>
    request<Opportunity>(`/api/opportunities/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  analyze: (id: string) => request<Analysis>(`/api/opportunities/${encodeURIComponent(id)}/analyze`, { method: "POST", body: "{}" }),
  sources: () => request<SourceStatus[]>("/api/sources"),
  runs: () => request<ScrapeRun[]>("/api/runs"),
  scrape: (sources?: string[]) => request<{ started: boolean }>("/api/scrape", { method: "POST", body: JSON.stringify(sources ? { sources } : {}) }),
  reload: () => request<{ profileVersion: string; rescored: number }>("/api/admin/reload", { method: "POST", body: "{}" }),
  digest: () => request<{ count: number; channels: string[] }>("/api/digest", { method: "POST", body: "{}" }),
  csvUrl: (p: ListParams) => `/api/opportunities.csv?${toQuery(p)}`,
};

/** CSV download that carries the bearer token (a plain link can't send headers). */
export async function downloadCsv(p: ListParams): Promise<void> {
  const headers: Record<string, string> = {};
  const token = session.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(api.csvUrl(p), { headers });
  if (!res.ok) throw new ApiError("Export failed", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: `kipeo-opportunities-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}
