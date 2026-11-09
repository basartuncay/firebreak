# Firebreak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Firebreak v0.1 — a provenance-aware MCP security gateway with approvals UI, hash-chained audit log, attack test suite + GitHub Action, and one-command install.

**Architecture:** A transparent newline-delimited JSON-RPC stdio relay intercepts `tools/list` and `tools/call`; a pure, deterministic policy engine decides using per-session taint memory built from tool results; all state (audit, approvals, pins) lives in one SQLite file shared by every proxy process and the local UI server.

**Tech Stack:** TypeScript 5, Node ≥ 20 (ESM), better-sqlite3, hono + @hono/node-server, yaml, zod; React 19 + Vite for the UI; vitest, Biome; dev-only @modelcontextprotocol/client + server v2 for the compatibility test.

**Spec:** `docs/design.md`

## Global Constraints

- Package name `mcp-firebreak`, binary `firebreak`, licence MIT, `"type": "module"`, `engines.node >= 20`.
- Runtime deps limited to: better-sqlite3, hono, @hono/node-server, yaml, zod.
- State dir: `process.env.FIREBREAK_HOME ?? ~/.firebreak`; DB file `firebreak.db` (WAL); policy `policy.yaml`.
- UI binds `127.0.0.1`, default port `4319`, token-protected.
- Decisions are `allow | confirm | deny`; strictest wins; rule ids exactly `F1`–`F6`.
- Blocked result shape: `{content:[{type:"text",text}], isError:true, resultType:"complete"}`; text starts with `Blocked by Firebreak (<rule ids>):`.
- Defaults: approval timeout 120 s, `maxWritesPerSession` 50, `maxWritesPerMinute` 10, taint cap 500 results / 4 MB per session, atom min length 24, substring-match min length 40, approval poll 250 ms.
- Default sink argument names: `to, cc, bcc, recipient, recipients, email, url, uri, endpoint, webhook, path, repo, owner, channel, attendee, attendees`.
- Never write to stdout except JSON-RPC frames inside `wrap` (logs go to stderr).

## Review Focus

1. A JSON-RPC frame split across stdout chunks, or several frames in one chunk → relayed intact, in order (Task 1 test `splits and joins frames across chunks`).
2. Upstream exits while a call is pending or awaiting approval → client gets a JSON-RPC error for that id, proxy exits with upstream code (Task 8 test `answers pending calls when upstream dies`).
3. Client sends `notifications/cancelled` for a call awaiting approval → approval marked `cancelled`, nothing forwarded (Task 8 test `cancels a pending approval`).
4. Tainted value nested inside arrays/objects of arguments (e.g. `recipients: [{email: …}]`) → found, path reported as `recipients[0].email` (Task 6 test `traces nested argument values`).
5. Store cannot be opened (read-only home, locked file) → proxy still relays; any call that is not `allow` is denied with a stderr explanation (Task 8 test `fails closed when the store is unavailable`).

---

### Task 1: Scaffold and JSON-RPC framing

