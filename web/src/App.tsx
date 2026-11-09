import { useCallback, useEffect, useState } from "react";
import { api, type Stats, subscribe } from "./api";
import { Activity } from "./views/Activity";
import { Approvals } from "./views/Approvals";
import { Overview } from "./views/Overview";
import { Tools } from "./views/Tools";

const VIEWS = ["approvals", "activity", "tools", "overview"] as const;
type View = (typeof VIEWS)[number];
const LABELS: Record<View, string> = {
  approvals: "Approvals",
  activity: "Activity",
  tools: "Tools",
  overview: "Overview",
};

const fromHash = (): View => {
  const h = location.hash.slice(1) as View;
  return VIEWS.includes(h) ? h : "approvals";
};

export function App() {
  const [view, setView] = useState<View>(fromHash);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tick, setTick] = useState(0);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const onHash = () => setView(fromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => subscribe(refresh), [refresh]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the refresh signal
  useEffect(() => {
    api
      .stats()
      .then((s) => {
        setStats(s);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, [tick]);

  // Safety net if the live stream drops: refresh every 10 seconds.
  useEffect(() => {
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    document.title = stats?.pending ? `(${stats.pending}) Firebreak` : "Firebreak";
  }, [stats?.pending]);

  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="#approvals" aria-label="Firebreak home">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--forest)" />
            <path d="M8 8v16M16 8v16M24 8v16" stroke="var(--ember)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Firebreak
        </a>
        <nav aria-label="Views">
          {VIEWS.map((v) => (
            <a key={v} href={`#${v}`} aria-current={view === v ? "page" : undefined}>
              {LABELS[v]}
              {v === "approvals" && stats?.pending ? <span className="badge">{stats.pending}</span> : null}
              {v === "tools" && stats?.tools.quarantined ? (
                <span className="badge warn">{stats.tools.quarantined}</span>
              ) : null}
            </a>
          ))}
        </nav>
        <span className={`live ${offline ? "down" : ""}`} role="status">
          {offline ? "Not connected" : "Live"}
        </span>
      </header>
      {offline && (
        <p className="banner">
          The dashboard lost its connection to <code>firebreak ui</code>. Check that it is still running, then
          reload.
        </p>
      )}
      <main>
        {view === "approvals" && <Approvals tick={tick} onChange={refresh} />}
        {view === "activity" && <Activity tick={tick} />}
        {view === "tools" && <Tools tick={tick} onChange={refresh} />}
        {view === "overview" && <Overview stats={stats} />}
      </main>
    </div>
  );
}
