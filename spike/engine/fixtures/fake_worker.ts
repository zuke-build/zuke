// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A scripted worker for the engine's tests. `ZUKE_FAKE_PLAN` carries the
 * manifest plus, per target, what its body should do: `exec` argv lists to
 * run through the engine, an `expectStdout` the last exec must print (proving
 * the worker's environment reached the child), a `barrier` name every member
 * must reach before any proceeds (proving the engine ran them concurrently),
 * a `fail` message to end with, and an `execAs` name to attribute execs to
 * instead of the target's own (an engine refusal the tests provoke).
 *
 * It prints one line to stdout on purpose: a real worker's stray `print` must
 * land in the log, not in the protocol.
 *
 * @module
 */

import { Peer, RpcFailure } from "../src/peer.ts";
import { isRecord } from "../src/protocol.ts";

interface PlanTarget {
  name: string;
  description?: string;
  dependsOn?: string[];
  exec?: string[][];
  expectStdout?: string;
  barrier?: string;
  fail?: string;
  execAs?: string;
}

interface Plan {
  name: string;
  targets: PlanTarget[];
}

function plan(): Plan {
  const parsed: unknown = JSON.parse(Deno.env.get("ZUKE_FAKE_PLAN") ?? "{}");
  if (!isRecord(parsed) || !Array.isArray(parsed.targets)) {
    throw new Error("ZUKE_FAKE_PLAN must carry targets");
  }
  const targets = parsed.targets.filter(isRecord).map((t) => ({
    name: String(t.name),
    description: typeof t.description === "string" ? t.description : undefined,
    dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : undefined,
    exec: Array.isArray(t.exec)
      ? t.exec.filter(Array.isArray).map((argv) => argv.map(String))
      : undefined,
    expectStdout: typeof t.expectStdout === "string"
      ? t.expectStdout
      : undefined,
    barrier: typeof t.barrier === "string" ? t.barrier : undefined,
    fail: typeof t.fail === "string" ? t.fail : undefined,
    execAs: typeof t.execAs === "string" ? t.execAs : undefined,
  }));
  return { name: String(parsed.name ?? "Fake"), targets };
}

const PLAN = plan();
const started = new Set<string>();

async function awaitBarrier(name: string): Promise<void> {
  const members = PLAN.targets.filter((t) => t.barrier === name)
    .map((t) => t.name);
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
  const t = PLAN.targets.find((candidate) => candidate.name === name);
  if (t === undefined) throw new Error(`no such target "${name}"`);
  console.log(`fake worker running ${name}`);
  started.add(name);
  if (t.barrier !== undefined) await awaitBarrier(t.barrier);
  let lastStdout = "";
  for (const argv of t.exec ?? []) {
    const result = await peer.request("exec", {
      target: t.execAs ?? name,
      argv,
    });
    lastStdout = isRecord(result) && typeof result.stdout === "string"
      ? result.stdout
      : "";
  }
  if (t.expectStdout !== undefined && !lastStdout.includes(t.expectStdout)) {
    throw new Error(
      `expected stdout to contain "${t.expectStdout}", got "${lastStdout.trim()}"`,
    );
  }
  if (t.fail !== undefined) throw new RpcFailure(-32000, t.fail);
  return {};
}

const [hostname, port] = (Deno.env.get("ZUKE_ENGINE_ADDR") ?? "").split(":");
const conn = await Deno.connect({ hostname, port: Number(port) });
const peer = new Peer(conn);
peer.on("build.describe", () => PLAN);
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
