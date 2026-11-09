import type Database from "better-sqlite3";
import type { ArgProvenance, Finding } from "../policy/engine.js";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";

export interface ApprovalRequest {
  sessionId: string;
  server: string;
  tool: string;
  args: unknown;
  provenance: ArgProvenance[];
  findings: Finding[];
}

export interface Approval extends ApprovalRequest {
  id: number;
  createdAt: string;
  status: ApprovalStatus;
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
}

interface Row {
  id: number;
  created_at: string;
  session_id: string;
  server: string;
  tool: string;
  args: string;
  provenance: string;
  findings: string;
  status: ApprovalStatus;
  decided_at: string | null;
  decided_by: string | null;
  reason: string | null;
}

const fromRow = (r: Row): Approval => ({
  id: r.id,
  createdAt: r.created_at,
  sessionId: r.session_id,
  server: r.server,
  tool: r.tool,
  args: JSON.parse(r.args),
  provenance: JSON.parse(r.provenance),
  findings: JSON.parse(r.findings),
  status: r.status,
  ...(r.decided_at ? { decidedAt: r.decided_at } : {}),
  ...(r.decided_by ? { decidedBy: r.decided_by } : {}),
  ...(r.reason ? { reason: r.reason } : {}),
});

export class Approvals {
  constructor(private readonly db: Database.Database) {}

  create(req: ApprovalRequest): Approval {
    const info = this.db
      .prepare(
        `INSERT INTO approvals (created_at, session_id, server, tool, args, provenance, findings)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        new Date().toISOString(),
        req.sessionId,
        req.server,
        req.tool,
        JSON.stringify(req.args ?? null),
        JSON.stringify(req.provenance),
        JSON.stringify(req.findings),
      );
    return this.get(Number(info.lastInsertRowid))!;
  }

  get(id: number): Approval | undefined {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row | undefined;
    return row && fromRow(row);
  }

  listPending(): Approval[] {
    return (
      this.db.prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY id").all() as Row[]
    ).map(fromRow);
  }

  listRecent(limit = 50): Approval[] {
    return (this.db.prepare("SELECT * FROM approvals ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map(
      fromRow,
    );
  }

  /** Only a pending approval can change; returns whether this call decided it. */
  decide(id: number, decision: "approved" | "denied", by: string, reason?: string): boolean {
    return this.finish(id, decision, by, reason);
  }

  expire(id: number): boolean {
    return this.finish(id, "expired", "timeout");
  }

  cancel(id: number): boolean {
    return this.finish(id, "cancelled", "client");
  }

  private finish(id: number, status: ApprovalStatus, by: string, reason?: string): boolean {
    const info = this.db
      .prepare(
        `UPDATE approvals SET status = ?, decided_at = ?, decided_by = ?, reason = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(status, new Date().toISOString(), by, reason ?? null, id);
    return info.changes === 1;
  }
}
