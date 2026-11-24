// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import type { NetConnection } from "@zuke/core";

/**
 * Connect to a loopback port as a worker would. Deno's `write` can be
 * partial, so this one loops until every byte is out, as `NetConnection`'s
 * does.
 */
export async function connect(port: number): Promise<NetConnection> {
  const conn = await Deno.connect({ hostname: "127.0.0.1", port });
  return {
    readable: conn.readable,
    async write(bytes) {
      let written = 0;
      while (written < bytes.length) {
        written += await conn.write(bytes.subarray(written));
      }
    },
    closeWrite: () => conn.closeWrite(),
    close: () => conn.close(),
  };
}