**Files:** Create `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `.github/workflows/ci.yml`, `src/jsonrpc.ts`; Test `tests/jsonrpc.test.ts`

**Interfaces — Produces:**

- `class LineSplitter { push(chunk: Buffer | string): string[] }` — returns complete lines (without `\n`, `\r` stripped), keeps the remainder.
- `type JsonRpcMessage = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: any; result?: any; error?: any }`
- `parseFrame(line: string): JsonRpcMessage | JsonRpcMessage[] | null` (null on invalid JSON).
- `isRequest(m)`, `isNotification(m)`, `isResponse(m)` type guards.

- [ ] Step 1: tests `splits and joins frames across chunks`, `ignores blank lines`, `parseFrame returns null for garbage`, `classifies request/notification/response`.
- [ ] Step 2: run `npx vitest run tests/jsonrpc.test.ts` → FAIL.
- [ ] Step 3: implement; scripts `build` (tsc → `dist/`), `test`, `lint` (biome check), `typecheck`; CI runs lint, typecheck, test on Node 20 and 22.
- [ ] Step 4: run tests, lint, typecheck → PASS.
- [ ] Step 5: commit `chore: scaffold project and JSON-RPC framing`.

### Task 2: Policy schema and loading

**Files:** Create `src/policy/schema.ts`, `src/policy/defaults.ts`, `src/paths.ts`; Test `tests/policy-schema.test.ts`

**Interfaces — Produces:**

- `type Trust = "untrusted" | "private" | "trusted"`; `type ToolKind = "read" | "write" | "destructive"`; `type Decision = "allow" | "confirm" | "deny"`.
- `type Policy` (zod-inferred) with fields `version: 1, approval.timeoutSeconds, budgets.{maxWritesPerSession,maxWritesPerMinute}, servers: Record<string,{trust: Trust}>, tools: Record<"server/tool",{kind?,openWorld?,sinks?: string[]}>, rules: {F1,F2private,F3,F4,F6poisoning: Decision}, allow: {recipients: string[], hosts: string[], paths: string[]}`.
- `loadPolicy(file?: string): Policy` — missing file → defaults; invalid → throws `PolicyError` whose message lists `path: problem` per issue.
- `defaultPolicyYaml(): string` (commented template used by `firebreak init`).
- `firebreakHome(): string`, `dbPath(): string`, `policyPath(): string`.

- [ ] Steps: tests `returns defaults when file is missing`, `merges partial file over defaults`, `reports the path of an invalid field` (e.g. `rules.F3: Invalid enum value`), `default template parses to defaults` → fail → implement → pass → commit `feat: policy schema and loader`.

### Task 3: Atom extraction and taint memory

**Files:** Create `src/provenance/extract.ts`, `src/provenance/taint.ts`; Test `tests/taint.test.ts`

**Interfaces — Produces:**

- `extractAtoms(text: string): string[]` — emails, URLs, hostnames from URLs, absolute/`~` paths, phone numbers (≥ 9 digits), IBAN-like, tokens ≥ 24 chars; lower-cased, deduped.
- `resultText(result: unknown): string` — joins text content blocks and JSON of `structuredContent`.
- `type TaintSource = { server: string; tool: string; callId: string; label: "untrusted" | "private"; snippet: string }`
- `class TaintMemory { constructor(opts?: {maxResults?: number; maxBytes?: number}); record(src: Omit<TaintSource,"snippet">, result: unknown): void; trace(value: string): TaintSource[] }` — `trace` matches atoms equal to/contained in the value, and values ≥ 40 chars as substrings of recorded text; snippet = 80 chars around the match.

- [ ] Steps: tests `extracts emails urls and paths`, `traces an exact email`, `traces a long copied paragraph`, `does not trace short common words`, `is case and whitespace insensitive`, `evicts oldest results past the cap` → fail → implement → pass → commit `feat: provenance extraction and taint memory`.

### Task 4: Tool classification

**Files:** Create `src/classify.ts`; Test `tests/classify.test.ts`

**Interfaces — Consumes:** `Policy`. **Produces:**

- `type ToolDef = { name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean } }`
- `type ToolInfo = { server: string; name: string; kind: ToolKind; openWorld: boolean; sinks: string[] }`
- `classifyTool(server: string, def: ToolDef | undefined, policy: Policy): ToolInfo` — precedence policy → name heuristics → annotations (annotations may only make it stricter); unknown → write, openWorld true.

- [ ] Steps: tests `policy overrides heuristics`, `send_email is write`, `delete_event is destructive`, `readOnlyHint cannot downgrade send_email`, `unknown tool defaults to write`, `default sinks include to and url` → fail → implement → pass → commit `feat: tool classification`.

### Task 5: Secret and poisoning detectors

**Files:** Create `src/policy/secrets.ts`, `src/policy/poisoning.ts`; Test `tests/detectors.test.ts`

**Interfaces — Produces:**

- `findSecrets(value: string): string[]` — pattern names; patterns: anthropic `sk-ant-`, openai-style `sk-…32+`, GitHub `gh[pousr]_`/`github_pat_`, AWS `AKIA/ASIA`, Slack `xox`, Google `AIza`, private-key block, JWT.
- `redact(value: string): string` — replaces each secret with `<redacted:name>`.
- `scanDescription(text: string): string[]` — reasons: `instructs-model` (e.g. `ignore (all|previous)`, `do not (tell|inform) the user`, `<IMPORTANT>`, `before using this tool`), `hidden-unicode` (U+200B–200F, U+202A–202E, U+2060–2064, tag chars U+E0000–E007F), `credential-reference` (`~/.ssh`, `id_rsa`, `.env`, `api key`).

- [ ] Steps: tests build synthetic secrets at runtime (`"sk-ant-" + "a".repeat(30)`), `detects …` per pattern, `redacts`, `clean text has no findings`, `flags tool-poisoning examples` → fail → implement → pass → commit `feat: secret and tool-poisoning detectors`.

### Task 6: Policy engine

**Files:** Create `src/policy/engine.ts`, `src/policy/budget.ts`; Test `tests/engine.test.ts`

**Interfaces — Consumes:** Tasks 2–5. **Produces:**

- `type ArgProvenance = { path: string; value: string; sources: TaintSource[] }`
- `type Finding = { rule: "F1"|"F2"|"F3"|"F4"|"F5"|"F6"; decision: Decision; message: string; argPath?: string }`
- `type Evaluation = { decision: Decision; findings: Finding[]; provenance: ArgProvenance[] }`
- `class BudgetCounter { constructor(now?: () => number); recordWrite(): void; sessionCount(): number; lastMinuteCount(): number }`
- `evaluate(call: {server: string; tool: string; args: unknown}, ctx: {tool: ToolInfo; toolStatus: "ok"|"suspicious"|"quarantined"; taint: TaintMemory; policy: Policy; budget: BudgetCounter}): Evaluation` — walks every string leaf of `args` (path like `recipients[0].email`), applies F1–F6 per design table, strictest wins, `allow` when no finding. Reads never trigger F1/F2-private/F4/F5.

- [ ] Steps: tests one per rule (`F1 confirms tainted recipient`, `F1 allowlisted domain passes`, `F2 denies secret to openWorld`, `F2 confirms private data to openWorld`, `F3 confirms destructive`, `F4 confirms cross-server flow`, `F5 denies over minute budget`, `F6 denies quarantined tool`, `F6 confirms suspicious tool`, `traces nested argument values`, `read calls are allowed`, `strictest decision wins`) → fail → implement → pass → commit `feat: deterministic policy engine`.

### Task 7: Store — audit, approvals, pins

**Files:** Create `src/store/db.ts`, `src/store/audit.ts`, `src/store/approvals.ts`, `src/store/pins.ts`; Test `tests/store.test.ts`

**Interfaces — Produces:**

- `openStore(file?: string): Store` (creates dir, WAL, migrations table `meta(schema_version)`).
- `Store.audit.append(e: AuditInput): AuditEvent`; `Store.audit.list(q: {limit?; server?; tool?; decision?; search?; sinceId?}): AuditEvent[]`; `Store.audit.verify(): {ok: true; count: number} | {ok: false; brokenAt: number}`.
- `AuditInput = {sessionId, server, tool, args (already redacted), provenance, decision, findings, approval?: "approved"|"denied"|"expired"|"cancelled", latencyMs?, resultBytes?}`; `AuditEvent = AuditInput & {id, ts, prevHash, hash}`; hash = sha256(prevHash + canonical JSON with sorted keys).
- `Store.approvals.create(req: {sessionId, server, tool, args, provenance, findings}): Approval`; `.get(id)`; `.listPending()`; `.decide(id, decision: "approved"|"denied", by: "ui"|"cli", reason?)` (no-op if not pending); `.expire(id)`; `.cancel(id)`.
- `Store.pins.check(server, def: ToolDef): {status: "ok"|"new"|"changed"|"suspicious"|"quarantined"; reasons: string[]}` — first sight pins (suspicious if `scanDescription` finds anything); changed hash → `quarantined` with old/new description stored; `.approve(server, name)` re-pins current; `.list()`.

- [ ] Steps: tests `appends and verifies a chain`, `detects a tampered row`, `approval lifecycle`, `decide is ignored once decided`, `pins new tool`, `quarantines changed description`, `re-approve clears quarantine`, `two Store instances see each other's writes` → fail → implement → pass → commit `feat: sqlite store for audit approvals and pins`.

