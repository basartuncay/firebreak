import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { ToolDef } from "../classify.js";
import { scanDescription } from "../policy/poisoning.js";
import { canonicalJson } from "./audit.js";

export type PinCheck = "ok" | "new" | "changed" | "suspicious" | "quarantined";

export interface Pin {
  server: string;
  name: string;
  hash: string;
  description: string;
  previousDescription?: string;
  pendingDescription?: string;
  status: "pinned" | "suspicious" | "quarantined";
  reasons: string[];
  firstSeen: string;
  updatedAt: string;
}

interface Row {
  server: string;
  name: string;
  hash: string;
  description: string;
  previous_description: string | null;
  pending_hash: string | null;
  pending_description: string | null;
  status: Pin["status"];
  reasons: string;
  first_seen: string;
  updated_at: string;
}

const fromRow = (r: Row): Pin => ({
  server: r.server,
  name: r.name,
  hash: r.hash,
  description: r.description,
  ...(r.previous_description != null ? { previousDescription: r.previous_description } : {}),
  ...(r.pending_description != null ? { pendingDescription: r.pending_description } : {}),
  status: r.status,
  reasons: JSON.parse(r.reasons),
  firstSeen: r.first_seen,
  updatedAt: r.updated_at,
});

/** What the model actually reads about a tool: name, description, input schema. */
export const toolHash = (def: ToolDef): string =>
  createHash("sha256")
    .update(
      canonicalJson({
        name: def.name,
        description: def.description ?? "",
        inputSchema: def.inputSchema ?? null,
      }),
    )
    .digest("hex");

/** Trust on first use: the first definition seen is pinned; any later change is quarantined until approved. */
export class Pins {
  constructor(private readonly db: Database.Database) {}

  /** Atomic across processes: two clients listing the same new tool at once both get the same answer. */
  check(server: string, def: ToolDef): { status: PinCheck; reasons: string[] } {
    return this.db.transaction(() => this.checkUnlocked(server, def)).immediate();
  }

  private checkUnlocked(server: string, def: ToolDef): { status: PinCheck; reasons: string[] } {
    const hash = toolHash(def);
    const description = def.description ?? "";
    const now = new Date().toISOString();
    const row = this.db.prepare("SELECT * FROM pins WHERE server = ? AND name = ?").get(server, def.name) as
      | Row
      | undefined;

    if (!row) {
      const reasons = scanDescription(description);
      const status = reasons.length ? "suspicious" : "pinned";
      this.db
        .prepare(
          `INSERT INTO pins (server, name, hash, description, status, reasons, first_seen, updated_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(server, def.name, hash, description, status, JSON.stringify(reasons), now, now);
      return { status: reasons.length ? "suspicious" : "new", reasons };
    }

    if (row.hash === hash) {
      if (row.status === "quarantined") {
        // Changed back to the approved definition: lift the quarantine.
        this.db
          .prepare(
            "UPDATE pins SET status = 'pinned', pending_hash = NULL, pending_description = NULL, updated_at = ? WHERE server = ? AND name = ?",
          )
          .run(now, server, def.name);
        return { status: "ok", reasons: [] };
      }
      const reasons = JSON.parse(row.reasons) as string[];
      return { status: row.status === "suspicious" ? "suspicious" : "ok", reasons };
    }

    this.db
      .prepare(
        `UPDATE pins SET status = 'quarantined', pending_hash = ?, pending_description = ?, reasons = ?, updated_at = ?
         WHERE server = ? AND name = ?`,
      )
      .run(
        hash,
        description,
        JSON.stringify(["definition-changed", ...scanDescription(description)]),
        now,
        server,
        def.name,
      );
    return { status: "quarantined", reasons: ["definition-changed"] };
  }

  /** Accept the latest seen definition of a tool as the new pin. */
  approve(server: string, name: string): boolean {
    const row = this.db.prepare("SELECT * FROM pins WHERE server = ? AND name = ?").get(server, name) as
      | Row
      | undefined;
    if (!row) return false;
    const now = new Date().toISOString();
    if (row.pending_hash) {
      this.db
        .prepare(
          `UPDATE pins SET previous_description = description, hash = pending_hash, description = pending_description,
             pending_hash = NULL, pending_description = NULL, status = 'pinned', reasons = '[]', updated_at = ?
           WHERE server = ? AND name = ?`,
        )
        .run(now, server, name);
    } else {
      this.db
        .prepare(
          "UPDATE pins SET status = 'pinned', reasons = '[]', updated_at = ? WHERE server = ? AND name = ?",
        )
        .run(now, server, name);
    }
    return true;
  }

  list(): Pin[] {
    return (this.db.prepare("SELECT * FROM pins ORDER BY server, name").all() as Row[]).map((r) => {
      const pin = fromRow(r);
      // While quarantined, show the approved text as "previous" and the new text as current.
      if (r.status === "quarantined" && r.pending_description != null) {
        return { ...pin, previousDescription: r.description, description: r.pending_description };
      }
      return pin;
    });
  }
}
