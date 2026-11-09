import { useEffect, useState } from "react";
import { api, type Pin, timeAgo } from "../api";

const REASONS: Record<string, string> = {
  "definition-changed": "definition changed after you approved it",
  "instructs-model": "description gives instructions to the model",
  "hidden-unicode": "description contains invisible characters",
  "credential-reference": "description mentions credentials or key files",
};

const STATUS: Record<Pin["status"], string> = {
  pinned: "Pinned",
  suspicious: "Suspicious",
  quarantined: "Hidden until you approve",
};

export function Tools({ tick, onChange }: { tick: number; onChange: () => void }) {
  const [tools, setTools] = useState<Pin[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the refresh signal
  useEffect(() => {
    api.tools().then(
      (r) => setTools(r.tools),
      () => {},
    );
  }, [tick]);

  const approve = async (p: Pin) => {
    setError(null);
    try {
      await api.approveTool(p.server, p.name);
      onChange();
    } catch (e) {
      setError(`Could not approve ${p.server}/${p.name}: ${(e as Error).message}`);
    }
  };

  if (!tools) return <p className="muted">Loading…</p>;
  const attention = tools.filter((t) => t.status !== "pinned");
  const servers = [...new Set(tools.map((t) => t.server))];

  return (
    <section>
      <h1>Tools</h1>
      <p className="muted intro">
        Firebreak pins each tool's name, description and input schema the first time your client lists it. If
        a server later changes a definition, the tool is hidden from the agent until you approve the new
        version.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {attention.map((p) => (
        <article key={`${p.server}/${p.name}`} className={`card tool ${p.status}`}>
          <header>
            <h2>
              <span className="server">{p.server}/</span>
              {p.name}
            </h2>
            <span className={`chip ${p.status === "quarantined" ? "deny" : "confirm"}`}>
              {STATUS[p.status]}
            </span>
          </header>
          <ul className="reasons">
            {p.reasons.map((r) => (
              <li key={r}>{REASONS[r] ?? r}</li>
            ))}
          </ul>
          {p.status === "quarantined" && p.previousDescription !== undefined ? (
            <div className="diff">
              <div>
                <h3>Approved before</h3>
                <pre>{p.previousDescription || "(empty)"}</pre>
              </div>
              <div>
                <h3>Now</h3>
                <pre>{p.description || "(empty)"}</pre>
              </div>
            </div>
          ) : (
            <pre className="desc">{p.description}</pre>
          )}
          <button type="button" className="approve" onClick={() => approve(p)}>
            {p.status === "quarantined" ? "Approve new version" : "Mark as reviewed"}
          </button>
        </article>
      ))}
      {servers.length === 0 ? (
        <div className="empty">
          <p>No tools pinned yet.</p>
          <p className="muted">Tools are pinned the first time a client lists them through Firebreak.</p>
        </div>
      ) : (
        servers.map((server) => (
          <div key={server} className="server-group">
            <h2 className="sub">{server}</h2>
            <ul className="toollist">
              {tools
                .filter((t) => t.server === server)
                .map((t) => (
                  <li key={t.name}>
                    <span className={`dot ${t.status}`} aria-hidden="true" />
                    <span className="name">{t.name}</span>
                    <span className="muted">{STATUS[t.status]}</span>
                    <span className="muted right">first seen {timeAgo(t.firstSeen)}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
