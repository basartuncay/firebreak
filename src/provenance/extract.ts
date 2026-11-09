/** Values that identify a destination or carry data: what an injected instruction tends to smuggle in. */
const PATTERNS: RegExp[] = [
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, // email
  /\b(?:https?|ftp|wss?):\/\/[^\s"'<>)\]]+/gi, // URL
  /(?:^|[\s"'(=])((?:~|\/)[\w.-]*(?:\/[\w.-]+)+)/g, // absolute or home path (captured)
  /\+?\d[\d\s().-]{7,}\d/g, // phone-like
  /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, // IBAN-like
  /\b[A-Za-z0-9_\-+/=.]{24,}\b/g, // long opaque token (keys, ids, hashes)
];

export const ATOM_MIN_LENGTH = 24;

export function extractAtoms(text: string): string[] {
  const atoms = new Set<string>();
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = (match[1] ?? match[0]).trim().replace(/[.,;:!?]+$/, "");
      if (value.length < 6) continue;
      if (/^\d[\d\s().-]*$/.test(value) && value.replace(/\D/g, "").length < 9) continue;
      atoms.add(value.toLowerCase());
      if (/^[a-z]+:\/\//i.test(value)) {
        try {
          atoms.add(new URL(value).hostname.toLowerCase());
        } catch {
          // not a parseable URL; the raw value is still kept
        }
      }
    }
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
