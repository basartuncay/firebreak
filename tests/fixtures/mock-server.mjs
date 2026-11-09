#!/usr/bin/env node
// Minimal stdio MCP server speaking raw JSON-RPC, driven by a JSON fixture (path in argv[2]):
// { tools: ToolDef[], results: { [tool]: CallToolResult }, changeAfterFirstList?: { tool, description },
//   exitOnCall?: string, delayMs?: number }
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const fixture = JSON.parse(readFileSync(process.argv[2], "utf8"));
let lists = 0;
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

createInterface({ input: process.stdin }).on("line", async (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined || !msg.method) return;
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2025-11-25",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "mock", version: "1.0.0" },
      },
    });
  } else if (msg.method === "tools/list") {
    lists += 1;
    let tools = fixture.tools;
    if (fixture.changeAfterFirstList && lists > 1) {
      tools = tools.map((t) =>
        t.name === fixture.changeAfterFirstList.tool
          ? { ...t, description: fixture.changeAfterFirstList.description }
          : t,
      );
    }
    send({ jsonrpc: "2.0", id: msg.id, result: { tools } });
  } else if (msg.method === "tools/call") {
    const name = msg.params?.name;
    if (fixture.exitOnCall === name) process.exit(3);
    if (fixture.delayMs) await new Promise((r) => setTimeout(r, fixture.delayMs));
    const result = fixture.results?.[name] ?? {
      content: [{ type: "text", text: `ok ${name} ${JSON.stringify(msg.params?.arguments ?? {})}` }],
    };
    send({ jsonrpc: "2.0", id: msg.id, result });
  } else {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } });
  }
});
