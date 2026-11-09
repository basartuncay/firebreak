export type Trust = "untrusted" | "private" | "trusted";
export type ToolKind = "read" | "write" | "destructive";
export type Decision = "allow" | "confirm" | "deny";

export interface ToolOverride {
  kind?: ToolKind;
  openWorld?: boolean;
  sinks?: string[];
}

export interface Policy {
  version: 1;
  approval: { timeoutSeconds: number };
  budgets: { maxWritesPerSession: number; maxWritesPerMinute: number };
  servers: Record<string, { trust: Trust }>;
  /** Keyed by "server/tool". */
  tools: Record<string, ToolOverride>;
  rules: { F1: Decision; F2private: Decision; F3: Decision; F4: Decision; F6poisoning: Decision };
  allow: { recipients: string[]; hosts: string[]; paths: string[] };
}

export const DEFAULT_SINKS = [
  "to",
  "cc",
  "bcc",
  "recipient",
  "recipients",
  "email",
  "url",
  "uri",
  "endpoint",
  "webhook",
  "path",
  "repo",
  "owner",
  "channel",
  "attendee",
  "attendees",
  "address",
  "chat",
  "room",
  "conversation",
  "phone",
  "host",
  "destination",
];

export const DEFAULT_POLICY: Policy = {
  version: 1,
  approval: { timeoutSeconds: 120 },
  budgets: { maxWritesPerSession: 50, maxWritesPerMinute: 10 },
  servers: {},
  tools: {},
  rules: { F1: "confirm", F2private: "confirm", F3: "confirm", F4: "confirm", F6poisoning: "confirm" },
  allow: { recipients: [], hosts: [], paths: [] },
};
