import { DEFAULT_SINKS, type Policy, type ToolKind } from "./policy/defaults.js";

export interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
}

export interface ToolInfo {
  server: string;
  name: string;
  kind: ToolKind;
  openWorld: boolean;
  sinks: string[];
}

const DESTRUCTIVE = /^(delete|remove|drop|destroy|purge|erase|wipe|truncate|revoke|cancel|archive)(_|$)/i;
const WRITE =
  /^(send|post|create|update|write|push|add|share|forward|reply|put|patch|set|upload|move|rename|invite|merge|comment|publish|execute|exec|run|insert|edit|save|transfer|pay|commit|deploy|book|schedule)(_|$)/i;
const READ =
  /^(get|list|read|search|fetch|find|query|describe|show|view|lookup|browse|download|count|check)(_|$)/i;

/** Last verb-like segment, so "github__create_issue" and "files.write_file" classify by their action. */
const action = (name: string): string => name.split(/__|\.|\//).pop() ?? name;

const rank: Record<ToolKind, number> = { read: 0, write: 1, destructive: 2 };
const stricter = (a: ToolKind, b: ToolKind): ToolKind => (rank[a] >= rank[b] ? a : b);

/**
 * Policy first, then name heuristics, then the server's annotations. Annotations are hints written
 * by the server, so they can make a tool stricter but never relax a heuristic result.
 */
export function classifyTool(server: string, def: ToolDef | undefined, policy: Policy): ToolInfo {
  const name = def?.name ?? "";
  const verb = action(name);
  const hints = def?.annotations ?? {};

  let kind: ToolKind | undefined = DESTRUCTIVE.test(verb)
    ? "destructive"
    : WRITE.test(verb)
      ? "write"
      : READ.test(verb)
        ? "read"
        : undefined;
  if (hints.destructiveHint) kind = stricter(kind ?? "write", "destructive");
  if (kind === undefined) kind = hints.readOnlyHint ? "read" : "write";

  let openWorld = kind === "read" ? hints.openWorldHint === true : hints.openWorldHint !== false;
  // A tool we would treat as writing to the outside world stays open-world whatever the server says.
  if (kind !== "read" && WRITE.test(verb)) openWorld = true;

  const override = policy.tools[`${server}/${name}`] ?? {};
  return {
    server,
    name,
    kind: override.kind ?? kind,
    openWorld: override.openWorld ?? openWorld,
    sinks: override.sinks ?? DEFAULT_SINKS,
  };
}
