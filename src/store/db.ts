import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { dbPath } from "../paths.js";
import { Approvals } from "./approvals.js";
import { Audit } from "./audit.js";
import { Pins } from "./pins.js";

const SCHEMA_VERSION = 1;

const MIGRATION_1 = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  session_id TEXT NOT NULL,
  server TEXT NOT NULL,
  tool TEXT NOT NULL,
  args TEXT NOT NULL,
  provenance TEXT NOT NULL,
  decision TEXT NOT NULL,
  findings TEXT NOT NULL,
  approval TEXT,
  latency_ms INTEGER,
  result_bytes INTEGER,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  session_id TEXT NOT NULL,
  server TEXT NOT NULL,
  tool TEXT NOT NULL,
  args TEXT NOT NULL,
  provenance TEXT NOT NULL,
  findings TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TEXT,
  decided_by TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS approvals_status ON approvals(status);
CREATE TABLE IF NOT EXISTS pins (
  server TEXT NOT NULL,
  name TEXT NOT NULL,
  hash TEXT NOT NULL,
  description TEXT NOT NULL,
  previous_description TEXT,
  pending_hash TEXT,
  pending_description TEXT,
  status TEXT NOT NULL,
  reasons TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server, name)
);
`;

export interface Store {
  db: Database.Database;
  audit: Audit;
  approvals: Approvals;
  pins: Pins;
  close(): void;
}

/** One SQLite file shared by every proxy process and the UI; WAL lets them read and write concurrently. */
export function openStore(file: string = dbPath()): Store {
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.exec(MIGRATION_1);
  const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  if (!version)
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  else if (Number(version.value) > SCHEMA_VERSION) {
    throw new Error(`${file} was written by a newer Firebreak (schema ${version.value}); upgrade firebreak`);
  }
  return {
    db,
    audit: new Audit(db),
    approvals: new Approvals(db),
    pins: new Pins(db),
    close: () => db.close(),
  };
}

export const nowIso = (): string => new Date().toISOString();
