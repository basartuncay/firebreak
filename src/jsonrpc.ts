import { StringDecoder } from "node:string_decoder";

export type JsonRpcId = string | number | null;

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

/** Turns a byte stream of newline-delimited JSON-RPC (MCP stdio transport) into complete lines. */
export class LineSplitter {
  private buffer = "";
  // Keeps a multibyte character that was cut between two chunks intact.
  private decoder = new StringDecoder("utf8");

  push(chunk: Buffer | string): string[] {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    const parts = this.buffer.split("\n");
    this.buffer = parts.pop() ?? "";
    return parts.map((line) => line.replace(/\r$/, "")).filter((line) => line.trim() !== "");
  }
}

/** Parses one line; null when it is not a JSON object or array. */
export function parseFrame(line: string): JsonRpcMessage | JsonRpcMessage[] | null {
  try {
    const value = JSON.parse(line);
    return value !== null && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export const isRequest = (m: JsonRpcMessage): boolean => typeof m.method === "string" && m.id != null;
export const isNotification = (m: JsonRpcMessage): boolean => typeof m.method === "string" && m.id == null;
export const isResponse = (m: JsonRpcMessage): boolean =>
  m.method === undefined && m.id !== undefined && ("result" in m || "error" in m);
