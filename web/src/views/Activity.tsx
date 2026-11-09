import { useEffect, useState } from "react";
import { type AuditEvent, api, timeAgo } from "../api";
import { ArgumentTable, DecisionChip, Findings } from "./Provenance";

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
        <table className="events">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Tool</th>
              <th scope="col">Outcome</th>
              <th scope="col">Rules</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                open={open === e.id}
                onToggle={() => setOpen(open === e.id ? null : e.id)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function EventRow({ event: e, open, onToggle }: { event: AuditEvent; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={open ? "open" : ""}>
        <td className="muted" title={e.ts}>
          {timeAgo(e.ts)}
        </td>
        <td>
          <button type="button" className="link" aria-expanded={open} onClick={onToggle}>
            <span className="server">{e.server}/</span>
            {e.tool}
          </button>
        </td>
        <td>
          <DecisionChip decision={e.decision} approval={e.approval} />
        </td>
        <td className="rules">{[...new Set(e.findings.map((f) => f.rule))].join(" ")}</td>
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={4}>
            {e.findings.length > 0 && <Findings findings={e.findings} />}
            <ArgumentTable args={e.args} provenance={e.provenance} findings={e.findings} />
            <p className="hash muted">
              #{e.id} · {e.latencyMs ?? "–"} ms · result {e.resultBytes ?? 0} bytes · hash{" "}
              <code>{e.hash.slice(0, 16)}…</code>
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
