import { extractAtoms, normalize, resultText } from "./extract.js";

export interface TaintSource {
  server: string;
  tool: string;
  callId: string;
  label: "untrusted" | "private";
  snippet: string;
}

type Origin = Omit<TaintSource, "snippet">;

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

/**
 * Remembers what tool results returned in one session so later call arguments can be traced back
 * to them. Matching is by value: paraphrased, encoded or split values are not recognised.
 */
export class TaintMemory {
  private entries: Entry[] = [];
  private bytes = 0;
  private readonly maxResults: number;
  private readonly maxBytes: number;
  /** Identifiers the session used before they ever appeared in tool output (e.g. the repo it was asked about). */
  private known = new Set<string>();

  constructor(opts: { maxResults?: number; maxBytes?: number } = {}) {
    this.maxResults = opts.maxResults ?? 500;
    this.maxBytes = opts.maxBytes ?? 4 * 1024 * 1024;
  }

  record(origin: Origin | (Omit<Origin, "label"> & { label: string }), result: unknown): void {
    if (origin.label !== "untrusted" && origin.label !== "private") return;
    const raw = resultText(result);
    if (!raw) return;
    const display = raw.replace(/\s+/g, " ").trim();
    const text = normalize(raw);
    const entry: Entry = {
      origin: origin as Origin,
      text,
      display,
      atoms: extractAtoms(raw),
      bytes: text.length * 2,
    };
    this.entries.push(entry);
    this.bytes += entry.bytes;
    while (this.entries.length > this.maxResults || (this.bytes > this.maxBytes && this.entries.length > 1)) {
      this.bytes -= this.entries.shift()!.bytes;
    }
  }

  /**
   * Call this with the argument values of every call the proxy forwards. Short identifiers that cannot
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
