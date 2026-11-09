import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Readable, Writable } from "node:stream";
import { classifyTool, type ToolDef } from "./classify.js";
import {
  isNotification,
  isRequest,
  isResponse,
  type JsonRpcMessage,
  LineSplitter,
  parseFrame,
} from "./jsonrpc.js";
import { BudgetCounter } from "./policy/budget.js";
import type { Policy } from "./policy/defaults.js";
import { type Evaluation, evaluate, stringLeaves, type ToolStatus } from "./policy/engine.js";
import { redactDeep } from "./policy/secrets.js";
import { resultText } from "./provenance/extract.js";
import { MAX_RESULT_CHARS, TaintMemory } from "./provenance/taint.js";
import type { ApprovalOutcome } from "./store/audit.js";
import type { Store } from "./store/db.js";

export interface ProxyOptions {
  name: string;
  command: string;
  args: string[];
  policy: Policy;
  /** null when the store could not be opened: the proxy then fails closed for anything not allowed. */
  store: Store | null;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  approvalPollMs?: number;
  /**
   * Proxies with the same group share provenance through the store. Default: every server one client
   * process started (same parent process on this host), overridable with FIREBREAK_GROUP.
   */
  group?: string;
  /** Stop the upstream cleanly on SIGINT/SIGTERM (the CLI sets this; tests do not). */
  handleSignals?: boolean;
}

/** Shared tool output is kept this long; it contains copies of emails, issues and pages. */
export const SHARED_TAINT_TTL_MS = 12 * 3600 * 1000;

interface InFlight {
  tool: string;
  args: unknown;
  evaluation: Evaluation;
  approval?: ApprovalOutcome;
  started: number;
}

const key = (id: unknown): string => JSON.stringify(id);

export function blockedResult(evaluation: Evaluation, note?: string) {
  const rules = [...new Set(evaluation.findings.map((f) => f.rule))].join(", ");
  const reasons = evaluation.findings.map((f) => f.message).join("; ");
  const text = `Blocked by Firebreak (${rules}): ${reasons}.${note ? ` ${note}` : ""} Tell the user what you tried to do and why it was blocked.`;
  return { content: [{ type: "text", text }], isError: true, resultType: "complete" };
}

/**
 * Relays newline-delimited JSON-RPC between the MCP client (stdin/stdout) and one upstream stdio
 * server. Inspects tools/list and tools/call; everything else passes through unchanged, so the
 * proxy does not depend on the MCP protocol version.
 */
