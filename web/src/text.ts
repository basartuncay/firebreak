// Pure text helpers behind the dashboard's evidence marks; kept free of React so tests can import them.

export type Range = { at: number; len: number };

// Bounds the work on attacker-sized input: occurrences checked per search.
const MAX_TRIES = 1000;
// The gateway's excerpts are a short window around the match; a partial match is only looked for in those.
const MAX_PARTIAL_BODY = 4096;
// A partial match shorter than this at a cut edge is too likely to be a coincidence to mark.
const MIN_PARTIAL = 12;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** True when [at, at + len) starts and ends on grapheme boundaries (no split pair, mark or ZWJ sequence). */
function aligned(text: string, at: number, len: number): boolean {
  if (len === 0) return false;
  const segs = graphemes.segment(text);
  const end = at + len;
  return (
    (at === 0 || segs.containing(at)?.index === at) &&
    (end === text.length || segs.containing(end)?.index === end)
  );
}

/**
 * Every exact, case-sensitive occurrence of the value in the argument text, as the user approves it.
 * No case folding, no whitespace changes: if it is not there verbatim, nothing is marked.
 */
export function markInValue(text: string, value: string): Range[] {
  if (!value.trim() || value.length > text.length) return [];
  if (text === value) return [{ at: 0, len: text.length }];
  const out: Range[] = [];
  let tries = 0;
  for (let at = text.indexOf(value); at >= 0 && tries < MAX_TRIES; tries++) {
    if (aligned(text, at, value.length)) {
      out.push({ at, len: value.length });
      at = text.indexOf(value, at + value.length);
    } else {
      at = text.indexOf(value, at + 1);
    }
  }
  return out;
}

const SPACE = /\s/;

/** Whitespace runs become one space and, if asked, case is folded per code unit, so length never changes. */
function normalise(s: string, fold: boolean): { text: string; map: Int32Array } {
  const low = fold ? s.toLowerCase() : s;
  const sameLength = low.length === s.length; // else fold unit by unit ("İ" lower-cases to two units)
  const map = new Int32Array(s.length);
  let out = "";
  let n = 0;
  let space = false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 32 || (code >= 9 && code <= 13) || (code > 127 && SPACE.test(s[i]!))) {
      if (!space) {
        out += " ";
        map[n++] = i;
      }
      space = true;
      continue;
    }
    space = false;
    let c = sameLength ? low[i]! : s[i]!;
    if (fold && !sameLength) {
      const l = c.toLowerCase();
      if (l.length === 1) c = l;
    }
    out += c;
    map[n++] = i;
  }
  return { text: out, map };
}

/** Length of the longest prefix of `p` that is a suffix of `t` (Knuth-Morris-Pratt, linear). */
function overlap(t: string, p: string): number {
  if (!p) return 0;
  const fail = new Int32Array(p.length);
  for (let i = 1, k = 0; i < p.length; i++) {
    while (k > 0 && p[i] !== p[k]) k = fail[k - 1]!;
    if (p[i] === p[k]) k++;
    fail[i] = k;
  }
  let k = 0;
  for (let i = 0; i < t.length; i++) {
    while (k > 0 && t[i] !== p[k]) k = fail[k - 1]!;
    if (t[i] === p[k]) k++;
    if (k === p.length) k = fail[k - 1]!; // a whole match was already looked for
  }
  return k;
}

const reverse = (s: string) => s.split("").reverse().join("");

/**
 * Where to mark the traced value inside a stored source excerpt (the gateway collapses its whitespace and
 * cuts it). Positions are always positions in `body`. Exact match first, then whitespace-flexible, then
 * case-insensitive; a part of the value is marked only as its start at a cut end or its end at a cut start,
 * and is returned with `partial: true` so the page can say so.
 */
export function markInExcerpt(
  body: string,
  value: string,
  cut: { before: boolean; after: boolean } = { before: false, after: false },
): (Range & { partial: boolean }) | null {
  if (!value.trim() || !body) return null;
  for (const at of indexes(body, value)) {
    if (aligned(body, at, value.length)) return { at, len: value.length, partial: false };
  }
  const folded = { body: normalise(body, true), value: normalise(value, true).text.trim() };
  if (!folded.value) return null;
  // Folding keeps the length, so a value longer than the excerpt cannot be in it whole.
  for (const fold of folded.value.length > folded.body.text.length ? [] : [false, true]) {
    const b = fold ? folded.body : normalise(body, false);
    const v = fold ? folded.value : normalise(value, false).text.trim();
    for (const at of indexes(b.text, v)) {
      const from = b.map[at]!;
      const to = b.map[at + v.length - 1]! + 1;
      if (aligned(body, from, to - from)) return { at: from, len: to - from, partial: false };
    }
  }
  const { body: b, value: v } = folded;
  if (b.text.length > MAX_PARTIAL_BODY) return null;
  const t = b.text.trimEnd();
  const lead = b.text.length - b.text.trimStart().length;
  const candidates: Range[] = [];
  if (cut.after) {
    // The excerpt ends inside the value: its last characters are the start of the value.
    const n = overlap(t, v);
    if (n >= MIN_PARTIAL) candidates.push({ at: b.map[t.length - n]!, len: 0 });
    const last = candidates[0];
    if (last) last.len = b.map[t.length - 1]! + 1 - last.at;
  }
  if (cut.before) {
    // The excerpt starts inside the value: its first characters are the end of the value.
    const n = overlap(reverse(b.text.slice(lead)), reverse(v));
    if (n >= MIN_PARTIAL) candidates.push({ at: b.map[lead]!, len: b.map[lead + n - 1]! + 1 - b.map[lead]! });
  }
  candidates.sort((x, y) => y.len - x.len);
  for (const r of candidates) if (aligned(body, r.at, r.len)) return { ...r, partial: true };
  return null;
}