### Task 8: Proxy

**Files:** Create `src/proxy.ts`, `tests/fixtures/mock-server.mjs` (raw JSON-RPC stdio MCP server driven by a JSON fixture file path in argv: tools list + canned results + optional `changeDescriptionAfterList`); Test `tests/proxy.test.ts`

**Interfaces — Consumes:** Tasks 1–7. **Produces:**

- `runProxy(opts: {name: string; command: string; args: string[]; policy: Policy; store: Store | null; stdin: Readable; stdout: Writable; stderr: Writable; approvalPollMs?: number}): Promise<number>` (resolves with exit code).

Behaviour per design "Proxy" table; tool defs cached from the latest `tools/list` response; `ToolInfo` from `classifyTool`; writes `budget.recordWrite()` on forwarded write/destructive calls; on `confirm` creates approval and polls `store.approvals.get` until decided/timeout; pending map keyed by client request id.

- [ ] Steps: tests (spawn `node dist/cli.js wrap` or call `runProxy` with PassThrough streams against the mock server): `relays initialize and tools/list unchanged`, `blocks a tainted send with F1 after approval timeout`, `forwards after approval`, `denies a secret immediately`, `hides a quarantined tool after a description change`, `answers pending calls when upstream dies`, `cancels a pending approval`, `fails closed when the store is unavailable`, `writes a verified audit chain` → fail → implement → pass → commit `feat: provenance-aware stdio proxy`.

