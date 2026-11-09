import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../src/policy/defaults.js";
import { defaultPolicyYaml, loadPolicy, PolicyError, parsePolicy } from "../src/policy/schema.js";

const tmp = () => mkdtempSync(join(tmpdir(), "firebreak-policy-"));

describe("loadPolicy", () => {
  it("returns defaults when file is missing", () => {
    expect(loadPolicy(join(tmp(), "nope.yaml"))).toEqual(DEFAULT_POLICY);
  });

  it("merges partial file over defaults", () => {
    const file = join(tmp(), "p.yaml");
    writeFileSync(file, "approval:\n  timeoutSeconds: 5\nallow:\n  recipients: ['@acme.example']\n");
    const p = loadPolicy(file);
    expect(p.approval.timeoutSeconds).toBe(5);
    expect(p.allow.recipients).toEqual(["@acme.example"]);
    expect(p.budgets).toEqual(DEFAULT_POLICY.budgets);
    expect(p.rules.F1).toBe("confirm");
  });

  it("reports the path of an invalid field", () => {
    expect(() => parsePolicy("rules:\n  F3: maybe\n")).toThrow(PolicyError);
    expect(() => parsePolicy("rules:\n  F3: maybe\n")).toThrow(/rules\.F3/);
    expect(() => parsePolicy("servers:\n  gmail: { trust: sometimes }\n")).toThrow(/servers\.gmail\.trust/);
  });

  it("rejects invalid YAML with a readable message", () => {
    expect(() => parsePolicy("rules: [")).toThrow(PolicyError);
  });

  it("default template parses to defaults", () => {
    expect(parsePolicy(defaultPolicyYaml())).toEqual(DEFAULT_POLICY);
  });
});
