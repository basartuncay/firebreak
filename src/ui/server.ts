import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import type { Decision } from "../policy/defaults.js";
import { openStore, type Store } from "../store/db.js";

const COOKIE = "fb_token";

const sameToken = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createUiApp(store: Store, opts: { token: string; staticDir?: string }) {
  const app = new Hono();

  // Every route needs the token: other web pages on this machine must not read or approve anything.
  app.use("*", async (c, next) => {
    const query = c.req.query("token");
    const cookie = getCookie(c, COOKIE);
    if (query && sameToken(query, opts.token)) {
      setCookie(c, COOKIE, opts.token, { httpOnly: true, sameSite: "Strict", path: "/" });
    } else if (!cookie || !sameToken(cookie, opts.token)) {
      if (c.req.path.startsWith("/api/")) return c.json({ error: "missing or invalid token" }, 401);
      return c.text("Open the link printed by `firebreak ui` (it contains a one-time access token).", 401);
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("origin");
      if (origin) {
        let host = "";
        try {
          host = new URL(origin).host;
        } catch {
          // malformed origin: treated as foreign
        }
        if (host !== c.req.header("host")) return c.json({ error: "cross-origin request refused" }, 403);
      }
    }
    await next();
  });

  app.get("/api/approvals", (c) =>
    c.json({ pending: store.approvals.listPending(), recent: store.approvals.listRecent(50) }),
  );

  app.post("/api/approvals/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { decision?: string; reason?: unknown };
    if (body.decision !== "approved" && body.decision !== "denied") {
      return c.json({ error: 'decision must be "approved" or "denied"' }, 400);
    }
    const reason =
      typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : undefined;
    if (!store.approvals.get(id)) return c.json({ error: `no approval #${id}` }, 404);
    const changed = store.approvals.decide(id, body.decision, "ui", reason);
    return changed ? c.json(store.approvals.get(id)) : c.json({ error: "already decided" }, 409);
  });

  app.get("/api/events", (c) => {
    const q = c.req.query();
    const decision = ["allow", "confirm", "deny"].includes(q.decision ?? "")
      ? (q.decision as Decision)
      : undefined;
    return c.json({
      events: store.audit.list({
        limit: Number(q.limit ?? 100) || 100,
        ...(q.server ? { server: q.server } : {}),
        ...(q.tool ? { tool: q.tool } : {}),
        ...(decision ? { decision } : {}),
        ...(q.search ? { search: q.search } : {}),
        ...(q.sinceId ? { sinceId: Number(q.sinceId) } : {}),
      }),
    });
  });

  app.get("/api/tools", (c) => c.json({ tools: store.pins.list() }));

  app.post("/api/tools/:server/:name/approve", (c) => {
    const ok = store.pins.approve(c.req.param("server"), c.req.param("name"));
    return ok ? c.json({ ok }) : c.json({ error: "no such tool" }, 404);
  });

  app.get("/api/stats", (c) => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    return c.json({
      ...store.audit.stats(since),
      pending: store.approvals.listPending().length,
      tools: store.pins.list().reduce<Record<string, number>>((acc, p) => {
        acc[p.status] = (acc[p.status] ?? 0) + 1;
        return acc;
      }, {}),
      chain: store.audit.verify(),
    });
  });

  // Live updates: polls the store (other processes write to it) and pushes what changed.
  app.get("/api/stream", (c) =>
    streamSSE(c, async (stream) => {
      let lastEvent = store.audit.list({ limit: 1 })[0]?.id ?? 0;
      let lastPending = "";
      while (!stream.aborted) {
        const events = store.audit.list({ sinceId: lastEvent, limit: 200 });
        if (events.length) {
          lastEvent = events[0]!.id;
          await stream.writeSSE({ event: "events", data: JSON.stringify(events) });
        }
        const pending = store.approvals.listPending();
        const signature = pending.map((p) => p.id).join(",");
        if (signature !== lastPending) {
          lastPending = signature;
          await stream.writeSSE({ event: "approvals", data: JSON.stringify(pending) });
        }
        await stream.sleep(1000);
      }
    }),
  );

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const root = opts.staticDir;
    app.use("/*", serveStatic({ root }));
    const index = readFileSync(join(root, "index.html"), "utf8");
    app.get("*", (c) => c.html(index));
  }

  return app;
}

export const webDir = (): string => fileURLToPath(new URL("../web", import.meta.url));

export async function startUi(opts: { port?: number; store?: Store } = {}) {
  const store = opts.store ?? openStore();
  const token = randomBytes(18).toString("base64url");
  const app = createUiApp(store, { token, staticDir: webDir() });
  const port = opts.port ?? 4319;
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  return { url: `http://127.0.0.1:${port}/?token=${token}`, close: () => server.close() };
}
