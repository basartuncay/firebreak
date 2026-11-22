import { type ReactNode, useMemo } from "react";
import type { ArgProvenance, Finding } from "../api";
import { hiddenCount, lookalikes, markInExcerpt, markInValue, type Range, visibleParts } from "../text";

/**
 * Untrusted text as it really is: invisible and reordering characters are drawn as ⟨U+XXXX⟩ chips.
 * `pre` keeps newline and tab (for pre-wrap blocks); without it they are drawn as chips too.
 */
export function Shown({ text, pre = false }: { text: string; pre?: boolean }) {
  const parts = useMemo(() => visibleParts(text, pre), [text, pre]);
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          p
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <span key={i} className="cp" title={`Invisible character: ${p.name}`}>
            ⟨{p.code}⟩
          </span>
        ),
      )}
    </>
  );
}

/** Renders pre-wrap text with the given ranges marked. Ranges come from the original string. */
function Marked({ text, ranges }: { text: string; ranges: Range[] }) {
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const r of ranges) {
    parts.push(
      <Shown key={`t${pos}`} text={text.slice(pos, r.at)} pre />,
      <mark key={r.at}>
        <Shown text={text.slice(r.at, r.at + r.len)} pre />
      </mark>,
    );
    pos = r.at + r.len;
  }
  parts.push(<Shown key={`t${pos}`} text={text.slice(pos)} pre />);
  return <>{parts}</>;
}

/** Plain warnings for a value the user may approve: hidden characters, letters from mixed scripts. */
function ValueWarnings({ text }: { text: string }) {
  const hidden = useMemo(() => hiddenCount(text), [text]);
  const mixed = useMemo(() => lookalikes(text), [text]);
  return (
    <>
      {hidden > 0 && (
        <p className="warn-line">
          <strong>Hidden characters.</strong> This value holds {hidden} invisible or direction-changing{" "}
          {hidden === 1 ? "character" : "characters"}, shown above as ⟨U+…⟩. The tool receives the real
          characters, so it may not read the way it looks.
        </p>
      )}
      {mixed.map((m) => (
        <p className="warn-line" key={m.token}>
          <strong>Lookalike letters.</strong>{" "}
          <code>
            <Shown text={m.token} />
          </code>{" "}
          mixes {m.scripts.join(" and ")} letters, so it may imitate a different address.
        </p>
      ))}
    </>
  );
}

// The dashboard cannot tell the gateway's cut from a "…" in the source itself, so it does not claim either.
const CUT_TITLE =
  "Probably cut here: Firebreak marks a shortened excerpt with “…”, but the source text itself may also contain “…”.";

/**
 * The gateway stores a window around the match and marks its cut ends with "…". Those ends are shown
 * as labelled markers, so they never read as part of the source text.
 */
function SourceExcerpt({ snippet, value }: { snippet: string; value: string }) {
  const before = snippet.startsWith("…");
  const after = snippet.endsWith("…") && snippet.length > 1;
  const body = snippet.slice(before ? 1 : 0, after ? -1 : undefined);
  const range = useMemo(() => markInExcerpt(body, value, { before, after }), [body, value, before, after]);
  return (
    <>
      <blockquote>
        {before && (
          <span className="cut" title={CUT_TITLE}>
            […?]{" "}
          </span>
        )}
        <Marked text={body} ranges={range ? [range] : []} />
        {after && (
          <span className="cut" title={CUT_TITLE}>
            {" "}
            […?]
          </span>
        )}
      </blockquote>
      {range?.partial && (
        <p className="note">
          Partial match: the excerpt holds only part of the value, and only that part is marked.
        </p>
      )}
      {!range && value.trim() && (
        <p className="note">
          This excerpt does not hold the traced value as one piece, so nothing is marked.
        </p>
      )}
    </>
  );
}

const pretty = (value: unknown): string => {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
};

/** The argument as sent. Only an exact occurrence of the traced value is marked; otherwise it is said in words. */
function ArgValue({ text, traced }: { text: string; traced: string | undefined }) {
  const ranges = useMemo(() => (traced ? markInValue(text, traced) : []), [text, traced]);
  return (
    <>
      <pre className="value">
        <Marked text={text} ranges={ranges} />
      </pre>
      {traced && ranges.length === 0 && (
        <p className="note">
          This argument carries the traced value, but not as one exact piece of text, so nothing is marked.
        </p>
      )}
      <ValueWarnings text={text} />
    </>
  );
}

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
        // shortcut: marks the first traced value only; several traced paths inside one argument show one mark.
        const traced = isFlagged ? sources[0]?.value : undefined;
        return (
          <div key={key} className={`arg ${isFlagged ? "flagged" : ""}`}>
            <dt>
              <Shown text={key} />
            </dt>
            <dd>
              <ArgValue text={pretty(value)} traced={traced} />
              {sources.map((p) =>
                p.sources.slice(0, 2).map((s) => (
                  <div className={`origin ${s.label}`} key={`${p.path}-${s.callId}`}>
                    <span className="origin-label">
                      {p.path !== key && (
                        <>
                          <code>
                            <Shown text={p.path} />
                          </code>{" "}
                        </>
                      )}
                      came from{" "}
                      <strong>
                        <Shown text={`${s.server}/${s.tool}`} />
                      </strong>{" "}
                      ({s.label === "private" ? "your private data" : "untrusted output"})
                    </span>
                    <SourceExcerpt snippet={s.snippet} value={p.value} />
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
          <span className="msg">
            <Shown text={f.message} />
          </span>
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
