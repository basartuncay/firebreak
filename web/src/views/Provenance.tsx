import type { ArgProvenance, Finding } from "../api";

/** Renders the snippet with the matched value highlighted, so the user sees the exact origin. */
function Highlighted({ snippet, value }: { snippet: string; value: string }) {
  const lower = snippet.toLowerCase();
  const needle = value.toLowerCase().replace(/\s+/g, " ").trim();
  let at = lower.indexOf(needle);
  let len = needle.length;
  if (at < 0) {
    // The value contained an atom (an address, a URL): highlight the longest token of the value found.
    const token = needle
      .split(/[\s,;]+/)
      .filter((t) => t.length >= 6)
      .sort((a, b) => b.length - a.length)
      .find((t) => lower.includes(t));
    if (token) {
      at = lower.indexOf(token);
      len = token.length;
    }
  }
  if (at < 0) return <>{snippet}</>;
  return (
    <>
      {snippet.slice(0, at)}
      <mark>{snippet.slice(at, at + len)}</mark>
      {snippet.slice(at + len)}
    </>
  );
}

const pretty = (value: unknown): string => {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
};

/** One row per argument: value, and for tainted values the tool output they came from. */
export function ArgumentTable({
  args,
  provenance,
  findings,
}: {
  args: unknown;
  provenance: ArgProvenance[];
  findings: Finding[];
}) {
  const flagged = new Set(findings.map((f) => f.argPath).filter(Boolean));
  const byPath = new Map(provenance.map((p) => [p.path, p]));
  const entries =
    args && typeof args === "object" && !Array.isArray(args)
      ? Object.entries(args as Record<string, unknown>)
      : [["(arguments)", args] as [string, unknown]];

  // Nested paths ("recipients[0].email") belong to their top-level argument.
  const nested = (key: string) =>
    provenance.filter((p) => p.path === key || p.path.startsWith(`${key}[`) || p.path.startsWith(`${key}.`));

  return (
    <dl className="args">
      {entries.map(([key, value]) => {
        const sources = byPath.has(key) ? [byPath.get(key)!] : nested(key);
        const isFlagged = [...flagged].some(
          (p) => p === key || p?.startsWith(`${key}[`) || p?.startsWith(`${key}.`),
        );
        return (
          <div key={key} className={`arg ${isFlagged ? "flagged" : ""}`}>
            <dt>{key}</dt>
            <dd>
              <pre className="value">{pretty(value)}</pre>
              {sources.map((p) =>
                p.sources.slice(0, 2).map((s) => (
                  <div className={`origin ${s.label}`} key={`${p.path}-${s.callId}`}>
                    <span className="origin-label">
                      {p.path !== key ? `${p.path} ` : ""}came from{" "}
                      <strong>
                        {s.server}/{s.tool}
                      </strong>{" "}
                      ({s.label === "private" ? "your private data" : "untrusted output"})
                    </span>
                    <blockquote>
                      <Highlighted snippet={s.snippet} value={p.value} />
                    </blockquote>
                  </div>
                )),
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

const RULE_NAMES: Record<string, string> = {
  F1: "Destination from untrusted output",
  F2: "Secret or private data leaving",
  F3: "Destructive action",
  F4: "Data crossing servers",
  F5: "Rate limit",
  F6: "Tool integrity",
};

export function Findings({ findings }: { findings: Finding[] }) {
  return (
    <ul className="findings">
      {findings.map((f) => (
        <li key={`${f.rule}-${f.argPath ?? ""}-${f.message}`} className={f.decision}>
          <span className="rule">
            {f.rule} <span className="rule-name">{RULE_NAMES[f.rule] ?? ""}</span>
          </span>
          <span className="msg">{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function DecisionChip({ decision, approval }: { decision: string; approval?: string | undefined }) {
  const label =
    decision === "confirm" && approval
      ? { approved: "approved", denied: "denied", expired: "timed out", cancelled: "cancelled" }[approval]
      : decision === "confirm"
        ? "asked"
        : decision === "allow"
          ? "allowed"
          : "blocked";
  const tone = decision === "confirm" && approval ? (approval === "approved" ? "allow" : "deny") : decision;
  return <span className={`chip ${tone}`}>{label}</span>;
}
