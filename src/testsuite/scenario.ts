import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const call = z.object({
  server: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});

const scenarioSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["attack", "benign"]),
  category: z.string(),
  title: z.string(),
  source: z.string().optional(),
  user_request: z.string().optional(),
  notes: z.string().optional(),
  /** A documented limitation: reported, but does not fail the suite. */
  knownMiss: z.boolean().default(false),
  servers: z.record(z.string(), z.object({ trust: z.enum(["untrusted", "private", "trusted"]) })).default({}),
  /** Merged over the policy under test (e.g. allowlists a real user would have). */
  policy: z
    .object({
      allow: z
        .object({
          recipients: z.array(z.string()).default([]),
          hosts: z.array(z.string()).default([]),
          paths: z.array(z.string()).default([]),
        })
        .partial(),
    })
    .partial()
    .default({}),
  steps: z
    .array(
      z.object({
        call,
        result: z.object({ text: z.string().optional(), structured: z.unknown().optional() }),
      }),
    )
    .default([]),
  /** Tool definitions: the one pinned earlier and the one the server reports now (F6). */
  toolDescription: z.string().optional(),
  toolDescriptionPinned: z.string().optional(),
  attempt: call,
  expect: z.enum(["blocked", "allowed"]),
});

export type Scenario = z.infer<typeof scenarioSchema> & { file: string };

export function parseScenario(text: string, file: string): Scenario {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw new Error(`${file}: not valid YAML: ${(error as Error).message}`);
  }
  const result = scenarioSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`${file}: invalid scenario\n${issues}`);
  }
  return { ...result.data, file };
}

function yamlFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path)
    .sort()
    .flatMap((name) => {
      const full = join(path, name);
      if (statSync(full).isDirectory()) return yamlFiles(full);
      return /\.ya?ml$/.test(name) ? [full] : [];
    });
}

export function loadScenarios(paths: string[]): Scenario[] {
  const scenarios = paths.flatMap(yamlFiles).map((f) => parseScenario(readFileSync(f, "utf8"), f));
  const seen = new Set<string>();
  for (const s of scenarios) {
    if (seen.has(s.id)) throw new Error(`duplicate scenario id "${s.id}" (${s.file})`);
    seen.add(s.id);
  }
  return scenarios;
}
