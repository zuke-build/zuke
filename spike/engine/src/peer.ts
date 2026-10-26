// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A symmetric JSON-RPC 2.0 peer over one newline-delimited connection: both
 * sides send requests and notifications, and each answers the other's.
 *
 * @module
 */

import { INVALID_PARAMS, isRecord } from "./protocol.ts";

/** A request handler: returns the result, or throws to produce an error. */
export type RpcHandler = (params: unknown) => unknown | Promise<unknown>;

/** An error the remote side answered a request with. */
export class RpcFailure extends Error {
  /** The error name. */
  override name = "RpcFailure";
  /** Build the failure from the remote error's code and message. */
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

const encoder = new TextEncoder();

/** The JSON-RPC peer. Call {@link serve} once to start reading. */
export class Peer {
  #conn: Deno.Conn;
  #next = 1;
  #pending = new Map<number, Pending>();
  #handlers = new Map<string, RpcHandler>();
  #writes: Promise<void> = Promise.resolve();
  #closed = false;
  #reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  #decoder = new TextDecoder();

  /** Wrap an open connection. */
  constructor(conn: Deno.Conn) {
    this.#conn = conn;
  }

  /** Register the handler for `method`. */
  on(method: string, handler: RpcHandler): this {
    this.#handlers.set(method, handler);
    return this;
  }

  /** Send a request and await its result. */
  request(method: string, params: unknown): Promise<unknown> {
    const id = this.#next++;
    const result = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.#send({ jsonrpc: "2.0", id, method, params });
    return result;
  }

  /** Send a notification: no answer is expected. */
  notify(method: string, params: unknown): Promise<void> {
    return this.#send({ jsonrpc: "2.0", method, params });
  }

  /** Read until the connection ends, dispatching every message. */
  async serve(): Promise<void> {
    let buffered = "";
    const reader = this.#conn.readable.getReader();
    this.#reader = reader;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += this.#decoder.decode(value, { stream: true });
        let newline = buffered.indexOf("\n");
        while (newline !== -1) {
          const line = buffered.slice(0, newline).trim();
          buffered = buffered.slice(newline + 1);
          if (line !== "") this.#dispatch(line);
          newline = buffered.indexOf("\n");
        }
      }
    } catch (error) {
      if (!this.#closed) throw error; // A read after close() is the close.
    } finally {
      this.close();
    }
  }

  /** Close the connection; every pending request rejects. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    // A pending read on a closed connection never settles; cancelling the
    // reader is what ends serve().
    void this.#reader?.cancel().catch(() => {});
    try {
      this.#conn.close();
    } catch {
      // Already closed by the other side: nothing left to release.
    }
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      pending.reject(new RpcFailure(-32000, "connection closed"));
    }
  }

  #dispatch(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return; // Not JSON: a worker that spoke on the wrong channel. Ignore it.
    }
    if (!isRecord(message)) return;
    const { id, method } = message;
    if (typeof method === "string") {
      void this.#handle(method, message.params, id);
    } else if (typeof id === "number") {
      const pending = this.#pending.get(id);
      if (pending === undefined) return;
      this.#pending.delete(id);
      const error = message.error;
      if (isRecord(error)) {
        pending.reject(
          new RpcFailure(
            typeof error.code === "number" ? error.code : -32000,
            typeof error.message === "string" ? error.message : "error",
          ),
        );
      } else {
        pending.resolve(message.result);
      }
    }
  }

  async #handle(method: string, params: unknown, id: unknown): Promise<void> {
    const handler = this.#handlers.get(method);
    const answer = typeof id === "number";
    if (handler === undefined) {
      if (answer) {
        await this.#send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `unknown method "${method}"` },
        });
      }
      return;
    }
    try {
      const result = await handler(params);
      if (answer) {
        // A handler with nothing to say answers `{}`; `null` is an answer.
        await this.#send({
          jsonrpc: "2.0",
          id,
          result: result === undefined ? {} : result,
        });
      }
    } catch (error) {
      if (!answer) return;
      const code = error instanceof RpcFailure ? error.code : INVALID_PARAMS;
      const message = error instanceof Error ? error.message : String(error);
      await this.#send({ jsonrpc: "2.0", id, error: { code, message } });
    }
  }

  #send(message: Record<string, unknown>): Promise<void> {
    const bytes = encoder.encode(JSON.stringify(message) + "\n");
    // Serialise writes: a partial write from one message must never interleave
    // with another's bytes.
    this.#writes = this.#writes.then(async () => {
      if (this.#closed) return;
      let written = 0;
      while (written < bytes.length) {
        written += await this.#conn.write(bytes.subarray(written));
      }
    }).catch(() => this.close());
    return this.#writes;
  }
}
