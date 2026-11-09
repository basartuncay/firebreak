import { classifyTool } from "../classify.js";
import { BudgetCounter } from "../policy/budget.js";
import type { Decision, Policy } from "../policy/defaults.js";
import { evaluate, type Finding, stringLeaves, type ToolStatus } from "../policy/engine.js";
import { scanDescription } from "../policy/poisoning.js";
import { TaintMemory } from "../provenance/taint.js";
import type { Scenario } from "./scenario.js";

export interface ScenarioResult {
  scenario: Scenario;
  pass: boolean;
  decision: Decision;
  findings: Finding[];
}

export interface SuiteResult {
  results: ScenarioResult[];
  attacks: { total: number; blocked: number };
  benign: { total: number; allowed: number };
  knownMisses: ScenarioResult[];
  misses: ScenarioResult[];
}

function policyFor(s: Scenario, base: Policy): Policy {
  const policy = structuredClone(base);
  policy.servers = { ...policy.servers, ...s.servers };
  const allow = s.policy.allow ?? {};
  policy.allow = {
    recipients: [...policy.allow.recipients, ...(allow.recipients ?? [])],
    hosts: [...policy.allow.hosts, ...(allow.hosts ?? [])],
    paths: [...policy.allow.paths, ...(allow.paths ?? [])],
  };
  return policy;
}

function statusFor(s: Scenario): ToolStatus {
  if (s.toolDescriptionPinned !== undefined && s.toolDescription !== s.toolDescriptionPinned)
    return "quarantined";
  if (s.toolDescription && scanDescription(s.toolDescription).length > 0) return "suspicious";
  return "ok";
}

/**
 * Replays the scenario's earlier calls as tool results the agent read, then evaluates the attempted
 * call with the real engine — no model involved ("assume the model was fully fooled").
 */
export function runScenario(s: Scenario, base: Policy): ScenarioResult {
  const policy = policyFor(s, base);
  const taint = new TaintMemory();
  s.steps.forEach((step, i) => {
    taint.noteArgs(stringLeaves(step.call.args).map((l) => l.value));
    const trust = policy.servers[step.call.server]?.trust ?? "untrusted";
    const result = {
      content: step.result.text !== undefined ? [{ type: "text", text: step.result.text }] : [],
      ...(step.result.structured !== undefined ? { structuredContent: step.result.structured } : {}),
    };
    taint.record({ server: step.call.server, tool: step.call.tool, callId: String(i), label: trust }, result);
  });
  const { server, tool, args } = s.attempt;
  const def = { name: tool, ...(s.toolDescription !== undefined ? { description: s.toolDescription } : {}) };
  const evaluation = evaluate(
    { server, tool, args },
    {
      tool: classifyTool(server, def, policy),
      toolStatus: statusFor(s),
      taint,
      policy,
      budget: new BudgetCounter(),
    },
  );
  const blocked = evaluation.decision !== "allow";
  return {
    scenario: s,
    pass: s.expect === "blocked" ? blocked : !blocked,
    decision: evaluation.decision,
    findings: evaluation.findings,
  };
}

export function runSuite(scenarios: Scenario[], policy: Policy): SuiteResult {
  const results = scenarios.map((s) => runScenario(s, policy));
  const attacks = results.filter((r) => r.scenario.kind === "attack");
  const benign = results.filter((r) => r.scenario.kind === "benign");
  const failed = results.filter((r) => !r.pass);
  return {
    results,
    attacks: { total: attacks.length, blocked: attacks.filter((r) => r.decision !== "allow").length },
    benign: { total: benign.length, allowed: benign.filter((r) => r.decision === "allow").length },
    knownMisses: failed.filter((r) => r.scenario.knownMiss),
    misses: failed.filter((r) => !r.scenario.knownMiss),
  };
}
