#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { parseArgs } from "node:util";
import { firebreakHome, policyPath } from "./paths.js";
import { defaultPolicyYaml, loadPolicy, PolicyError } from "./policy/schema.js";
import { runProxy } from "./proxy.js";
import { openStore, type Store } from "./store/db.js";

const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const USAGE = `firebreak ${VERSION} — provenance-aware security gateway for MCP

Usage:
  firebreak wrap [--name <server>] [--policy <file>] -- <command> [args...]
                                 run an MCP server behind Firebreak (used in client configs)
  firebreak install [--client claude-desktop|claude-code|cursor] [--config <file>] [--dry-run]
  firebreak uninstall [--client ...] [--config <file>]
  firebreak ui [--port 4319]     open the approvals and audit dashboard
  firebreak approvals            list calls waiting for approval
  firebreak approve <id> [--reason <text>]
  firebreak deny <id> [--reason <text>]
  firebreak audit tail [-n 20]   recent decisions
  firebreak audit verify         check the hash chain of the audit log
  firebreak tools                pinned tools and their status
  firebreak tools approve <server/tool>
  firebreak test [--policy <file>] [--scenarios <dir>]... [--format text|json|markdown]
  firebreak init                 write a commented policy to ${policyPath()}

State lives in ${firebreakHome()} (set FIREBREAK_HOME to change it).`;

class UsageError extends Error {}

const out = (s: string) => process.stdout.write(`${s}\n`);

function withStore<T>(fn: (store: Store) => T): T {
  const store = openStore();
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

async function wrap(argv: string[]): Promise<number> {
  const sep = argv.indexOf("--");
  if (sep < 0 || sep === argv.length - 1) throw new UsageError("wrap needs the server command after --");
  const { values } = parseArgs({
    args: argv.slice(0, sep),
    options: { name: { type: "string" }, policy: { type: "string" } },
  });
  const [command, ...args] = argv.slice(sep + 1) as [string, ...string[]];
  const name = values.name ?? basename(args.at(-1) ?? command).replace(/\.[cm]?[jt]s$/, "");
  const policy = loadPolicy(values.policy ?? policyPath());
  let store: Store | null = null;
  try {
    store = openStore();
  } catch (error) {
    process.stderr.write(`[firebreak:${name}] cannot open store: ${(error as Error).message}\n`);
  }
  return runProxy({
    name,
    command,
    args,
    policy,
    store,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

function init(): number {
  const file = policyPath();
  if (existsSync(file)) {
    out(`${file} already exists; not overwriting.`);
    return 0;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, defaultPolicyYaml());
  out(`wrote ${file}`);
  return 0;
}

function approvals(): number {
  return withStore((store) => {
    const pending = store.approvals.listPending();
    if (pending.length === 0) {
      out("No calls are waiting for approval.");
      return 0;
    }
    for (const a of pending) {
      out(`#${a.id}  ${a.createdAt}  ${a.server}/${a.tool}`);
      for (const f of a.findings) out(`      ${f.rule}  ${f.message}`);
      out(`      args: ${JSON.stringify(a.args)}`);
    }
    out(`\nfirebreak approve <id>   or   firebreak deny <id> --reason "..."`);
    return 0;
  });
}

function decide(argv: string[], decision: "approved" | "denied"): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { reason: { type: "string" } },
  });
  const id = Number(positionals[0]);
  if (!Number.isInteger(id))
    throw new UsageError(`${decision === "approved" ? "approve" : "deny"} needs an approval id`);
  return withStore((store) => {
    const current = store.approvals.get(id);
    if (!current) {
      out(`No approval #${id}.`);
      return 1;
    }
    if (!store.approvals.decide(id, decision, "cli", values.reason)) {
      out(`Approval #${id} is already ${current.status}.`);
      return 1;
    }
    out(`Approval #${id} ${decision}: ${current.server}/${current.tool}`);
    return 0;
  });
}

function audit(argv: string[]): number {
  const [sub, ...rest] = argv;
  if (sub === "verify") {
    return withStore((store) => {
      const result = store.audit.verify();
      if (result.ok) {
        out(`Audit log intact: ${result.count} events, hash chain verified.`);
        return 0;
      }
      out(`Audit log BROKEN at event #${result.brokenAt}: it or an earlier event was changed or removed.`);
      return 1;
    });
  }
  if (sub === "tail" || sub === undefined) {
    const { values } = parseArgs({
      args: rest,
      options: { n: { type: "string", short: "n", default: "20" } },
    });
    return withStore((store) => {
      const events = store.audit.list({ limit: Number(values.n) }).reverse();
      if (events.length === 0) out("No events yet.");
      for (const e of events) {
        const rules = e.findings.map((f) => f.rule).join(",");
        const approval = e.approval ? ` (${e.approval})` : "";
        out(
          `#${e.id} ${e.ts}  ${e.decision.padEnd(7)}${approval}  ${e.server}/${e.tool}${rules ? `  [${rules}]` : ""}`,
        );
      }
      return 0;
    });
  }
  throw new UsageError(`unknown audit subcommand "${sub}"`);
}

function tools(argv: string[]): number {
  const [sub, target] = argv;
  if (sub === "approve") {
    const [server, ...rest] = (target ?? "").split("/");
    const name = rest.join("/");
    if (!server || !name) throw new UsageError("tools approve needs <server/tool>");
    return withStore((store) => {
      if (!store.pins.approve(server, name)) {
        out(`No pinned tool ${server}/${name}.`);
        return 1;
      }
      out(`Approved the current definition of ${server}/${name}.`);
      return 0;
    });
  }
  if (sub !== undefined) throw new UsageError(`unknown tools subcommand "${sub}"`);
  return withStore((store) => {
    const pins = store.pins.list();
    if (pins.length === 0) out("No tools pinned yet. They are pinned the first time a client lists them.");
    for (const p of pins) {
      const reasons = p.reasons.length ? `  (${p.reasons.join(", ")})` : "";
      out(`${p.status.padEnd(11)} ${p.server}/${p.name}${reasons}`);
    }
    return 0;
  });
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "wrap":
      return wrap(rest);
    case "init":
      return init();
    case "approvals":
      return approvals();
    case "approve":
      return decide(rest, "approved");
    case "deny":
      return decide(rest, "denied");
    case "audit":
      return audit(rest);
    case "tools":
      return tools(rest);
    case "ui":
      return (await import("./commands/ui.js")).ui(rest);
    case "test":
      return (await import("./commands/test.js")).test(rest);
    case "install":
      return (await import("./commands/install.js")).install(rest, "install");
    case "uninstall":
      return (await import("./commands/install.js")).install(rest, "uninstall");
    case "--version":
    case "-v":
      out(VERSION);
      return 0;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      out(USAGE);
      return 0;
    default:
      throw new UsageError(`unknown command "${command}"`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof UsageError) {
      process.stderr.write(`firebreak: ${error.message}\n\n${USAGE}\n`);
      process.exitCode = 2;
    } else if (error instanceof PolicyError) {
      process.stderr.write(`firebreak: ${error.message}\n`);
      process.exitCode = 2;
    } else {
      process.stderr.write(`firebreak: ${(error as Error).stack ?? error}\n`);
      process.exitCode = 1;
    }
  },
);
