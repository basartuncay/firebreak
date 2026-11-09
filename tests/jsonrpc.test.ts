import { describe, expect, it } from "vitest";
import { isNotification, isRequest, isResponse, LineSplitter, parseFrame } from "../src/jsonrpc.js";

describe("LineSplitter", () => {
  it("splits and joins frames across chunks", () => {
    const s = new LineSplitter();
    expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(s.push(':2}\r\n{"c":3}\n')).toEqual(['{"b":2}', '{"c":3}']);
    expect(s.push(Buffer.from('{"d":4}'))).toEqual([]);
    expect(s.push("\n")).toEqual(['{"d":4}']);
  });

  it("ignores blank lines", () => {
    const s = new LineSplitter();
    expect(s.push('\n\n{"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it("keeps multibyte characters split across buffers", () => {
    const s = new LineSplitter();
    const bytes = Buffer.from('{"t":"ğü"}\n');
    expect(s.push(bytes.subarray(0, 8))).toEqual([]);
    expect(s.push(bytes.subarray(8))).toEqual(['{"t":"ğü"}']);
  });
});

describe("parseFrame", () => {
  it("returns null for garbage", () => {
    expect(parseFrame("not json")).toBeNull();
    expect(parseFrame("42")).toBeNull();
  });

  it("parses objects and batches", () => {
    expect(parseFrame('{"jsonrpc":"2.0","method":"x"}')).toEqual({ jsonrpc: "2.0", method: "x" });
    expect(parseFrame('[{"jsonrpc":"2.0","method":"x"}]')).toHaveLength(1);
  });

  it("classifies request, notification and response", () => {
    const req = { jsonrpc: "2.0" as const, id: 1, method: "tools/call" };
    const note = { jsonrpc: "2.0" as const, method: "notifications/cancelled" };
    const res = { jsonrpc: "2.0" as const, id: 1, result: {} };
    expect([isRequest(req), isNotification(req), isResponse(req)]).toEqual([true, false, false]);
    expect([isRequest(note), isNotification(note), isResponse(note)]).toEqual([false, true, false]);
    expect([isRequest(res), isNotification(res), isResponse(res)]).toEqual([false, false, true]);
  });
});
