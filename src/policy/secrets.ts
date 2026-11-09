const PATTERNS: [string, RegExp][] = [
  ["anthropic-key", /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ["openai-key", /\bsk-(?!ant-)[A-Za-z0-9_-]{32,}/g],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}/g],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
];

export function findSecrets(value: string): string[] {
  return PATTERNS.filter(([, re]) => value.match(re) !== null).map(([name]) => name);
}

export function redact(value: string): string {
  return PATTERNS.reduce((out, [name, re]) => out.replace(re, `<redacted:${name}>`), value);
}

/** Deep copy of a JSON value with every string redacted. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [redact(k), redactDeep(v)])) as T;
  }
  return value;
}
