import { describe, expect, it } from "vitest";
import { classifyTool } from "../src/classify.js";
import { DEFAULT_POLICY, type Policy } from "../src/policy/defaults.js";

const policy = (over: Partial<Policy> = {}): Policy => ({ ...structuredClone(DEFAULT_POLICY), ...over });

describe("classifyTool", () => {
  it("send_email is write and open world", () => {
    expect(classifyTool("mail", { name: "send_email" }, policy())).toMatchObject({
      server: "mail",
      name: "send_email",
      kind: "write",
      openWorld: true,
    });
  });

  it("delete_event is destructive", () => {
    expect(classifyTool("cal", { name: "delete_event" }, policy()).kind).toBe("destructive");
  });

  it("list and get tools are read", () => {
    expect(classifyTool("mail", { name: "list_emails" }, policy()).kind).toBe("read");
    expect(classifyTool("gh", { name: "get_issue" }, policy()).kind).toBe("read");
  });

  it("policy overrides heuristics", () => {
    const p = policy({ tools: { "mail/send_email": { kind: "read", openWorld: false, sinks: ["dest"] } } });
    expect(classifyTool("mail", { name: "send_email" }, p)).toMatchObject({
      kind: "read",
      openWorld: false,
      sinks: ["dest"],
    });
  });

  it("readOnlyHint cannot downgrade send_email", () => {
    expect(
      classifyTool("mail", { name: "send_email", annotations: { readOnlyHint: true } }, policy()).kind,
    ).toBe("write");
  });

  it("destructiveHint upgrades an unknown verb", () => {
    expect(
      classifyTool("db", { name: "purge_cache", annotations: { destructiveHint: true } }, policy()).kind,
    ).toBe("destructive");
  });

  it("readOnlyHint on an unknown verb makes it read and closed world unless openWorldHint", () => {
    const info = classifyTool(
      "db",
      { name: "describe_table", annotations: { readOnlyHint: true } },
      policy(),
    );
    expect(info.kind).toBe("read");
  });

  it("unknown tool defaults to write", () => {
    expect(classifyTool("x", { name: "frobnicate" }, policy())).toMatchObject({
      kind: "write",
      openWorld: true,
    });
    expect(classifyTool("x", undefined, policy()).kind).toBe("write");
  });

  it("default sinks include to and url", () => {
    const sinks = classifyTool("mail", { name: "send_email" }, policy()).sinks;
    expect(sinks).toContain("to");
    expect(sinks).toContain("url");
  });
});
