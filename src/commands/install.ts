import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  applyToFile,
  CLIENTS,
  type Client,
  clientConfigPaths,
  type Launcher,
  NPX_LAUNCHER,
} from "../install.js";

export async function install(argv: string[], mode: "install" | "uninstall"): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      client: { type: "string", multiple: true },
      config: { type: "string", multiple: true },
      "dry-run": { type: "boolean", default: false },
      npx: { type: "boolean", default: false },
    },
  });
  const clients = (values.client ?? CLIENTS) as Client[];
  for (const c of clients) {
    if (!CLIENTS.includes(c)) throw new Error(`unknown client "${c}" (use ${CLIENTS.join(", ")})`);
  }
  const files =
    values.config ??
    clients.flatMap((c) => clientConfigPaths(c, process.platform, process.cwd(), homedir(), process.env));
  const existing = [...new Set(files)].filter((f) => existsSync(f));
  if (existing.length === 0) {
    process.stdout.write(`No MCP config found. Looked in:\n${files.map((f) => `  ${f}`).join("\n")}\n`);
    return 1;
  }

  // This very installation, by absolute path, unless the user asked for the published npm package.
  // An npx run lives in a temporary cache, so a path to it would break later: use npx there too.
  const self = fileURLToPath(new URL("../cli.js", import.meta.url));
  const launcher: Launcher =
    values.npx || /[\\/]_npx[\\/]/.test(self) ? NPX_LAUNCHER : { command: process.execPath, args: [self] };
  const verb = mode === "install" ? "wrapped" : "restored";
  for (const file of existing) {
    const { changed, backup } = applyToFile(file, mode, { dryRun: values["dry-run"] ?? false, launcher });
    if (changed.length === 0) {
      process.stdout.write(`${file}: nothing to change\n`);
      continue;
    }
    process.stdout.write(
      `${file}: ${values["dry-run"] ? "would be " : ""}${verb} ${changed.join(", ")}${backup ? `\n  backup: ${backup}` : ""}\n`,
    );
  }
  if (mode === "install" && !values["dry-run"]) {
    process.stdout.write(
      "\nRestart your MCP client so it starts the servers through Firebreak.\n" +
        "Then run `npx mcp-firebreak ui` to watch calls and answer approvals.\n",
    );
  }
  return 0;
}
