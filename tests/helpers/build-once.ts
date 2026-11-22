import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Builds dist/ once, before any test file starts. Test files run in parallel and two of them start
 * dist/cli.js; when each ran its own build, one build could rewrite dist/ under the other's CLI.
 */
export default function setup(): void {
  // vitest sets NODE_ENV=test, which would make vite write a development bundle into dist/web.
  const env = { ...process.env, NODE_ENV: "production" };
  const cwd = fileURLToPath(new URL("../..", import.meta.url));
  const build = spawnSync("npm", ["run", "build"], { cwd, encoding: "utf8", env });
  if (build.status !== 0) throw new Error(build.stdout + build.stderr);
}