function* indexes(text: string, needle: string): Generator<number> {
  let tries = 0;
  for (
    let at = text.indexOf(needle);
    at >= 0 && tries < MAX_TRIES;
    at = text.indexOf(needle, at + 1), tries++
  )
    yield at;
}

/** Splits two versions into [common start, changed middle, common end], word by word. */
export function splitChange(before: string, after: string): { before: string[]; after: string[] } {
  // shortcut: one changed span per side (common prefix/suffix by word); a real word diff if edits get scattered.
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end])
    end++;
  const part = (w: string[]) => [
    w.slice(0, start).join(""),
    w.slice(start, w.length - end).join(""),
    w.slice(w.length - end).join(""),
  ];
  return { before: part(a), after: part(b) };
}

/** A character that would be invisible or reorder text, shown as its code point instead. */
export type Hidden = { code: string; name: string };
export type Part = string | Hidden;

const NAMES: Record<number, string> = {
  173: "soft hyphen",
  1564: "Arabic letter mark",
  6158: "Mongolian vowel separator",
  8203: "zero-width space",
  8204: "zero-width non-joiner",
  8205: "zero-width joiner",
  8206: "left-to-right mark",
  8207: "right-to-left mark",
  8232: "line separator",
  8233: "paragraph separator",
  8234: "left-to-right embedding",
  8235: "right-to-left embedding",
  8236: "pop directional formatting",
  8237: "left-to-right override",
  8238: "right-to-left override",
  8288: "word joiner",
  8294: "left-to-right isolate",
  8295: "right-to-left isolate",
  8296: "first strong isolate",
  8297: "pop directional isolate",
  65279: "zero-width no-break space",
};

// Control characters, zero-width and bidirectional formatting characters, tag characters (U+E0000-E007F,
// used to smuggle invisible ASCII) and unpaired surrogates. Newline, tab and CR are decided in the callback.
const HIDDEN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|\uDB40[\uDC00-\uDC7F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/**
 * Splits text into plain runs and hidden characters. With `pre` (text shown in a pre-wrap block), newline,
 * tab and CR before a newline stay as they are; elsewhere they are shown too, so nothing vanishes silently.
 */
export function visibleParts(s: string, pre = false): Part[] {
  const out: Part[] = [];
  let pos = 0;
  for (const m of s.matchAll(HIDDEN)) {
    const c = m[0];
    const at = m.index;
    if (pre && (c === "\n" || c === "\t" || (c === "\r" && s[at + 1] === "\n"))) continue;
    if (at > pos) out.push(s.slice(pos, at));
    const cp = c.length === 2 ? c.codePointAt(0)! : c.charCodeAt(0);
    const name =
      NAMES[cp] ??
      (cp >= 0xe0000
        ? "tag character"
        : cp >= 0xd800 && cp <= 0xdfff
          ? "unpaired surrogate"
          : "control character");
    out.push({ code: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`, name });
    pos = at + c.length;
  }
  if (pos < s.length) out.push(s.slice(pos));
  return out;
}

/** The text as the page shows it, hidden characters written as ⟨U+XXXX⟩. */
export const visibleText = (s: string, pre = false): string =>
  visibleParts(s, pre)
    .map((p) => (typeof p === "string" ? p : `⟨${p.code}⟩`))
    .join("");

/** How many hidden characters a value shown in a pre-wrap block holds. */
export const hiddenCount = (s: string): number =>
  visibleParts(s, true).filter((p) => typeof p !== "string").length;

const SCRIPTS = ["Latin", "Cyrillic", "Greek", "Armenian", "Georgian", "Cherokee", "Hebrew", "Arabic"].map(
  (name) => [name, new RegExp(`\\p{Script=${name}}`, "u")] as const,
);
const ADDRESS = /@|:\/\/|^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+\.?$/u;

/**
 * Words that look like an email address, a URL or a host name and mix letters of several scripts
 * (Latin "a" next to Cyrillic "а"), with the scripts in order of first use.
 */
export function lookalikes(s: string): { token: string; scripts: string[] }[] {
  const out: { token: string; scripts: string[] }[] = [];
  const seen = new Set<string>();
  for (const token of s.split(/[\s"'<>()[\]{},;]+/u)) {
    if (!token || seen.has(token) || !ADDRESS.test(token)) continue;
    seen.add(token);
    const scripts: string[] = [];
    for (const letter of token.match(/\p{L}/gu) ?? []) {
      const script = SCRIPTS.find(([, re]) => re.test(letter))?.[0];
      if (script && !scripts.includes(script)) scripts.push(script);
    }
    if (scripts.length > 1) out.push({ token, scripts });
  }
  return out;
}
