import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { openStore } from "../src/store/db.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "dist/cli.js");

beforeAll(() => {
  const build = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8" });
  if (build.status !== 0) throw new Error(build.stdout + build.stderr);
}, 60_000);

function run(args: string[], home: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, FIREBREAK_HOME: home },
  });
}

const freshHome = () => mkdtempSync(join(tmpdir(), "firebreak-cli-"));

describe("cli", () => {
  it("init writes policy.yaml", () => {
    const home = freshHome();
    const r = run(["init"], home);
    expect(r.status).toBe(0);
    expect(existsSync(join(home, "policy.yaml"))).toBe(true);
    expect(readFileSync(join(home, "policy.yaml"), "utf8")).toContain("F1: confirm");
  });

  it("approve decides a pending approval", () => {
    const home = freshHome();
    const store = openStore(join(home, "firebreak.db"));
    const a = store.approvals.create({
      sessionId: "s",
      server: "mail",
      tool: "send_email",
      args: {},
      provenance: [],
      findings: [{ rule: "F1", decision: "confirm", message: "m" }],
    });
    expect(run(["approvals"], home).stdout).toContain(`#${a.id}`);
    const r = run(["approve", String(a.id)], home);
    expect(r.status).toBe(0);
    expect(store.approvals.get(a.id)?.status).toBe("approved");
    expect(run(["deny", String(a.id)], home).status).toBe(1);
  });

  it("audit verify reports ok", () => {
    const home = freshHome();
    const store = openStore(join(home, "firebreak.db"));
    store.audit.append({
      sessionId: "s",
      server: "mail",
      tool: "send_email",
      args: {},
      provenance: [],
      decision: "allow",
      findings: [],
    });
    const r = run(["audit", "verify"], home);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 events");
    expect(run(["audit", "tail"], home).stdout).toContain("mail/send_email");
  });

  it("rejects an invalid policy with the field path", () => {
    const home = freshHome();
    const r = spawnSync(
      process.execPath,
      [CLI, "wrap", "--policy", join(ROOT, "tests/fixtures/bad-policy.yaml"), "--", "node", "-e", "1"],
      { encoding: "utf8", env: { ...process.env, FIREBREAK_HOME: home } },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("rules.F3");
  });

  it("unknown command exits 2 with usage", () => {
    const r = run(["frobnicate"], freshHome());
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Usage:");
  });

  it("prints the version", () => {
    expect(run(["--version"], freshHome()).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