export function runProxy(opts: ProxyOptions): Promise<number> {
  const { name: server, policy, store } = opts;
  const pollMs = opts.approvalPollMs ?? 250;
  const sessionId = randomUUID();
  const taint = new TaintMemory();
  const budget = new BudgetCounter();
  const tools = new Map<string, ToolDef>();
  const status = new Map<string, ToolStatus>();
  const inFlight = new Map<string, InFlight>();
  const listRequests = new Set<string>();
  const awaiting = new Map<string, { approvalId: number; cancel: () => void }>();
  const log = (msg: string) => opts.stderr.write(`[firebreak:${server}] ${msg}\n`);
  if (!store) log("store unavailable: every call that is not plainly allowed will be denied");
  const trust = policy.servers[server]?.trust ?? "untrusted";
  const group = opts.group ?? process.env.FIREBREAK_GROUP ?? `${hostname()}:${process.ppid}`;
  let synced = 0;
  let syncWarned = false;
  try {
    store?.taint.prune(SHARED_TAINT_TTL_MS);
  } catch (error) {
    log(`could not prune shared provenance: ${(error as Error).message}`);
  }

  /** Pulls what sibling proxies (other servers of the same client) have read since the last call. */
  const syncSharedTaint = () => {
    if (!store) return;
    try {
      for (const row of store.taint.since(group, sessionId, synced)) {
        taint.recordText(row.origin, row.text);
        synced = row.id;
      }
    } catch (error) {
      if (!syncWarned)
        log(`shared provenance unavailable, using this server only: ${(error as Error).message}`);
      syncWarned = true;
    }
  };

  const child = spawn(opts.command, opts.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
    shell: process.platform === "win32",
  });
  let upstreamAlive = true;
  child.stderr.on("data", (d) => opts.stderr.write(d));

  const toClient = (msg: JsonRpcMessage | string) =>
    opts.stdout.write(`${typeof msg === "string" ? msg : JSON.stringify(msg)}\n`);
  const toUpstream = (msg: JsonRpcMessage | string) => {
    if (upstreamAlive) child.stdin.write(`${typeof msg === "string" ? msg : JSON.stringify(msg)}\n`);
  };

  const audit = (
    call: InFlight,
    extra: { latencyMs?: number; resultBytes?: number; approval?: ApprovalOutcome },
  ) => {
    if (!store) return;
    try {
      store.audit.append({
        sessionId,
        server,
        tool: call.tool,
        args: redactDeep(call.args),
        provenance: call.evaluation.provenance.map((p) => ({ ...p, value: redactDeep(p.value) })),
        decision: call.evaluation.decision,
        findings: call.evaluation.findings,
        ...((extra.approval ?? call.approval) ? { approval: extra.approval ?? call.approval } : {}),
        ...extra,
      });
    } catch (error) {
      log(`audit write failed: ${(error as Error).message}`);
    }
  };

  const forwardCall = (msg: JsonRpcMessage, call: InFlight) => {
    inFlight.set(key(msg.id), call);
    const kind = classifyTool(server, tools.get(call.tool), policy).kind;
    if (kind !== "read") budget.recordWrite();
    toUpstream(msg);
  };

  const block = (msg: JsonRpcMessage, call: InFlight, note?: string) => {
    audit(call, { latencyMs: Date.now() - call.started });
    toClient({ jsonrpc: "2.0", id: msg.id ?? null, result: blockedResult(call.evaluation, note) });
  };

  async function handleToolCall(msg: JsonRpcMessage) {
    syncSharedTaint();
    const tool = String(msg.params?.name ?? "");
    const args = msg.params?.arguments ?? {};
    const def = tools.get(tool);
    let evaluation = evaluate(
      { server, tool, args },
      {
        tool: classifyTool(server, def ?? { name: tool }, policy),
        toolStatus: status.get(tool) ?? "ok",
        taint,
        policy,
        budget,
      },
    );
    if (!store && evaluation.decision === "confirm") {
      evaluation = { ...evaluation, decision: "deny" };
    }
    taint.noteArgs(stringLeaves(args).map((l) => l.value));
    const call: InFlight = { tool, args, evaluation, started: Date.now() };

    if (evaluation.decision === "allow") return forwardCall(msg, call);
    if (evaluation.decision === "deny" || !store) return block(msg, call);

    const approval = store.approvals.create({
      sessionId,
      server,
      tool,
      args: redactDeep(args),
      provenance: evaluation.provenance.map((p) => ({ ...p, value: redactDeep(p.value) })),
      findings: evaluation.findings,
    });
    log(
      `call to ${tool} needs approval #${approval.id}: run "firebreak approve ${approval.id}" or open the dashboard`,
    );
    const outcome = await waitForApproval(msg, approval.id);
    call.approval = outcome.status;
    if (outcome.status === "approved") return forwardCall(msg, call);
    if (outcome.status === "cancelled") return audit(call, {});
    const note =
      outcome.status === "expired"
        ? `Approval #${approval.id} timed out after ${policy.approval.timeoutSeconds}s.`
        : `The user denied approval #${approval.id}${outcome.reason ? `: ${outcome.reason}` : ""}.`;
    block(msg, call, note);
  }

  function waitForApproval(msg: JsonRpcMessage, approvalId: number) {
    return new Promise<{ status: ApprovalOutcome; reason?: string }>((resolve) => {
      const deadline = Date.now() + policy.approval.timeoutSeconds * 1000;
      const done = (result: { status: ApprovalOutcome; reason?: string }) => {
        clearInterval(timer);
        awaiting.delete(key(msg.id));
        resolve(result);
      };
      const timer = setInterval(() => {
        try {
          const current = store!.approvals.get(approvalId);
          if (current && current.status !== "pending") {
            return done({
              status: current.status as ApprovalOutcome,
              ...(current.reason ? { reason: current.reason } : {}),
            });
          }
          if (Date.now() >= deadline) {
            // Someone may have decided in the same instant: record whatever the store ended up with.
            if (store!.approvals.expire(approvalId)) return done({ status: "expired" });
            const final = store!.approvals.get(approvalId);
            done({ status: (final?.status ?? "expired") as ApprovalOutcome });
          }
        } catch (error) {
          log(`approval check failed: ${(error as Error).message}`);
          done({ status: "denied", reason: "Firebreak could not read the approval store" });
        }
      }, pollMs);
      awaiting.set(key(msg.id), {
        approvalId,
        cancel: () => {
          if (store!.approvals.cancel(approvalId)) return done({ status: "cancelled" });
          // Already decided: an approval that just landed is still not executed, the client gave up.
          done({ status: "cancelled" });
        },
      });
    });
  }

  function handleClientMessage(msg: JsonRpcMessage) {
    if (msg.method === "tools/call" && !isRequest(msg)) {
      // A call without a usable id cannot get a reply, so it can only be refused: never forward it.
      log(`refused a tools/call without a request id (${JSON.stringify(msg.params?.name ?? "")})`);
      return;
    }
    if (isRequest(msg) && msg.method === "tools/call") {
      void handleToolCall(msg).catch((error) => {
        log(`policy evaluation failed, denying: ${(error as Error).message}`);
        toClient({
          jsonrpc: "2.0",
          id: msg.id ?? null,
          error: { code: -32603, message: "Firebreak failed to evaluate this call" },
        });
      });
      return;
    }
    if (isRequest(msg) && msg.method === "tools/list") listRequests.add(key(msg.id));
    if (isNotification(msg) && msg.method === "notifications/cancelled") {
      const pending = awaiting.get(key(msg.params?.requestId));
      if (pending) return pending.cancel(); // never reached upstream, so nothing to forward
    }
    toUpstream(msg);
  }

  function handleUpstreamMessage(msg: JsonRpcMessage) {
    if (isResponse(msg)) {
      const k = key(msg.id);
      const call = inFlight.get(k);
      if (call) {
        inFlight.delete(k);
        if (trust !== "trusted") {
          // Error messages are tool output too: a server can echo attacker text in them.
          const errorText = typeof msg.error?.message === "string" ? msg.error.message : "";
          const text = [resultText(msg.result), errorText]
            .filter(Boolean)
            .join("\n")
            .slice(0, MAX_RESULT_CHARS);
          const origin = { server, tool: call.tool, callId: k, label: trust };
          taint.recordText(origin, text);
          if (store && text) {
            try {
              store.taint.add(group, sessionId, origin, text);
            } catch (error) {
              log(`could not share provenance: ${(error as Error).message}`);
            }
          }
        }
        audit(call, {
          latencyMs: Date.now() - call.started,
          resultBytes: JSON.stringify(msg.result ?? msg.error ?? null).length,
        });
      }
      if (awaiting.has(k)) {
        // The upstream answered a call it was never sent (it is still waiting for approval).
        log(`dropped an upstream response to request ${k}, which was not forwarded`);
        return;
      }
      if (listRequests.delete(k) && Array.isArray(msg.result?.tools)) {
        msg = { ...msg, result: { ...msg.result, tools: inspectTools(msg.result.tools) } };
      }
    }
    toClient(msg);
  }

  function inspectTools(defs: ToolDef[]): ToolDef[] {
    const visible: ToolDef[] = [];
    for (const def of defs) {
      if (!def || typeof def.name !== "string") continue;
      tools.set(def.name, def);
      let s: ToolStatus = "ok";
      if (store) {
        try {
          const check = store.pins.check(server, def);
          s =
            check.status === "quarantined"
              ? "quarantined"
              : check.status === "suspicious"
                ? "suspicious"
                : "ok";
          if (check.status === "quarantined")
            log(
              `tool ${def.name} changed since it was approved; hidden until "firebreak tools approve ${server}/${def.name}"`,
            );
          if (check.status === "suspicious")
            log(`tool ${def.name} description looks like tool poisoning (${check.reasons.join(", ")})`);
        } catch (error) {
          // Unknown pin state: fail closed rather than treat the tool as approved.
          s = "quarantined";
          log(`pin check failed for ${def.name}, hiding it: ${(error as Error).message}`);
        }
      }
      status.set(def.name, s);
      if (s !== "quarantined") visible.push(def);
    }
    return visible;
  }

  // Batches (removed from MCP in 2025-06-18) are unbatched so no call can skip the policy check.
  const each = (line: string, handle: (m: JsonRpcMessage) => void, raw: (l: string) => void) => {
    const frame = parseFrame(line);
    if (frame === null) return raw(line);
    for (const m of Array.isArray(frame) ? frame : [frame]) {
      if (m !== null && typeof m === "object" && !Array.isArray(m)) handle(m);
    }
  };

  // A line from the client that is not JSON could hide a call (JSON parsers differ): answer, never forward.
  const refuseUnparsable = (line: string) => {
    log(`refused a client message that is not valid JSON (${line.length} bytes)`);
    toClient({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error (refused by Firebreak)" },
    });
  };

  const clientLines = new LineSplitter();
  opts.stdin.on("data", (chunk) => {
    for (const line of clientLines.push(chunk)) each(line, handleClientMessage, refuseUnparsable);
  });
  opts.stdin.on("end", () => {
    if (upstreamAlive) child.stdin.end();
  });

  const upstreamLines = new LineSplitter();
  child.stdout.on("data", (chunk) => {
    for (const line of upstreamLines.push(chunk)) each(line, handleUpstreamMessage, toClient);
  });

  return new Promise<number>((resolve) => {
    const finish = (code: number) => {
      upstreamAlive = false;
      const error = { code: -32603, message: "Firebreak: the upstream MCP server exited before answering" };
      for (const [k, call] of inFlight) {
        // Forwarded but unanswered: it may have run, so it must still be in the audit log.
        audit(call, { latencyMs: Date.now() - call.started });
        toClient({ jsonrpc: "2.0", id: JSON.parse(k), error });
      }
      inFlight.clear();
      for (const [k, pending] of awaiting) {
        pending.cancel();
        toClient({ jsonrpc: "2.0", id: JSON.parse(k), error });
      }
      resolve(code);
    };
    child.on("error", (error) => {
      log(`could not start upstream "${opts.command}": ${error.message}`);
      finish(127);
    });
    child.on("exit", (code, signal) => finish(code ?? (signal ? 1 : 0)));
    if (opts.handleSignals) {
      for (const sig of ["SIGINT", "SIGTERM"] as const) {
        process.once(sig, () => {
          log(`received ${sig}, stopping the upstream server`);
          child.kill("SIGTERM");
        });
      }
    }
  });
}
