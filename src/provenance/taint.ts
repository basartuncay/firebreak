import { extractAtoms, normalize, resultText } from "./extract.js";

export interface TaintSource {
  server: string;
  tool: string;
  callId: string;
  label: "untrusted" | "private";
  snippet: string;
}

export type Origin = Omit<TaintSource, "snippet">;

interface Entry {
  origin: Origin;
  text: string; // normalized, lower case: used for matching
  display: string; // whitespace-collapsed original: used for snippets
  atoms: string[];
  bytes: number;
}

/** A short identifier: one token, not just digits. */
const TOKEN = /^(?=.*[a-z])[\w.#@/:-]{3,80}$/;

/** Below this length a value is only matched through atoms, never as free text. */
export const SUBSTRING_MIN_LENGTH = 40;

/** Text kept per result for substring matching; atoms are extracted from the same capped text. */
export const MAX_RESULT_CHARS = 512 * 1024;

const isLabel = (l: string): l is Origin["label"] => l === "untrusted" || l === "private";

/**
 * Remembers what tool results returned so later call arguments can be traced back to them.
 * Matching is by value: paraphrased, encoded or split values are not recognised.
 *
 * Full texts are kept for the most recent results. When a result is evicted, its atoms (addresses,
 * URLs, paths, long tokens) move to a much larger archive, so flooding the session with reads cannot
 * push an injected address out of memory.
 */
export class TaintMemory {
  private entries: Entry[] = [];
  private bytes = 0;
  private archive = new Map<string, Origin>();
  private readonly maxResults: number;
  private readonly maxBytes: number;
  private readonly maxArchivedAtoms: number;
  /** Identifiers the session used before they ever appeared in tool output (e.g. the repo it was asked about). */
  private known = new Set<string>();

  constructor(opts: { maxResults?: number; maxBytes?: number; maxArchivedAtoms?: number } = {}) {
    this.maxResults = opts.maxResults ?? 500;
    this.maxBytes = opts.maxBytes ?? 4 * 1024 * 1024;
    this.maxArchivedAtoms = opts.maxArchivedAtoms ?? 100_000;
  }

  record(origin: Omit<Origin, "label"> & { label: string }, result: unknown): void {
    this.recordText(origin, resultText(result));
  }

  recordText(origin: Omit<Origin, "label"> & { label: string }, raw: string): void {
    if (!isLabel(origin.label) || !raw) return;
    const capped = raw.length > MAX_RESULT_CHARS ? raw.slice(0, MAX_RESULT_CHARS) : raw;
    const entry: Entry = {
      origin: { server: origin.server, tool: origin.tool, callId: origin.callId, label: origin.label },
      text: normalize(capped),
      display: capped.replace(/\s+/g, " ").trim(),
      atoms: extractAtoms(capped),
      bytes: capped.length * 2,
    };
    this.entries.push(entry);
    this.bytes += entry.bytes;
    while (this.entries.length > this.maxResults || (this.bytes > this.maxBytes && this.entries.length > 1)) {
      const old = this.entries.shift()!;
      this.bytes -= old.bytes;
      for (const atom of old.atoms) this.archive.set(atom, old.origin);
    }
    while (this.archive.size > this.maxArchivedAtoms) {
      this.archive.delete(this.archive.keys().next().value!);
    }
  }

  /**
   * Call this with the argument values of every call the proxy evaluates. Short identifiers that cannot
   * be traced to tool output at that moment become "known", so later token matches on them are ignored.
   * A value an attacker introduced is traceable from the moment it is read, so it never becomes known.
   */
  noteArgs(values: string[]): void {
    for (const v of values) {
      const token = normalize(v);
      if (!TOKEN.test(token) || this.known.has(token)) continue;
      if (this.trace(v).length === 0 && this.traceToken(v).length === 0) this.known.add(token);
    }
  }

  /**
   * Whole-word match for short identifiers (account, repo, channel, branch names) that are not
   * atoms. Used only for sink arguments, where a short name decides where data goes.
   */
  traceToken(value: string): TaintSource[] {
    const token = normalize(value);
    if (!TOKEN.test(token) || this.known.has(token)) return [];
    const escaped = token.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const word = new RegExp(`(^|[^\\w.@/-])${escaped}($|[^\\w@/-])`);
    const hits: TaintSource[] = [];
    for (const entry of this.entries) {
      if (word.test(entry.text)) hits.push({ ...entry.origin, snippet: snippetAround(entry.display, token) });
    }
    return hits;
  }

  trace(value: string): TaintSource[] {
    const needle = normalize(value);
    if (needle.length < 6) return [];
    const hits: TaintSource[] = [];
    for (const entry of this.entries) {
      const atom = entry.atoms.find((a) => needle === a || (a.length >= 6 && needle.includes(a)));
      const matched = atom ?? copiedWindow(needle, entry.text);
      if (matched) hits.push({ ...entry.origin, snippet: snippetAround(entry.display, matched) });
    }
    if (hits.length === 0) {
      for (const [atom, origin] of this.archive) {
        if (needle === atom || (atom.length >= 6 && needle.includes(atom))) {
          hits.push({ ...origin, snippet: `${atom} (from an earlier result)` });
          break;
        }
      }
    }
    return hits;
  }
}

/** A SUBSTRING_MIN_LENGTH-long piece of the value that appears verbatim in the result, if any. */
function copiedWindow(needle: string, text: string): string | null {
  if (needle.length < SUBSTRING_MIN_LENGTH) return null;
  const step = SUBSTRING_MIN_LENGTH / 2;
  for (let i = 0; i + SUBSTRING_MIN_LENGTH <= needle.length; i += step) {
    const window = needle.slice(i, i + SUBSTRING_MIN_LENGTH);
    if (text.includes(window)) return window;
  }
  const tail = needle.slice(-SUBSTRING_MIN_LENGTH);
  return text.includes(tail) ? tail : null;
}

/** Case-insensitive search in the original text, so snippets keep the source's own spelling. */
function snippetAround(text: string, needle: string): string {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  const at = text.search(new RegExp(escaped, "i"));
  if (at < 0) return text.slice(0, 80);
  const start = Math.max(0, at - 30);
  const out = text.slice(start, Math.min(text.length, at + needle.length + 30));
  return (start > 0 ? "…" : "") + out + (at + needle.length + 30 < text.length ? "…" : "");
}
