export type Decision = "allow" | "confirm" | "deny";

export interface TaintSource {
  server: string;
  tool: string;
  callId: string;
  label: "untrusted" | "private";
  snippet: string;
}
export interface ArgProvenance {
  path: string;
  value: string;
  sources: TaintSource[];
}
export interface Finding {
  rule: string;
  decision: Decision;
  message: string;
  argPath?: string;
}
export interface Approval {
  id: number;
  createdAt: string;
  sessionId: string;
  server: string;
  tool: string;
  args: unknown;
  provenance: ArgProvenance[];
  findings: Finding[];
  status: "pending" | "approved" | "denied" | "expired" | "cancelled";
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
}
export interface AuditEvent {
  id: number;
  ts: string;
  sessionId: string;
  server: string;
  tool: string;
  args: unknown;
  provenance: ArgProvenance[];
  decision: Decision;
  findings: Finding[];
  approval?: "approved" | "denied" | "expired" | "cancelled";
  latencyMs?: number;
  resultBytes?: number;
  hash: string;
}
export interface Pin {
  server: string;
  name: string;
  description: string;
  previousDescription?: string;
  status: "pinned" | "suspicious" | "quarantined";
  reasons: string[];
  firstSeen: string;
  updatedAt: string;
}
export interface Stats {
  total: number;
  decisions: Partial<Record<Decision, number>>;
  rules: Record<string, number>;
  pending: number;
  tools: Partial<Record<Pin["status"], number>>;
  chain?: { ok: true; count: number } | { ok: false; brokenAt: number };
}

const TOKEN_KEY = "firebreak-token";
let memoryToken: string | null = null;

/** The token arrives once in the URL; it is kept for this tab only and sent as a header. */
export function token(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function adoptTokenFromUrl(): void {
  const params = new URLSearchParams(location.search);
  const t = params.get("token");
  if (!t) return;
  memoryToken = t;
  try {
    sessionStorage.setItem(TOKEN_KEY, t);
  } catch {
    // storage blocked: the token still works until this page is reloaded
  }
  history.replaceState(null, "", location.pathname + location.hash);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "x-firebreak-token": token() ?? "" };
  if (init?.body) headers["content-type"] = "application/json";
  const res = await fetch(path, { ...init, credentials: "omit", headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export const api = {
  approvals: () => call<{ pending: Approval[]; recent: Approval[] }>("api/approvals"),
  decide: (id: number, decision: "approved" | "denied", reason?: string) =>
    call<Approval>(`api/approvals/${id}`, { method: "POST", body: JSON.stringify({ decision, reason }) }),
  events: (q: { decision?: string; search?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (q.decision) params.set("decision", q.decision);
    if (q.search) params.set("search", q.search);
    params.set("limit", String(q.limit ?? 200));
    return call<{ events: AuditEvent[] }>(`api/events?${params}`);
  },
  tools: () => call<{ tools: Pin[] }>("api/tools"),
  approveTool: (server: string, name: string) =>
    call<{ ok: boolean }>(`api/tools/${encodeURIComponent(server)}/${encodeURIComponent(name)}/approve`, {
      method: "POST",
    }),
  stats: () => call<Stats>("api/stats"),
  chain: () => call<Stats["chain"]>("api/chain"),
};

/** Subscribes to live updates; returns an unsubscribe function. */
export function subscribe(onChange: () => void): () => void {
  const source = new EventSource(`api/stream?token=${encodeURIComponent(token() ?? "")}`);
  source.addEventListener("events", onChange);
  source.addEventListener("approvals", onChange);
  return () => source.close();
}

export const timeAgo = (iso: string): string => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};
