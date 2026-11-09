import { useEffect, useState } from "react";
import { type Approval, api, timeAgo } from "../api";
import { ArgumentTable, DecisionChip, Findings } from "./Provenance";

function ApprovalCard({ approval, onDone }: { approval: Approval; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "approved" | "denied") => {
    setBusy(true);
    setError(null);
    try {
      await api.decide(approval.id, decision, reason || undefined);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <article className="card approval" aria-labelledby={`a-${approval.id}`}>
      <header>
        <h2 id={`a-${approval.id}`}>
          <span className="server">{approval.server}/</span>
          {approval.tool}
        </h2>
        <span className="meta">
          #{approval.id} · {timeAgo(approval.createdAt)}
        </span>
      </header>
      <Findings findings={approval.findings} />
      <ArgumentTable args={approval.args} provenance={approval.provenance} findings={approval.findings} />
      <footer>
        <label className="reason">
          <span>Note for the agent (optional)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. never send invoices outside the company"
            maxLength={500}
          />
        </label>
        <div className="actions">
          <button type="button" className="deny" disabled={busy} onClick={() => decide("denied")}>
            Deny
          </button>
          <button type="button" className="approve" disabled={busy} onClick={() => decide("approved")}>
            Approve once
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            Could not save the decision: {error}
          </p>
        )}
      </footer>
    </article>
  );
}

export function Approvals({ tick, onChange }: { tick: number; onChange: () => void }) {
  const [data, setData] = useState<{ pending: Approval[]; recent: Approval[] } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the refresh signal
  useEffect(() => {
    api.approvals().then(setData, () => {});
  }, [tick]);

  if (!data) return <p className="muted">Loading…</p>;
  const decided = data.recent.filter((a) => a.status !== "pending").slice(0, 8);

  return (
    <section>
      <h1>Waiting for you</h1>
      {data.pending.length === 0 ? (
        <div className="empty">
          <p>Nothing is waiting.</p>
          <p className="muted">
            When an agent tries something risky, the call stops here until you decide. The agent waits; if
            nobody answers before the timeout, the call is denied.
          </p>
        </div>
      ) : (
        <div className="stack">
          {data.pending.map((a) => (
            <ApprovalCard key={a.id} approval={a} onDone={onChange} />
          ))}
        </div>
      )}
      {decided.length > 0 && (
        <>
          <h2 className="sub">Recently decided</h2>
          <ul className="recent">
            {decided.map((a) => (
              <li key={a.id}>
                <DecisionChip decision="confirm" approval={a.status} />
                <span>
                  {a.server}/{a.tool}
                </span>
                <span className="muted">
                  {a.decidedBy === "timeout" ? "no answer" : `by ${a.decidedBy}`}
                  {a.reason ? ` — “${a.reason}”` : ""}
                </span>
                <span className="muted right">{timeAgo(a.decidedAt ?? a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
