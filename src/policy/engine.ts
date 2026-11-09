import type { ToolInfo } from "../classify.js";
import type { TaintMemory, TaintSource } from "../provenance/taint.js";
import type { BudgetCounter } from "./budget.js";
import type { Decision, Policy } from "./defaults.js";
import { findSecrets } from "./secrets.js";

export type RuleId = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";
export type ToolStatus = "ok" | "suspicious" | "quarantined";

export interface ArgProvenance {
  path: string;
  value: string;
  sources: TaintSource[];
}

export interface Finding {
  rule: RuleId;
  decision: Decision;
  message: string;
  argPath?: string;
}

export interface Evaluation {
  decision: Decision;
  findings: Finding[];
  provenance: ArgProvenance[];
}

export interface EvalContext {
  tool: ToolInfo;
  toolStatus: ToolStatus;
  taint: TaintMemory;
  policy: Policy;
  budget: BudgetCounter;
}

const severity: Record<Decision, number> = { allow: 0, confirm: 1, deny: 2 };

export function strictest(decisions: Decision[]): Decision {
  return decisions.reduce<Decision>((a, b) => (severity[b] > severity[a] ? b : a), "allow");
}

/** Every string leaf of a JSON value, with a JS-like path ("recipients[0].email"). */
export function stringLeaves(value: unknown, path = ""): { path: string; value: string }[] {
  if (typeof value === "string") return [{ path: path || "(value)", value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringLeaves(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => stringLeaves(v, path ? `${path}.${k}` : k));
  }
  return [];
}

/** First identifier of the path, lower-cased: "recipients[0].email" → checks both "recipients" and "email". */
const pathKeys = (path: string): string[] =>
  path
    .split(/[.[\]]+/)
    .filter((k) => k && !/^\d+$/.test(k))
    .map((k) => k.toLowerCase());

function isAllowlisted(value: string, policy: Policy): boolean {
  const v = value.trim().toLowerCase();
  const recipient = policy.allow.recipients.some((r) => {
    const rule = r.toLowerCase();
    return rule.startsWith("@") ? v.endsWith(rule) : v === rule;
  });
  if (recipient) return true;
  try {
    const host = new URL(v).hostname;
    if (policy.allow.hosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`)))
      return true;
  } catch {
    // not a URL
  }
  return policy.allow.paths.some((glob) => globToRegExp(glob).test(value.trim()));
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped.replace(/\0/g, ".*")}$`);
}

const short = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const where = (s: TaintSource): string => `${s.server}/${s.tool}`;

/**
 * Deterministic decision for one tools/call. Pure: it reads the taint memory and budget but changes
 * neither (the caller records a write only if the call is actually forwarded).
 */
export function evaluate(
  call: { server: string; tool: string; args: unknown },
  ctx: EvalContext,
): Evaluation {
  const { tool, policy } = ctx;
  const findings: Finding[] = [];
  const leaves = stringLeaves(call.args ?? {});
  const sinkKeys = new Set(tool.sinks.map((s) => s.toLowerCase()));
  const isSink = (path: string) => pathKeys(path).some((k) => sinkKeys.has(k));
  const provenance: ArgProvenance[] = leaves
    .map((leaf) => {
      const sources = ctx.taint.trace(leaf.value);
      // Short names (repo, owner, channel) only count where they decide the destination.
      if (sources.length === 0 && tool.kind !== "read" && isSink(leaf.path))
        sources.push(...ctx.taint.traceToken(leaf.value));
      return { ...leaf, sources };
    })
    .filter((p) => p.sources.length > 0);

  if (ctx.toolStatus === "quarantined") {
    findings.push({
      rule: "F6",
      decision: "deny",
      message: `tool ${tool.server}/${tool.name} changed its definition since it was approved; re-approve it with "firebreak tools approve ${tool.server}/${tool.name}"`,
    });
  } else if (ctx.toolStatus === "suspicious") {
    findings.push({
      rule: "F6",
      decision: policy.rules.F6poisoning,
      message: `tool ${tool.server}/${tool.name} has a description that addresses the model (possible tool poisoning)`,
    });
  }

  const writes = tool.kind !== "read";

  if (writes) {
    for (const p of provenance) {
      const untrusted = p.sources.filter((s) => s.label === "untrusted");
      if (untrusted.length === 0) continue;
      if (!isSink(p.path)) continue;
      if (isAllowlisted(p.value, policy)) continue;
      findings.push({
        rule: "F1",
        decision: policy.rules.F1,
        argPath: p.path,
        message: `argument "${p.path}" (${short(p.value)}) came from untrusted output of ${where(untrusted[0]!)}, not from you`,
      });
    }
  }

  for (const leaf of leaves) {
    const secrets = findSecrets(leaf.value);
    if (secrets.length > 0 && tool.openWorld && writes) {
      findings.push({
        rule: "F2",
        decision: "deny",
        argPath: leaf.path,
        message: `argument "${leaf.path}" contains a credential (${secrets.join(", ")}) and the tool sends data outside`,
      });
    }
  }
  if (writes && tool.openWorld) {
    for (const p of provenance) {
      const priv = p.sources.find((s) => s.label === "private");
      if (!priv) continue;
      findings.push({
        rule: "F2",
        decision: policy.rules.F2private,
        argPath: p.path,
        message: `argument "${p.path}" carries private data read from ${where(priv)} to a tool that sends data outside`,
      });
      break;
    }
  }

  if (tool.kind === "destructive") {
    findings.push({
      rule: "F3",
      decision: policy.rules.F3,
      message: `${tool.server}/${tool.name} is destructive`,
    });
  }

  if (writes) {
    const crossing = provenance.find(
      (p) => p.sources.some((s) => s.server !== tool.server) && !isAllowlisted(p.value, policy),
    );
    if (crossing) {
      const from = crossing.sources.find((s) => s.server !== tool.server)!;
      findings.push({
        rule: "F4",
        decision: policy.rules.F4,
        argPath: crossing.path,
        message: `data read from ${where(from)} flows into a write on another server (${tool.server}/${tool.name})`,
      });
    }

    const { maxWritesPerSession, maxWritesPerMinute } = policy.budgets;
    if (ctx.budget.sessionCount() >= maxWritesPerSession) {
      findings.push({
        rule: "F5",
        decision: "deny",
        message: `session write budget of ${maxWritesPerSession} used up`,
      });
    } else if (ctx.budget.lastMinuteCount() >= maxWritesPerMinute) {
      findings.push({
        rule: "F5",
        decision: "deny",
        message: `more than ${maxWritesPerMinute} writes in one minute`,
      });
    }
  }

  const active = findings.filter((f) => f.decision !== "allow");
  return { decision: strictest(active.map((f) => f.decision)), findings: active, provenance };
}
