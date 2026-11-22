import { useEffect, useState } from "react";
import { type AuditEvent, api, timeAgo } from "../api";
import { ArgumentTable, DecisionChip, Findings, Shown } from "./Provenance";

export function Activity({ tick }: { tick: number }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [decision, setDecision] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the refresh signal
  useEffect(() => {
    const id = setTimeout(() => {
      api.events({ decision, search }).then(
        (r) => setEvents(r.events),
        () => {},
      );
    }, 150);
    return () => clearTimeout(id);
  }, [tick, decision, search]);

  return (
    <section>
      <h1>Activity</h1>
      <div className="filters">
        <label>
          <span>Decision</span>
          <select value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option value="">All</option>
            <option value="allow">Allowed</option>
            <option value="confirm">Asked you</option>
            <option value="deny">Blocked</option>
          </select>
        </label>
        <label className="grow">
          <span>Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="tool, argument value, rule…"
          />
        </label>
      </div>
      {events === null ? (
        <p className="muted">Loading…</p>
      ) : events.length === 0 ? (
        <div className="empty">
          <p>No tool calls {decision || search ? "match these filters" : "yet"}.</p>
          {!decision && !search && (
            <p className="muted">
              Wrap a server with <code>firebreak install</code> and every call your agent makes will show up
              here.
            </p>
          )}
        </div>
      ) : (
        <ol className="index events">
          {events.map((e) => (
            <EventRow
              key={e.id}
              event={e}
              open={open === e.id}
              onToggle={() => setOpen(open === e.id ? null : e.id)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

/** Wall-clock time, so a row reads the same while you look at it; the date is added for older days. */
const clock = (iso: string): string => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
};

function EventRow({ event: e, open, onToggle }: { event: AuditEvent; open: boolean; onToggle: () => void }) {
  const rules = [...new Set(e.findings.map((f) => f.rule))].join(" ");
  return (
    <li>
      <button type="button" className="row" aria-expanded={open} onClick={onToggle}>
        <time className="when" dateTime={e.ts} title={`${e.ts} (${timeAgo(e.ts)})`}>
          {clock(e.ts)}
        </time>
        <DecisionChip decision={e.decision} approval={e.approval} />
        <span className="main">
          <span className="tool">
            <span className="server">
              <Shown text={`${e.server}/`} />
            </span>
            <Shown text={e.tool} />
          </span>
          <span className="line">
            <Shown text={e.findings[0]?.message ?? "No rule applied."} />
          </span>
        </span>
        <span className="rules">{rules}</span>
      </button>
      {open && (
        <div className="detail">
          {e.findings.length > 0 && <Findings findings={e.findings} />}
          <ArgumentTable args={e.args} provenance={e.provenance} findings={e.findings} />
          <p className="hash muted">
            #{e.id} · {e.latencyMs ?? "–"} ms · result {e.resultBytes ?? 0} bytes · hash <code>{e.hash}</code>
          </p>
        </div>
      )}
    </li>
  );
}
