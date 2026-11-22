import { type ReactNode, useEffect, useRef, useState } from "react";
import { type Approval, api, timeAgo } from "../api";
import { ArgumentTable, DecisionChip, Findings } from "./Provenance";

/** The one sentence a tired person reads first: what the call wants and where the value came from. */
function summary(a: Approval): ReactNode {
  const f = a.findings.find((x) => x.argPath);
  const p = f && a.provenance.find((x) => x.path === f.argPath);
  const s = p?.sources[0];
  if (!p || !s) return a.findings[0]?.message ?? null;
  const from = (
    <code>
      {s.server}/{s.tool}
    </code>
  );
  if (s.label === "private") {
    return (
      <>
        It would send private data read from {from} out of your machine, in <code>{p.path}</code>.
      </>
    );
  }
  // Long values are shown in full in the evidence below; the sentence never cuts them.
  const value = p.value.length <= 120 ? <code className="hl">{p.value}</code> : "the value below";
  return (
    <>
      It wants to use {value} as <code>{p.path}</code>. That value came from untrusted output of {from}, not
      from you.
    </>
  );
}

function ApprovalCard({
  approval,
  onDone,
  focus,
}: {
  approval: Approval;
  onDone: () => void;
  focus: boolean;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // Opened by the user (or the next one after a decision): move focus to its question, never to a button.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, []);

  const decide = async (decision: "approved" | "denied") => {
    if (sent.current) return; // one decision per call, even on a fast double click
    sent.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.decide(approval.id, decision, reason || undefined);
      onDone();
    } catch (e) {
      sent.current = false;
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <article className="call" aria-labelledby={`a-${approval.id}`}>
      <p className="call-meta">
        <span className="mono">#{approval.id}</span>
        <span>asked {timeAgo(approval.createdAt)}</span>
      </p>
      <h2 className="question" id={`a-${approval.id}`} ref={heading} tabIndex={-1}>
        Approve{" "}
        <code>
          {approval.server}/{approval.tool}
        </code>
        ?
      </h2>
      <p className="lead">{summary(approval)}</p>
      <Findings findings={approval.findings} />
      <ArgumentTable args={approval.args} provenance={approval.provenance} findings={approval.findings} />
      <div className="decide">
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
        <p className="hint">
          The agent waits for your answer. If nobody answers before the timeout, the call is denied.
        </p>
        {error && (
          <p className="error" role="alert">
            Could not save the decision: {error}
          </p>
        )}
      </div>
    </article>
  );
}

export function Approvals({ tick, onChange }: { tick: number; onChange: () => void }) {
  const [data, setData] = useState<{ pending: Approval[]; recent: Approval[] } | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [moveFocus, setMoveFocus] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the refresh signal
  useEffect(() => {
    api.approvals().then(setData, () => {});
  }, [tick]);

  if (!data) return <p className="muted">Loading…</p>;
  const decided = data.recent.filter((a) => a.status !== "pending").slice(0, 8);
  // The first call in the server's order is open; the others wait in the index until chosen.
  const openId = data.pending.some((a) => a.id === chosen) ? chosen : data.pending[0]?.id;

  return (
    <section>
      <h1>Waiting for you</h1>
      {data.pending.length === 0 ? (
        <div className="empty">
          <p className="say">Nothing is waiting.</p>
          <p className="muted">
            When an agent tries something risky, the call stops here until you decide. The agent waits; if
            nobody answers before the timeout, the call is denied.
          </p>
        </div>
      ) : (
        <ol className="queue">
          {data.pending.map((a) => (
            <li key={a.id}>
              {a.id === openId ? (
                <ApprovalCard
                  approval={a}
                  focus={moveFocus}
                  onDone={() => {
                    setMoveFocus(true);
                    onChange();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="queued"
                  onClick={() => {
                    setMoveFocus(true);
                    setChosen(a.id);
                  }}
                >
                  <span className="when">{timeAgo(a.createdAt)}</span>
                  <span className="what">
                    <code>
                      <span className="server">{a.server}/</span>
                      {a.tool}
                    </code>{" "}
                    <span className="muted">{a.findings[0]?.message}</span>
                  </span>
                  <span className="open-label">Review</span>
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {decided.length > 0 && (
        <>
          <h2 className="sub">Recently decided</h2>
          <ol className="index recent">
            {decided.map((a) => (
              <li key={a.id}>
                <span className="when">{timeAgo(a.decidedAt ?? a.createdAt)}</span>
                <DecisionChip decision="confirm" approval={a.status} />
                <code>
                  {a.server}/{a.tool}
                </code>
                <span className="who">
                  {a.decidedBy === "timeout" ? "no answer" : `by ${a.decidedBy}`}
                  {a.reason ? ` — “${a.reason}”` : ""}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
