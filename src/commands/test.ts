import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { policyPath } from "../paths.js";
import { loadPolicy } from "../policy/schema.js";
import { formatReport } from "../testsuite/report.js";
import { runSuite } from "../testsuite/run.js";
import { loadScenarios } from "../testsuite/scenario.js";

export const BUILTIN_SCENARIOS = fileURLToPath(new URL("../../scenarios", import.meta.url));

/** Replays attack and benign scenarios against a policy. Exit 1 when any result is unexpected. */
export async function test(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      policy: { type: "string" },
      scenarios: { type: "string", multiple: true, default: [] },
      "no-builtin": { type: "boolean", default: false },
      format: { type: "string", default: "text" },
    },
  });
  const format = values.format as "text" | "json" | "markdown";
  if (!["text", "json", "markdown"].includes(format))
    throw new Error(`--format must be text, json or markdown`);
  const dirs = [...(values["no-builtin"] ? [] : [BUILTIN_SCENARIOS]), ...(values.scenarios ?? [])];
  if (dirs.length === 0) throw new Error("no scenarios: drop --no-builtin or pass --scenarios <dir>");
  const result = runSuite(loadScenarios(dirs), loadPolicy(values.policy ?? policyPath()));
  process.stdout.write(`${formatReport(result, format)}\n`);
  return result.misses.length > 0 ? 1 : 0;
}
