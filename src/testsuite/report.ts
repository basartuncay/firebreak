import type { ScenarioResult, SuiteResult } from "./run.js";

const pct = (n: number, d: number): string => (d === 0 ? "–" : `${Math.round((n / d) * 100)}%`);

const describe = (r: ScenarioResult): string => {
  const rules = [...new Set(r.findings.map((f) => f.rule))].join(", ") || "no rule fired";
  return `${r.scenario.id} (${r.scenario.kind}, expected ${r.scenario.expect}, got ${r.decision}; ${rules}) — ${r.scenario.title}`;
};

function byCategory(result: SuiteResult): [string, number, number][] {
  const map = new Map<string, [number, number]>();
  for (const r of result.results.filter((x) => x.scenario.kind === "attack")) {
    const [blocked, total] = map.get(r.scenario.category) ?? [0, 0];
    map.set(r.scenario.category, [blocked + (r.decision !== "allow" ? 1 : 0), total + 1]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([c, [b, t]]) => [c, b, t]);
}

export function formatReport(result: SuiteResult, format: "text" | "json" | "markdown"): string {
  const { attacks, benign } = result;
  if (format === "json") {
    const brief = (r: ScenarioResult) => ({
      id: r.scenario.id,
      kind: r.scenario.kind,
      expect: r.scenario.expect,
      decision: r.decision,
      rules: [...new Set(r.findings.map((f) => f.rule))],
      file: r.scenario.file,
    });
    return JSON.stringify(
      {
        attacks,
        benign,
        misses: result.misses.map(brief),
        knownMisses: result.knownMisses.map(brief),
        results: result.results.map(brief),
      },
      null,
      2,
    );
  }

  const headline = `${attacks.blocked}/${attacks.total} attacks blocked (${pct(attacks.blocked, attacks.total)}), ${benign.allowed}/${benign.total} benign tasks allowed (${pct(benign.allowed, benign.total)})`;

  if (format === "markdown") {
    const lines = [
      "## Firebreak attack suite",
      "",
      `**${headline}**`,
      "",
      "| Category | Blocked |",
      "|---|---:|",
      ...byCategory(result).map(([c, b, t]) => `| ${c} | ${b}/${t} |`),
      "",
    ];
    if (result.misses.length) {
      lines.push("### Unexpected results", "", ...result.misses.map((r) => `- ❌ ${describe(r)}`), "");
    }
    if (result.knownMisses.length) {
      lines.push(
        "### Known limits (documented, not failures)",
        "",
        ...result.knownMisses.map((r) => `- ${describe(r)}`),
        "",
      );
    }
    return lines.join("\n");
  }

  const lines = [headline, ""];
  for (const [c, b, t] of byCategory(result)) lines.push(`  ${c.padEnd(20)} ${b}/${t} blocked`);
  if (result.misses.length) lines.push("", "Unexpected:", ...result.misses.map((r) => `  ✗ ${describe(r)}`));
  if (result.knownMisses.length)
    lines.push("", "Known limits:", ...result.knownMisses.map((r) => `  · ${describe(r)}`));
  return lines.join("\n");
}
