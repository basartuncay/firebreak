# Changelog

## Unreleased

- The dashboard is redesigned. The first waiting call opens with one question ("Approve `server/tool`?"),
  the finding in a sentence, every argument in full with the traced value marked, and the source excerpt
  with the same mark; the likely cut ends of an excerpt show as `[…?]`, apart from the quoted text. Deny and
  Approve once are told apart by fill, label and position, not by colour alone. Activity shows
  wall-clock times and the full event hash; Tools marks what changed in a quarantined definition. Light
  and dark follow the system setting, the layout works at 375 px, and nothing animates. No API, request
  or decision changed.
- The approval screen marks only what is really there. In an argument, only an exact occurrence of the
  traced value is marked; if there is none, a line says the argument carries it. In a source excerpt the
  mark can no longer shift (for example after an "İ"), land on an earlier twin in another case, or cover a
  single unrelated word; a mark on part of a value says "Partial match".
- Invisible and reordering characters (zero-width, bidirectional controls, control and tag characters,
  unpaired surrogates) are drawn as `⟨U+XXXX⟩` chips in every place the dashboard shows untrusted text,
  and a value holding them gets a warning line. An address, URL or host name that mixes scripts (a
  Cyrillic "а" in a Latin name) gets a "Lookalike letters" line.
- Approve and Deny ignore clicks and keys for 600 ms after a call opens, shown as dashed buttons, so a
  click meant for the previous call cannot approve the next one. When the open call disappears without
  your decision, a line says which call replaced it. A typed note stays with its call while you switch
  calls; focus moves to the heading after the last decision.
- `firebreak ui` sends a Content-Security-Policy, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY` on every response.
- The dashboard's fonts (DM Sans, Instrument Serif, JetBrains Mono) are bundled with their OFL licence
  texts, so it makes no requests outside `127.0.0.1`.
- Tests build `dist` once per run instead of once per test file, which removes a race between test files.
- README: real captures of the new dashboard in light and dark, a short recording of a denied call, and a
  diagram of how a call is decided.

## 0.1.1

First version on npm.

- The package ships without source maps, and `dist/cli.js` is executable in the tarball.
- The dashboard honours `prefers-reduced-motion`.

## 0.1.0 (2026-11-09)

First release, on GitHub only.

- `firebreak wrap`: protocol-version-agnostic stdio proxy for MCP servers.
- Provenance tracking by value matching across a session, including short identifiers in destination
  arguments.
- Deterministic policy engine with rules F1–F6 and a YAML policy.
- Approval queue with a local dashboard and CLI; unanswered approvals are denied.
- Hash-chained audit log with `firebreak audit verify`; secrets redacted.
- Tool pinning (rug-pull quarantine) and tool-poisoning detection.
- `firebreak test` attack suite (73 attacks, 10 benign tasks) and a GitHub Action.
- `firebreak install` / `uninstall` for Claude Desktop, Claude Code and Cursor.
- Hardening after an independent review: provenance shared between the servers of one client, destination
  detection by name parts and value, stricter allowlists, F2 on open-world reads, bounded extraction
  (ReDoS), header-only dashboard token with Host checks, fail-closed pin errors, audit of unanswered
  calls, and refusal of id-less or unparsable tool calls.
