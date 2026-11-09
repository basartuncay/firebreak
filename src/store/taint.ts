import type Database from "better-sqlite3";
import type { Origin } from "../provenance/taint.js";

export interface TaintRow {
  id: number;
  origin: Origin;
  text: string;
}

/**
 * Tool output shared between the proxies one MCP client started (one per wrapped server), so a value
 * read through one server is recognised when it is written through another. Rows expire after a TTL:
 * this table holds copies of tool output (email bodies, issue text) and must not grow into an archive.
 */
export class SharedTaint {
  constructor(private readonly db: Database.Database) {}

  add(group: string, sessionId: string, origin: Origin, text: string): void {
    this.db
      .prepare(
        "INSERT INTO taint (group_key, session_id, ts, server, tool, call_id, label, text) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(group, sessionId, Date.now(), origin.server, origin.tool, origin.callId, origin.label, text);
  }

  /** Rows other sessions of the same group wrote after `afterId`. */
  since(group: string, sessionId: string, afterId: number): TaintRow[] {
    const rows = this.db
      .prepare(
        "SELECT id, server, tool, call_id, label, text FROM taint WHERE group_key = ? AND session_id != ? AND id > ? ORDER BY id",
      )
      .all(group, sessionId, afterId) as {
      id: number;
      server: string;
      tool: string;
      call_id: string;
      label: Origin["label"];
      text: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      origin: { server: r.server, tool: r.tool, callId: r.call_id, label: r.label },
      text: r.text,
    }));
  }

  prune(maxAgeMs: number): number {
    return this.db.prepare("DELETE FROM taint WHERE ts < ?").run(Date.now() - maxAgeMs).changes;
  }
}
