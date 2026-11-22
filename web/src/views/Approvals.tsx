import { type ReactNode, useEffect, useRef, useState } from "react";
import { type Approval, api, timeAgo } from "../api";
import { ArgumentTable, DecisionChip, Findings, Shown } from "./Provenance";

/** The one sentence a tired person reads first: what the call wants and where the value came from. */
function summary(a: Approval): ReactNode {
  const f = a.findings.find((x) => x.argPath);
  const p = f && a.provenance.find((x) => x.path === f.argPath);
  const s = p?.sources[0];
  if (!p || !s) return a.findings[0]?.message ?? null;
  const from = (
    <code>
      <Shown text={`${s.server}/${s.tool}`} />
    </code>
  );
  const path = (
    <code>
      <Shown text={p.path} />
    </code>
  );
  if (s.label === "private") {
    return (
      <>
        It would pass private data read from {from}, in {path}, to a tool that sends data outside.
      </>
    );
  }
  // Long values are shown in full in the evidence below; the sentence never cuts them. Its whitespace is
  // kept (pre-wrap) and hidden characters are drawn, so nothing in the value vanishes from the sentence.
  const value =
    p.value.length <= 120 ? (
      <code className="hl">
        <Shown text={p.value} pre />
      </code>
    ) : (
      "the value below"
    );
  return (
    <>
      It wants to use {value} as {path}. That value came from untrusted output of {from}, not from you.
    </>
  );
}

/** After a card opens, Approve and Deny ignore activation this long, so a click meant for the card that was
 * just in this place (decided, timed out or decided elsewhere) cannot land on the next one. */
const ARM_MS = 600;

function ApprovalCard({
  approval,
  onDone,
  focus,
  reason,
  onReason,
}: {
  approval: Approval;
  onDone: () => void;
  focus: boolean;
  reason: string;
  onReason: (reason: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // Opened by the user (or the next one after a decision): move focus to its question, never to a button.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(t);
  }, []);

  const decide = async (decision: "approved" | "denied") => {
    if (!armed || sent.current) return; // one decision per call, even on a fast double click
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
          <Shown text={`${approval.server}/${approval.tool}`} />
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
            onChange={(e) => onReason(e.target.value)}
            placeholder="e.g. never send invoices outside the company"
            maxLength={500}
          />
        </label>
        <div className="actions">
          <button
            type="button"
            className={`deny ${armed ? "" : "waiting"}`}
            disabled={busy || !armed}
            onClick={() => decide("denied")}
          >
            Deny
          </button>
          <button
            type="button"
            className={`approve ${armed ? "" : "waiting"}`}
            disabled={busy || !armed}
            onClick={() => decide("approved")}
          >
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
  // Typed notes per call, in memory only: kept while the user switches calls, dropped once it is decided.
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [replaced, setReplaced] = useState<{ gone: number; now: number | undefined } | null>(null);
  const viewing = useRef<number | undefined>(undefined);
  const decidedHere = useRef(new Set<number>());
  const title = useRef<HTMLHeadingElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the refresh signal
  useEffect(() => {
    api.approvals().then(setData, () => {});
  }, [tick]);

  // The first call in the server's order is open; the others wait in the index until chosen.
  const openId = data?.pending.some((a) => a.id === chosen) ? chosen : data?.pending[0]?.id;

  // When the open call goes away without the user deciding it here, say which call took its place.
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.pending.map((a) => a.id));
    setNotes((n) => {
      const kept = Object.entries(n).filter(([id]) => ids.has(Number(id)));
      return kept.length === Object.keys(n).length ? n : Object.fromEntries(kept);
    });
    const before = viewing.current;
    viewing.current = openId ?? undefined;
    if (before === undefined || before === openId) return;
    setReplaced(
      ids.has(before) || decidedHere.current.has(before) ? null : { gone: before, now: openId ?? undefined },
    );
  }, [data, openId]);

  // After the last waiting call is decided, focus goes to the page heading instead of being lost.
  useEffect(() => {
    if (data && data.pending.length === 0 && moveFocus) {
      title.current?.focus();
      setMoveFocus(false);
    }
  }, [data, moveFocus]);

  if (!data) return <p className="muted">Loading…</p>;
  const decided = data.recent.filter((a) => a.status !== "pending").slice(0, 8);

  return (
    <section>
      <h1 ref={title} tabIndex={-1}>
        Waiting for you
      </h1>
      {replaced && (
        <p className="replaced" role="status">
          Call <span className="mono">#{replaced.gone}</span> is no longer waiting: it timed out or was
          decided elsewhere.
          {replaced.now !== undefined && (
            <>
              {" "}
              You are now looking at call <span className="mono">#{replaced.now}</span>.
            </>
          )}
        </p>
      )}
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
                  reason={notes[a.id] ?? ""}
                  onReason={(r) => setNotes((n) => ({ ...n, [a.id]: r }))}
                  onDone={() => {
                    decidedHere.current.add(a.id);
                    setNotes(({ [a.id]: _, ...rest }) => rest);
                    setReplaced(null);
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
                      <span className="server">
                        <Shown text={`${a.server}/`} />
                      </span>
                      <Shown text={a.tool} />
                    </code>{" "}
                    <span className="muted">
                      <Shown text={a.findings[0]?.message ?? ""} />
                    </span>
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
                  <Shown text={`${a.server}/${a.tool}`} />
                </code>
                <span className="who">
                  {a.decidedBy === "timeout" ? "no answer" : `by ${a.decidedBy}`}
                  {a.reason && (
                    <>
                      {" — “"}
                      <Shown text={a.reason} />”
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
