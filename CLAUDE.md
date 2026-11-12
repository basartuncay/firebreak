# Firebreak — instructions for Claude

Security gateway between MCP clients and MCP servers. It tracks where each tool-call argument came from (provenance) and holds risky calls for human approval. See `docs/design.md` and `docs/threat-model.md`.

## Layout
- `src/proxy.ts`, `src/jsonrpc.ts` — MCP proxying.
- `src/provenance/` — remembers tool results, matches them when they return as arguments.
- `src/policy/`, `src/classify.ts` — decides allow / hold / block.
- `src/store/`, `src/ui/`, `web/` — approval queue and local dashboard.
- `src/testsuite/`, `scenarios/` — the attack suite (`scenarios/cordon` is imported via `scripts/import-cordon.py`).
- `tests/` — vitest, with snapshots in `tests/__snapshots__`.

## Commands (same as CI, Node >= 20)
- `npm ci`
- `npm run lint` (biome) · `npm run format` to fix
- `npm run typecheck`
- `npm run build`
- `npm test`

## Rules
- This is a security tool: a change that lets a previously held scenario through is a regression, even if tests are updated to match. Say so explicitly.
- Do not update snapshots blindly; explain each snapshot diff.
- Fail closed: on errors or unknown input, hold the call rather than allow it.
- Update `CHANGELOG.md` for user-visible changes.
