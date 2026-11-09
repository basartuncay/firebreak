import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Client = "claude-desktop" | "claude-code" | "cursor";
export const CLIENTS: Client[] = ["claude-desktop", "claude-code", "cursor"];

const PACKAGE = "mcp-firebreak";

interface ServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  [key: string]: unknown;
}

type Config = { mcpServers?: Record<string, ServerEntry>; [key: string]: unknown };

/** How client configs start Firebreak. Absolute paths by default: GUI clients often lack the shell PATH. */
export interface Launcher {
  command: string;
  args: string[];
}

export const NPX_LAUNCHER: Launcher = { command: "npx", args: ["-y", PACKAGE] };

function isWrapped(entry: ServerEntry): boolean {
  const args = entry.args ?? [];
  const sep = args.indexOf("--");
  const head = sep < 0 ? args : args.slice(0, sep);
  return (
    entry.command === "firebreak" ||
    (head.includes("wrap") && head.some((a) => a === PACKAGE || /cli\.js$/.test(a)))
  );
}

/** Rewrites every stdio server entry to run behind `firebreak wrap`; keeps env and other fields. */
export function planInstall(
  config: Config,
  launcher: Launcher = NPX_LAUNCHER,
): { config: Config; wrapped: string[]; skipped: string[] } {
  const wrapped: string[] = [];
  const skipped: string[] = [];
  const servers = config.mcpServers ?? {};
  for (const [name, entry] of Object.entries(servers)) {
    if (typeof entry?.command !== "string" || isWrapped(entry)) {
      skipped.push(name);
      continue;
    }
    servers[name] = {
      ...entry,
      command: launcher.command,
      args: [...launcher.args, "wrap", "--name", name, "--", entry.command, ...(entry.args ?? [])],
    };
    wrapped.push(name);
  }
  return { config, wrapped, skipped };
}

/** Inverse of planInstall: the original command and args are everything after "--". */
export function planUninstall(config: Config): { config: Config; restored: string[] } {
  const restored: string[] = [];
  for (const [name, entry] of Object.entries(config.mcpServers ?? {})) {
    if (!entry || !isWrapped(entry)) continue;
    const args = entry.args ?? [];
    const sep = args.indexOf("--");
    if (sep < 0 || sep === args.length - 1) continue;
    const [command, ...rest] = args.slice(sep + 1) as [string, ...string[]];
    const { args: _old, ...others } = entry;
    config.mcpServers![name] = rest.length ? { ...others, command, args: rest } : { ...others, command };
    restored.push(name);
  }
  return { config, restored };
}

export function applyToFile(
  file: string,
  mode: "install" | "uninstall",
  opts: { dryRun: boolean; launcher?: Launcher },
): { changed: string[]; backup?: string } {
  const text = readFileSync(file, "utf8");
  let config: Config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${file} is not valid JSON (${(error as Error).message}); fix it first, nothing was changed`,
    );
  }
  const changed =
    mode === "install" ? planInstall(config, opts.launcher).wrapped : planUninstall(config).restored;
  if (opts.dryRun || changed.length === 0) return { changed };
  const backup = `${file}.firebreak-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(file, backup);
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return { changed, backup };
}

export function clientConfigPaths(
  client: Client,
  platform: NodeJS.Platform,
  cwd: string,
  home: string,
  env: NodeJS.ProcessEnv,
): string[] {
  switch (client) {
    case "claude-desktop":
      if (platform === "darwin")
        return [join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")];
      if (platform === "win32")
        return [
          join(env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json"),
        ];
      return [join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "Claude", "claude_desktop_config.json")];
    case "claude-code":
      return [join(cwd, ".mcp.json")];
    case "cursor":
      return [join(home, ".cursor", "mcp.json"), join(cwd, ".cursor", "mcp.json")];
  }
}