### Task 9: CLI

**Files:** Create `src/cli.ts`, `src/commands/*.ts`; Test `tests/cli.test.ts`

**Interfaces — Produces:** binary `firebreak` with `wrap`, `init`, `approvals`, `approve <id>`, `deny <id> [--reason]`, `audit tail [-n]`, `audit verify`, `tools`, `tools approve <server/tool>`, `ui`, `test`, `install`, `uninstall`, `--version`, `--help`. Arg parsing with `node:util` `parseArgs`. Errors → stderr, exit 2 for usage errors.

- [ ] Steps: tests run the built CLI with `FIREBREAK_HOME` in a temp dir: `init writes policy.yaml`, `approve decides a pending approval`, `audit verify reports ok`, `unknown command exits 2 with usage` → fail → implement → pass → commit `feat: command line interface`.

### Task 10: MCP SDK v2 compatibility test

**Files:** Create `tests/fixtures/sdk-server.mjs` (v2 `@modelcontextprotocol/server` stdio server with `read_inbox` and `send_email`); Test `tests/sdk-compat.test.ts`

- [ ] Steps: test `SDK client lists and calls tools through firebreak`: v2 client over stdio transport spawning `node dist/cli.js wrap --name mail -- node tests/fixtures/sdk-server.mjs`; call `read_inbox` (returns attacker email), then `send_email` to that address → result `isError` true and text starts with `Blocked by Firebreak (F1)` (policy with `approval.timeoutSeconds: 1`) → implement fixes if any → pass → commit `test: MCP SDK v2 compatibility`.

### Task 11: UI server

**Files:** Create `src/ui/server.ts`; Test `tests/ui-server.test.ts`

**Interfaces — Produces:** `createUiApp(store: Store, opts: {token: string; staticDir?: string}): Hono`; `startUi(opts: {port?: number}): Promise<{url: string; close(): void}>`.
API (all require cookie `fb_token` or `?token=`; first valid `?token=` sets HttpOnly SameSite=Strict cookie): `GET /api/approvals`, `POST /api/approvals/:id` `{decision, reason?}`, `GET /api/events?…`, `GET /api/tools`, `POST /api/tools/:server/:name/approve`, `GET /api/stats`, `GET /api/stream` (SSE: `approval`, `event` messages; polls store every 1 s by last seen ids). POST requires `Origin` absent or equal to the UI origin.

