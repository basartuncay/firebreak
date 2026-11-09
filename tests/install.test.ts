import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyToFile, clientConfigPaths, planInstall, planUninstall } from "../src/install.js";

const config = {
  mcpServers: {
    github: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "x" },
    },
    files: { command: "node", args: ["/opt/files/index.js", "--root", "/home/me"] },
    remote: { type: "http", url: "https://mcp.example/sse" },
  },
  otherSetting: true,
};

describe("planInstall", () => {
  it("wraps stdio entries", () => {
    const { config: out, wrapped } = planInstall(structuredClone(config), {
      command: "/usr/local/bin/node",
      args: ["/opt/firebreak/dist/cli.js"],
    });
    expect(wrapped).toEqual(["github", "files"]);
    expect(out.mcpServers?.github).toEqual({
      command: "/usr/local/bin/node",
      args: [
        "/opt/firebreak/dist/cli.js",
        "wrap",
        "--name",
        "github",
        "--",
        "npx",
        "-y",
        "@modelcontextprotocol/server-github",
      ],
      env: { GITHUB_TOKEN: "x" },
    });
    expect(out.otherSetting).toBe(true);
  });

  it("skips url entries and already wrapped", () => {
    const once = planInstall(structuredClone(config)).config;
    const twice = planInstall(once);
    expect(twice.wrapped).toEqual([]);
    expect(twice.skipped).toEqual(expect.arrayContaining(["remote", "github", "files"]));
    expect(twice.config).toEqual(once);
  });

  it("uninstall restores original exactly", () => {
    const wrapped = planInstall(structuredClone(config)).config;
    const { config: restored, restored: names } = planUninstall(wrapped);
    expect(restored).toEqual(config);
    expect(names).toEqual(["github", "files"]);
  });

  it("round-trips with an absolute launcher", () => {
    const launcher = { command: "/usr/local/bin/node", args: ["/opt/firebreak/dist/cli.js"] };
    const wrapped = planInstall(structuredClone(config), launcher).config;
    expect(planInstall(structuredClone(wrapped), launcher).wrapped).toEqual([]);
    expect(planUninstall(wrapped).config).toEqual(config);
  });

  it("handles a config without servers", () => {
    expect(planInstall({}).wrapped).toEqual([]);
  });
});

describe("applyToFile", () => {
  it("writes a backup before changing the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "firebreak-install-"));
    const file = join(dir, "claude_desktop_config.json");
    writeFileSync(file, JSON.stringify(config, null, 2));
    const result = applyToFile(file, "install", { dryRun: false });
    expect(result.changed).toEqual(["github", "files"]);
    const backups = readdirSync(dir).filter((f) => f.includes(".firebreak-backup-"));
    expect(backups).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, backups[0]!), "utf8"))).toEqual(config);
    expect(JSON.parse(readFileSync(file, "utf8")).mcpServers.files.args[2]).toBe("wrap");
  });

  it("dry run changes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "firebreak-install-"));
    const file = join(dir, "mcp.json");
    writeFileSync(file, JSON.stringify(config));
    const result = applyToFile(file, "install", { dryRun: true });
    expect(result.changed).toEqual(["github", "files"]);
    expect(readFileSync(file, "utf8")).toBe(JSON.stringify(config));
    expect(readdirSync(dir)).toEqual(["mcp.json"]);
  });

  it("refuses a file that is not JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "firebreak-install-"));
    const file = join(dir, "mcp.json");
    writeFileSync(file, "{ not json");
    expect(() => applyToFile(file, "install", { dryRun: false })).toThrow(/not valid JSON/);
    expect(existsSync(file)).toBe(true);
  });
});

describe("clientConfigPaths", () => {
  it("knows the Claude Desktop path on macOS and Windows", () => {
    expect(clientConfigPaths("claude-desktop", "darwin", "/w", "/Users/me", {})).toEqual([
      "/Users/me/Library/Application Support/Claude/claude_desktop_config.json",
    ]);
    expect(
      clientConfigPaths("claude-desktop", "win32", "C:\\w", "C:\\Users\\me", { APPDATA: "C:\\AppData" })[0],
    ).toContain("claude_desktop_config.json");
  });

  it("knows Claude Code and Cursor project files", () => {
    expect(clientConfigPaths("claude-code", "linux", "/repo", "/home/me", {})).toEqual(["/repo/.mcp.json"]);
    expect(clientConfigPaths("cursor", "linux", "/repo", "/home/me", {})).toEqual([
      "/home/me/.cursor/mcp.json",
      "/repo/.cursor/mcp.json",
    ]);
  });
});
