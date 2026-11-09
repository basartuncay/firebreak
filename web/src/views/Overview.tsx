import { useEffect, useState } from "react";
import { api, type Stats } from "../api";

const RULES: [string, string][] = [
  ["F1", "Destination came from untrusted output"],
  ["F2", "Secret or private data leaving"],
  ["F3", "Destructive action"],
  ["F4", "Data crossing between servers"],
  ["F5", "Rate limit reached"],
  ["F6", "Tool changed or poisoned"],
];

export function Overview({ stats }: { stats: Stats | null }) {
  const [chain, setChain] = useState<Stats["chain"]>();
  useEffect(() => {
    api.chain().then(setChain, () => {});
  }, []);
  if (!stats) return <p className="muted">Loading…</p>;
  const max = Math.max(1, ...Object.values(stats.rules));
  const d = stats.decisions;
  return (
    <section>
      <h1>Last 24 hours</h1>
      <div className="numbers">
        <div>
          <span className="n">{stats.total}</span>
          <span className="l">tool calls checked</span>
        </div>
        <div>
          <span className="n">{d.allow ?? 0}</span>
          <span className="l">allowed straight through</span>
        </div>
        <div>
          <span className="n">{d.confirm ?? 0}</span>
          <span className="l">needed your approval</span>
        </div>
        <div>
          <span className="n">{d.deny ?? 0}</span>
          <span className="l">blocked outright</span>
        </div>
      </div>

      <h2 className="sub">Why calls were stopped</h2>
      <ul className="bars">
        {RULES.map(([id, label]) => {
          const n = stats.rules[id] ?? 0;
          return (
            <li key={id}>
              <span className="rule">{id}</span>
              <span className="label">{label}</span>
              <span className="bar" aria-hidden="true">
                <span style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="count">{n}</span>
            </li>
          );
        })}
      </ul>

      <h2 className="sub">Audit log</h2>
      {!chain ? (
        <p className="muted">Checking…</p>
      ) : chain.ok ? (
        <p>
          <span className="chip allow">intact</span> {chain.count} events, every hash links to the one before
          it.
        </p>
      ) : (
        <p role="alert">
          <span className="chip deny">broken</span> Event #{chain.brokenAt} or an earlier one was changed or
          deleted outside Firebreak.
        </p>
      )}
    </section>
  );
}