- [ ] Steps: tests with `app.request`: `rejects without token`, `sets cookie from query token`, `lists and decides approvals`, `rejects cross-origin POST`, `stats counts by decision` → fail → implement → pass → commit `feat: local UI server and API`.

### Task 12: Web UI

**Files:** Create `web/` (Vite React app: `index.html`, `src/main.tsx`, `src/App.tsx`, `src/views/{Approvals,Activity,Tools,Overview}.tsx`, `src/api.ts`, `src/styles.css`), build output `dist/web`.

- [ ] Steps: build views per design; approvals show each argument with provenance snippet and fired rules, approve/deny with optional reason; activity table with filters and search; tools with status and old/new description diff; overview counts. Verify in a browser against seeded data (`scripts/seed-demo.ts`), desktop and mobile widths, keyboard focus visible → commit `feat: web UI`.

### Task 13: Attack test suite and corpus

**Files:** Create `src/testsuite/{scenario.ts,run.ts,report.ts}`, `scenarios/**/*.yaml`, `scripts/import-cordon.py` (one-off converter, documented); Test `tests/testsuite.test.ts`

**Interfaces — Produces:** `loadScenarios(dir: string): Scenario[]`; `runScenario(s: Scenario, policy: Policy): {pass: boolean; decision: Decision; findings: Finding[]}`; `runSuite(dirs: string[], policy: Policy): SuiteResult`; `formatReport(r: SuiteResult, format: "text"|"json"|"markdown"): string`.

- [ ] Steps: tests `attack expecting blocked passes when confirmed`, `benign expecting allowed fails on false positive`, `markdown report lists misses`; convert Cordon attacks whose goal is a write (email sent/forwarded to domain or address, attendee added, event created/deleted) into scenarios; add ≥ 12 own scenarios (GitHub issue → push to other repo, web page → fetch to attacker URL, file read → secret sent, rug pull, ≥ 8 benign) → implement → `firebreak test` on built-in corpus records the real numbers in `docs/results.md` → commit `feat: attack test suite and corpus`.

### Task 14: GitHub Action

**Files:** Create `action.yml`; Modify `.github/workflows/ci.yml`

- [ ] Steps: composite action (inputs `policy`, `scenarios`, `fail-on-miss`) running the CLI from `github.action_path` and appending the markdown report to `$GITHUB_STEP_SUMMARY`; CI dogfoods `uses: ./` → commit `feat: GitHub Action for the attack suite`.

### Task 15: Install and uninstall

**Files:** Create `src/install.ts`; Test `tests/install.test.ts`

**Interfaces — Produces:** `planInstall(config: object, opts?: {npxPackage?: string}): {config: object; wrapped: string[]; skipped: string[]}`; `planUninstall(config): {config; restored: string[]}`; `clientConfigPaths(client, platform, cwd): string[]`.

- [ ] Steps: tests `wraps stdio entries`, `skips url entries and already wrapped`, `uninstall restores original exactly`, `writes a backup before changing the file` → fail → implement → pass → commit `feat: install into Claude Desktop, Claude Code and Cursor`.

### Task 16: Documentation, Docker, release

**Files:** Create `README.md`, `docs/threat-model.md`, `docs/results.md` (from Task 13), `Dockerfile`, `CHANGELOG.md`, `SECURITY.md`.

- [ ] Steps: README with problem, 60-second quick start (`npx mcp-firebreak install`), demo GIF/screenshot of the approval UI, how provenance works, rules table, honest limits, comparison with existing gateways, CLI reference; Dockerfile for `firebreak ui`; final full check (lint, typecheck, test, suite) → commit `docs: README, threat model and release prep`; push repo, open PR-free initial release after user review.
