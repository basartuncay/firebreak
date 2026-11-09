import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { DEFAULT_POLICY, type Policy } from "./defaults.js";

export class PolicyError extends Error {}

const decision = z.enum(["allow", "confirm", "deny"]);
const d = DEFAULT_POLICY;

const schema = z
  .object({
    version: z.literal(1).default(1),
    approval: z
      .object({ timeoutSeconds: z.number().int().min(1).max(3600).default(d.approval.timeoutSeconds) })
      .prefault({}),
    budgets: z
      .object({
        maxWritesPerSession: z.number().int().min(1).default(d.budgets.maxWritesPerSession),
        maxWritesPerMinute: z.number().int().min(1).default(d.budgets.maxWritesPerMinute),
      })
      .prefault({}),
    servers: z
      .record(z.string(), z.object({ trust: z.enum(["untrusted", "private", "trusted"]) }))
      .default({}),
    tools: z
      .record(
        z.string().regex(/^[^/]+\/.+$/, "keys must look like server/tool"),
        z.object({
          kind: z.enum(["read", "write", "destructive"]).optional(),
          openWorld: z.boolean().optional(),
          sinks: z.array(z.string()).optional(),
        }),
      )
      .default({}),
    rules: z
      .object({
        F1: decision.default(d.rules.F1),
        F2private: decision.default(d.rules.F2private),
        F3: decision.default(d.rules.F3),
        F4: decision.default(d.rules.F4),
        F6poisoning: decision.default(d.rules.F6poisoning),
      })
      .prefault({}),
    allow: z
      .object({
        recipients: z.array(z.string()).default([]),
        hosts: z.array(z.string()).default([]),
        paths: z.array(z.string()).default([]),
      })
      .prefault({}),
  })
  .strict();

export function parsePolicy(text: string): Policy {
  let raw: unknown;
  try {
    raw = parseYaml(text) ?? {};
  } catch (error) {
    throw new PolicyError(`policy is not valid YAML: ${(error as Error).message}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new PolicyError(`invalid policy:\n${lines.join("\n")}`);
  }
  return result.data as Policy;
}

/** Missing file means built-in defaults; a broken file is an error, never a silent fallback. */
export function loadPolicy(file?: string): Policy {
  if (!file || !existsSync(file)) return structuredClone(DEFAULT_POLICY);
  try {
    return parsePolicy(readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof PolicyError) throw new PolicyError(`${file}: ${error.message}`);
    throw error;
  }
}

export function defaultPolicyYaml(): string {
  return `# Firebreak policy. Every field is optional; omitted fields use the defaults shown here.
version: 1

# How long a call that needs approval waits before it is denied.
approval:
  timeoutSeconds: 120

# Hard limits on write/destructive calls (rule F5, always deny).
budgets:
  maxWritesPerSession: 50
  maxWritesPerMinute: 10

# Trust per wrapped server (the --name you gave "firebreak wrap").
#   untrusted (default): results may contain attacker text
#   private:  results are your own data; sending them to open-world tools needs approval
#   trusted:  results are not tracked
servers: {}
#  gmail: { trust: untrusted }
#  notes: { trust: private }

# Override how a tool is classified. Keys are "server/tool".
tools: {}
#  gmail/send_email: { kind: write, openWorld: true, sinks: [to, cc, bcc] }

# What each rule does when it fires: allow, confirm or deny.
rules:
  F1: confirm          # sink argument (recipient, URL, path...) came from untrusted output
  F2private: confirm   # private data sent to an open-world tool (secrets are always denied)
  F3: confirm          # destructive tool
  F4: confirm          # data read from one server sent to a write on another server
  F6poisoning: confirm # tool description contains instructions to the model

# Values that never trigger F1, even when they came from tool output.
allow:
  recipients: []       # exact addresses or "@domain"
  hosts: []            # URL hosts
  paths: []            # glob patterns
`;
}
