/**
 * Values that identify a destination or carry data: what an injected instruction tends to smuggle in.
 * Every quantifier is bounded: this runs on attacker-controlled text, so no pattern may backtrack
 * quadratically on a long run of similar characters.
 */
const PATTERNS: RegExp[] = [
  /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,8}/gi, // email
  /\b(?:https?|ftp|wss?):\/\/[^\s"'<>)\]]{1,2048}/gi, // URL
  /(?:^|[\s"'(=])((?:~|\/)[\w.-]{0,255}(?:\/[\w.-]{1,255}){1,32})/g, // absolute or home path (captured)
  /\+?\d[\d\s().-]{7,40}\d/g, // phone-like
  /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, // IBAN-like
];

const TOKEN_SPLIT = /[^A-Za-z0-9_\-+/=.]+/;

export const ATOM_MIN_LENGTH = 24;
const ATOM_MAX_LENGTH = 512;

function add(atoms: Set<string>, raw: string): void {
  const value = raw.trim().replace(/[.,;:!?]+$/, "");
  if (value.length < 6) return;
  if (/^\d[\d\s().-]*$/.test(value) && value.replace(/\D/g, "").length < 9) return;
  atoms.add(value.toLowerCase());
  if (/^[a-z]+:\/\//i.test(value)) {
    try {
      atoms.add(new URL(value).hostname.toLowerCase());
    } catch {
      // not a parseable URL; the raw value is still kept
    }
  }
}

export function extractAtoms(text: string): string[] {
  const atoms = new Set<string>();
  for (const pattern of PATTERNS) {
    if (pattern.source.includes("@") && !text.includes("@")) continue;
    for (const match of text.matchAll(pattern)) add(atoms, match[1] ?? match[0]);
  }
  // Long opaque tokens (keys, ids, hashes): a linear split instead of a regex scan.
  for (const piece of text.split(TOKEN_SPLIT)) {
    if (piece.length >= ATOM_MIN_LENGTH && piece.length <= ATOM_MAX_LENGTH) add(atoms, piece);
  }
  return [...atoms];
}

/** Text the model saw from a tool result: text blocks, embedded resource text, structured content. */
export function resultText(result: unknown): string {
  if (result == null || typeof result !== "object") return "";
  const r = result as { content?: unknown; structuredContent?: unknown };
  const parts: string[] = [];
  if (Array.isArray(r.content)) {
    for (const block of r.content as any[]) {
      if (typeof block?.text === "string") parts.push(block.text);
      if (typeof block?.resource?.text === "string") parts.push(block.resource.text);
    }
  }
  if (r.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  return parts.join("\n");
}

export const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
