# Changelog

## 0.1.0 (unreleased)

First release.

- `firebreak wrap`: protocol-version-agnostic stdio proxy for MCP servers.
- Provenance tracking by value matching across a session, including short identifiers in destination
  arguments.
- Deterministic policy engine with rules F1–F6 and a YAML policy.
- Approval queue with a local dashboard and CLI; unanswered approvals are denied.
- Hash-chained audit log with `firebreak audit verify`; secrets redacted.
- Tool pinning (rug-pull quarantine) and tool-poisoning detection.
- `firebreak test` attack suite (73 attacks, 10 benign tasks) and a GitHub Action.
- `firebreak install` / `uninstall` for Claude Desktop, Claude Code and Cursor.
