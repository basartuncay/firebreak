/**
 * Tool descriptions are read by the model as instructions. These patterns catch the published
 * tool-poisoning shapes: text addressed to the model, hidden characters, pointers to credentials.
 */
const INSTRUCTS_MODEL = [
  /<\s*important\s*>/i,
  /\bignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\b/i,
  /\bdo\s+not\s+(tell|inform|mention|notify|alert)\s+(the\s+)?user\b/i,
  /\bwithout\s+(telling|informing|notifying)\s+(the\s+)?user\b/i,
  /\bbefore\s+(using|calling)\s+this\s+tool\b/i,
  /\b(you|the\s+assistant|the\s+model)\s+must\s+(always\s+)?(first\s+)?(call|read|send|include|pass)\b/i,
  /\bsystem\s+prompt\b/i,
];

const CREDENTIALS = [
  /~\/\.ssh|\bid_(rsa|ed25519|ecdsa)\b/i,
  /(^|[\s/'"`])\.env\b/i,
  /\b(api[\s_-]?key|access[\s_-]?token|private[\s_-]?key|password|credentials?)\b.*\b(pass|send|include|read|attach)\b/i,
  /\.aws\/credentials|\bmcp\.json\b|claude_desktop_config/i,
];

// Zero-width, bidi controls, invisible operators, Unicode tag characters.
const HIDDEN = /[​-‏‪-‮⁠-⁤﻿]|[\u{E0000}-\u{E007F}]/u;

export function scanDescription(text: string): string[] {
  const reasons: string[] = [];
  if (INSTRUCTS_MODEL.some((re) => re.test(text))) reasons.push("instructs-model");
  if (HIDDEN.test(text)) reasons.push("hidden-unicode");
  if (CREDENTIALS.some((re) => re.test(text))) reasons.push("credential-reference");
  return reasons;
}
