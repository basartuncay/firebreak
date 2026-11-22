# Changelog

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
