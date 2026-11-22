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
  const d = stats.decisions;
  const numbers: [number, string][] = [
    [stats.total, "tool calls checked"],
    [d.allow ?? 0, "allowed straight through"],
    [d.confirm ?? 0, "needed your approval"],
    [d.deny ?? 0, "blocked outright"],
  ];
  return (
    <section>
      <h1>Last 24 hours</h1>
      <dl className="numbers">
        {numbers.map(([n, label]) => (
          <div key={label}>
            <dt className="label">{label}</dt>
            <dd className="big">{n}</dd>
          </div>
        ))}
      </dl>

      <h2 className="sub">Why calls were stopped</h2>
      <ul className="index rules-list">
        {RULES.map(([id, label]) => {
          const n = stats.rules[id] ?? 0;
          return (
            <li key={id}>
              <span className="rule">{id}</span>
              <span className="label">{label}</span>
              <span className={`n ${n === 0 ? "zero" : ""}`}>{n}</span>
            </li>
          );
        })}
      </ul>

      <h2 className="sub">Audit log</h2>
      {!chain ? (
        <p className="muted">Checking…</p>
      ) : chain.ok ? (
        <p className="chain">
          <span className="chip allow">intact</span> {chain.count} events, every hash links to the one before
          it.
        </p>
      ) : (
        <p className="chain" role="alert">
          <span className="chip deny">broken</span> Event #{chain.brokenAt} or an earlier one was changed or
          deleted outside Firebreak.
        </p>
      )}
    </section>
  );
}
