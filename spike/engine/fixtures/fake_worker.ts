// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A scripted worker for the engine's tests. `ZUKE_FAKE_PLAN` carries the
 * manifest, answered verbatim to `build.describe`, plus per target what its
 * body should do: `exec` argv lists to run through the engine, an
 * `expectStdout` the last exec must print (proving the worker's environment
 * reached the child), a `barrier` name every member must reach before any
 * proceeds (proving the engine ran them concurrently), a `fail` message to end
 * with, a `failTimes` count of attempts to fail before succeeding (proving
 * retries), and an `execAs` name to attribute execs to instead of the target's
 * own (an engine refusal the tests provoke).
 *
 * It prints every call the engine makes as a `call:` line, and the
 * `build.configure` payload as a `configure:` line, on stdout on purpose: a
 * real worker's stray `print` must land in the log, not in the protocol, and
 * the conformance suite reads the transcript back from that log.
 *
 * @module
 */

import { Peer, RpcFailure } from "../src/peer.ts";
import { isRecord } from "../src/protocol.ts";

interface Script {
  exec: string[][];
  expectStdout?: string;
  barrier?: string;
  fail?: string;
  failTimes: number;
  execAs?: string;
}

const PLAN: unknown = JSON.parse(Deno.env.get("ZUKE_FAKE_PLAN") ?? "{}");
const SCRIPTS = new Map<string, Script>();
if (isRecord(PLAN) && Array.isArray(PLAN.targets)) {
  for (const t of PLAN.targets.filter(isRecord)) {
    SCRIPTS.set(String(t.name), {
      exec: Array.isArray(t.exec)
        ? t.exec.filter(Array.isArray).map((argv) => argv.map(String))
        : [],
      expectStdout: typeof t.expectStdout === "string"
        ? t.expectStdout
        : undefined,
      barrier: typeof t.barrier === "string" ? t.barrier : undefined,
      fail: typeof t.fail === "string" ? t.fail : undefined,
      failTimes: typeof t.failTimes === "number" ? t.failTimes : 0,
      execAs: typeof t.execAs === "string" ? t.execAs : undefined,
    });
  }
}
const started = new Set<string>();
const attempts = new Map<string, number>();

async function awaitBarrier(name: string): Promise<void> {
  const members = [...SCRIPTS].filter(([, s]) => s.barrier === name)
    .map(([n]) => n);
  const deadline = Date.now() + 5_000;
  while (!members.every((m) => started.has(m))) {
    if (Date.now() > deadline) {
      throw new Error(`barrier "${name}": not every member started`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function runTarget(peer: Peer, params: unknown): Promise<unknown> {
  const name = isRecord(params) && typeof params.target === "string"
    ? params.target
    : "";
  const script = SCRIPTS.get(name);
  if (script === undefined) throw new Error(`no such target "${name}"`);
  console.log(`call: target.run ${name}`);
  started.add(name);
  if (script.barrier !== undefined) await awaitBarrier(script.barrier);
  let lastStdout = "";
  for (const argv of script.exec) {
    const result = await peer.request("exec", {
      target: script.execAs ?? name,
      argv,
    });
    lastStdout = isRecord(result) && typeof result.stdout === "string"
      ? result.stdout
      : "";
  }
  if (
    script.expectStdout !== undefined &&
    !lastStdout.includes(script.expectStdout)
  ) {
    throw new Error(
      `expected stdout to contain "${script.expectStdout}", got "${lastStdout.trim()}"`,
    );
  }
  const attempt = (attempts.get(name) ?? 0) + 1;
  attempts.set(name, attempt);
  if (attempt <= script.failTimes) {
    throw new RpcFailure(-32000, `attempt ${attempt} of ${name} failed`);
  }
  if (script.fail !== undefined) throw new RpcFailure(-32000, script.fail);
  return {};
}

const [hostname, port] = (Deno.env.get("ZUKE_ENGINE_ADDR") ?? "").split(":");
const conn = await Deno.connect({ hostname, port: Number(port) });
const peer = new Peer(conn);
peer.on("build.describe", () => PLAN);
peer.on("build.configure", (params) => {
  console.log("call: build.configure");
  console.log(`configure: ${JSON.stringify(params)}`);
});
peer.on("target.run", (params) => runTarget(peer, params));
peer.on("run.cancel", () => {});
peer.on("run.exit", () => {
  peer.close();
  Deno.exit(0);
});
const serving = peer.serve();
console.log("fake worker started");
Deno.env.set("ZUKE_FAKE_ENV_MARK", "from-worker");
try {
  await peer.request("hello", {
    sdk: "zuke-fake",
    protocol: 1,
    token: Deno.env.get("ZUKE_FAKE_BAD_TOKEN") ??
      Deno.env.get("ZUKE_ENGINE_TOKEN"),
    env: Deno.env.toObject(),
    cwd: Deno.cwd(),
  });
  await serving;
} finally {
  // An engine that hangs up, as it does on a refused greeting, is the end.
  Deno.exit(0);
}
