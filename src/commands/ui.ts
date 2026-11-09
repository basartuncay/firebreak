import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { startUi } from "../ui/server.js";

export async function ui(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { port: { type: "string", default: "4319" }, "no-open": { type: "boolean", default: false } },
  });
  const { url } = await startUi({ port: Number(values.port) });
  process.stdout.write(
    `Firebreak dashboard: ${url}\n(local only; the token in the link is your access key. Ctrl+C to stop.)\n`,
  );
  if (!values["no-open"]) {
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    spawn(opener, [url], { stdio: "ignore", detached: true })
      .on("error", () => {})
      .unref();
  }
  await new Promise(() => {}); // serve until interrupted
  return 0;
}
