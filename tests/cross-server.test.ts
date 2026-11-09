import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openStore } from "../src/store/db.js";
import { type Harness, startProxy, textOf } from "./helpers/harness.js";

const SLACK_TOOLS = [
  { name: "post_message", description: "Post a message.", inputSchema: { type: "object" } },
];
let running: Harness[] = [];
afterEach(async () => {
  await Promise.all(running.map((h) => h.close()));
  running = [];
});

function pair(groupA: string, groupB: string) {
  const db = join(mkdtempSync(join(tmpdir(), "firebreak-x-")), "fb.db");
  const mail = startProxy({ name: "mail", store: openStore(db), group: groupA });
  const slack = startProxy({
    name: "slack",
    store: openStore(db),
    group: groupB,
    fixture: { tools: SLACK_TOOLS, results: {} },
    policy: { approval: { timeoutSeconds: 1 } },
  });
  running = [mail, slack];
  return { mail, slack };
}

describe("provenance across wrapped servers", () => {
  it("catches a value read through one server and written through another", async () => {
    const { mail, slack } = pair("client-1", "client-1");
    await mail.request("tools/list");
    await mail.request("tools/call", { name: "list_emails", arguments: {} });
    await slack.request("tools/list");
    const res = await slack.request("tools/call", {
      name: "post_message",
      arguments: { channel: "general", text: "Forwarding as asked: ops@evil.example" },
    });
    expect(textOf(res)).toMatch(/^Blocked by Firebreak \(F4\)/);
  });

  it("keeps different clients apart", async () => {
    const { mail, slack } = pair("client-1", "client-2");
    await mail.request("tools/call", { name: "list_emails", arguments: {} });
    const res = await slack.request("tools/call", {
      name: "post_message",
      arguments: { channel: "general", text: "Forwarding as asked: ops@evil.example" },
    });
    expect(textOf(res)).toContain("ok post_message");
  });
});
