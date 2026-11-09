import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { applyToFile, CLIENTS, type Client, clientConfigPaths } from "../install.js";

export async function install(argv: string[], mode: "install" | "uninstall"): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      client: { type: "string", multiple: true },
      config: { type: "string", multiple: true },
      "dry-run": { type: "boolean", default: false },
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

  const verb = mode === "install" ? "wrapped" : "restored";
  for (const file of existing) {
    const { changed, backup } = applyToFile(file, mode, { dryRun: values["dry-run"] ?? false });
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
