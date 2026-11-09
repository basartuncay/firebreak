import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { Decision } from "../policy/defaults.js";
import type { ArgProvenance, Finding } from "../policy/engine.js";

export type ApprovalOutcome = "approved" | "denied" | "expired" | "cancelled";

export interface AuditInput {
  sessionId: string;
  server: string;
  tool: string;
  /** Already redacted by the caller. */
  args: unknown;
  provenance: ArgProvenance[];
  decision: Decision;
  findings: Finding[];
  approval?: ApprovalOutcome;
  latencyMs?: number;
  resultBytes?: number;
}

export interface AuditEvent extends AuditInput {
  id: number;
  ts: string;
  prevHash: string;
  hash: string;
}

export interface AuditQuery {
  limit?: number;
  server?: string;
  tool?: string;
  decision?: Decision;
  search?: string;
  sinceId?: number;
}

const GENESIS = "0".repeat(64);

/** JSON with object keys sorted, so the hash does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const hashEvent = (prevHash: string, body: Omit<AuditEvent, "id" | "hash" | "prevHash">): string =>
  createHash("sha256").update(prevHash).update(canonicalJson(body)).digest("hex");

interface Row {
  id: number;
  ts: string;
  session_id: string;
  server: string;
  tool: string;
  args: string;
  provenance: string;
  decision: Decision;
  findings: string;
  approval: ApprovalOutcome | null;
  latency_ms: number | null;
  result_bytes: number | null;
  prev_hash: string;
  hash: string;
}

const fromRow = (r: Row): AuditEvent => ({
  id: r.id,
  ts: r.ts,
  sessionId: r.session_id,
  server: r.server,
  tool: r.tool,
  args: JSON.parse(r.args),
  provenance: JSON.parse(r.provenance),
  decision: r.decision,
  findings: JSON.parse(r.findings),
  ...(r.approval ? { approval: r.approval } : {}),
  ...(r.latency_ms != null ? { latencyMs: r.latency_ms } : {}),
  ...(r.result_bytes != null ? { resultBytes: r.result_bytes } : {}),
  prevHash: r.prev_hash,
  hash: r.hash,
});

const bodyOf = (e: AuditEvent): Omit<AuditEvent, "id" | "hash" | "prevHash"> => {
  const { id: _id, hash: _hash, prevHash: _prev, ...body } = e;
  return body;
};

/** Append-only, hash-chained event log: changing or deleting a row breaks every later hash. */
export class Audit {
  constructor(private readonly db: Database.Database) {}

  append(input: AuditInput): AuditEvent {
    // IMMEDIATE takes the write lock up front so two proxies cannot both read the same previous hash.
    const tx = this.db.transaction((): AuditEvent => {
      const last = this.db.prepare("SELECT hash FROM events ORDER BY id DESC LIMIT 1").get() as
        | { hash: string }
        | undefined;
      const prevHash = last?.hash ?? GENESIS;
      const body = { ...input, ts: new Date().toISOString() };
      const hash = hashEvent(prevHash, body);
      const info = this.db
        .prepare(
          `INSERT INTO events (ts, session_id, server, tool, args, provenance, decision, findings, approval,
             latency_ms, result_bytes, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          body.ts,
          input.sessionId,
          input.server,
          input.tool,
          JSON.stringify(input.args ?? null),
          JSON.stringify(input.provenance),
          input.decision,
          JSON.stringify(input.findings),
          input.approval ?? null,
          input.latencyMs ?? null,
          input.resultBytes ?? null,
          prevHash,
          hash,
        );
      return { ...body, id: Number(info.lastInsertRowid), prevHash, hash };
    });
    return tx.immediate();
  }

  list(q: AuditQuery = {}): AuditEvent[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.server) where.push("server = ?"), params.push(q.server);
    if (q.tool) where.push("tool = ?"), params.push(q.tool);
    if (q.decision) where.push("decision = ?"), params.push(q.decision);
    if (q.sinceId) where.push("id > ?"), params.push(q.sinceId);
    if (q.search) {
      where.push("(args LIKE ? OR findings LIKE ? OR tool LIKE ? OR server LIKE ?)");
      const like = `%${q.search}%`;
      params.push(like, like, like, like);
    }
    const sql = `SELECT * FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...params, Math.min(q.limit ?? 100, 1000)) as Row[]).map(fromRow);
  }

  verify(): { ok: true; count: number } | { ok: false; brokenAt: number } {
    let prev = GENESIS;
    let count = 0;
    for (const row of this.db.prepare("SELECT * FROM events ORDER BY id").iterate() as Iterable<Row>) {
      const event = fromRow(row);
      if (event.prevHash !== prev || hashEvent(prev, bodyOf(event)) !== event.hash) {
        return { ok: false, brokenAt: event.id };
      }
      prev = event.hash;
      count += 1;
    }
    return { ok: true, count };
  }

  /** Counts per decision and per fired rule for events at or after `sinceIso`. */
  stats(sinceIso: string): {
    total: number;
    decisions: Record<string, number>;
    rules: Record<string, number>;
  } {
    const decisions = Object.fromEntries(
      (
        this.db
          .prepare("SELECT decision, COUNT(*) AS n FROM events WHERE ts >= ? GROUP BY decision")
          .all(sinceIso) as { decision: string; n: number }[]
      ).map((r) => [r.decision, r.n]),
    );
    const rules = Object.fromEntries(
      (
        this.db
          .prepare(
            `SELECT json_extract(f.value, '$.rule') AS rule, COUNT(DISTINCT events.id) AS n
             FROM events, json_each(events.findings) AS f WHERE events.ts >= ? GROUP BY rule`,
          )
          .all(sinceIso) as { rule: string; n: number }[]
      ).map((r) => [r.rule, r.n]),
    );
    const total = Object.values(decisions).reduce((a, b) => a + b, 0);
    return { total, decisions, rules };
  }
}
