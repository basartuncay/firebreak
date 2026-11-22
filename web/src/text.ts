// Pure text helpers behind the dashboard's evidence marks; kept free of React so tests can import them.

/** Where to mark the matched value inside a stored source excerpt, or null if it cannot be found. */
export function markRange(snippet: string, value: string): { at: number; len: number } | null {
  const lower = snippet.toLowerCase();
  const needle = value.toLowerCase().replace(/\s+/g, " ").trim();
  let at = lower.indexOf(needle);
  let len = needle.length;
  if (at < 0) {
    // The stored excerpt can end inside the value: mark the longest start or end of the value it holds.
    for (let n = needle.length - 1; n >= 12 && at < 0; n--) {
      const head = lower.indexOf(needle.slice(0, n));
      const tail = lower.indexOf(needle.slice(-n));
      if (head >= 0 || tail >= 0) {
        at = head >= 0 ? head : tail;
        len = n;
      }
    }
  }
  if (at < 0) {
    // The value contained an atom (an address, a URL): mark the longest token of the value found.
    const token = needle
      .split(/[\s,;]+/)
      .filter((t) => t.length >= 6)
      .sort((a, b) => b.length - a.length)
      .find((t) => lower.includes(t));
    if (token) {
      at = lower.indexOf(token);
      len = token.length;
    }
  }
  return at < 0 ? null : { at, len };
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
