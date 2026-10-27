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
 * retries), an `execAs` name to attribute execs to instead of the target's
 * own (an engine refusal the tests provoke), a `condition_answer` to answer
 * `target.condition` with and a `cacheKey_answer` to answer `target.cacheKey` with.
 * A `calls` list of `{ method, params }` is issued to the engine after the
 * execs, each answer printed as an `answer:` line for the tests to read back.
 * A `settings` object answers `target.settings`, a `wait_answer` answers
 * `wait.check`, and a `validate_fail` names the check that `target.validate`
 * fails. A service target answers `service.start` with `service_handle`
 * after running its `exec` list, `service.ready` with the next of
 * `ready_answers` (the last one repeats), and `service.stop` with nothing.
 * A `crash_exit` code ends the worker process from inside the body, for the
 * engine's respawn. A top-level `failHook` names the build hook that throws.
 * With `ZUKE_FAKE_GENERATION_FILE` set, a worker that finds the file is a
 * replacement and describes `ZUKE_FAKE_RESPAWN_PLAN` when that is set.
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
  condition: unknown;
  cacheKey: unknown;
  calls: Array<{ method: string; params: Record<string, unknown> }>;
  settings: unknown;
  waitAnswer: unknown;
  validateFail?: string;
  serviceHandle: unknown;
  readyAnswers: unknown[];
  crashExit?: number;
}

const GENERATION_FILE = Deno.env.get("ZUKE_FAKE_GENERATION_FILE");
let replacement = false;
if (GENERATION_FILE !== undefined) {
  try {
    Deno.statSync(GENERATION_FILE);
    replacement = true;
  } catch {
    Deno.writeTextFileSync(GENERATION_FILE, "started");
  }
}
const PLAN: unknown = JSON.parse(
  (replacement ? Deno.env.get("ZUKE_FAKE_RESPAWN_PLAN") : undefined) ??
    Deno.env.get("ZUKE_FAKE_PLAN") ?? "{}",
);
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
      // Answered as given, so a test can hand the engine the wrong type.
      condition: t.condition_answer ?? true,
      cacheKey: t.cacheKey_answer ?? "",
      calls: Array.isArray(t.calls)
        ? t.calls.filter(isRecord).map((c) => ({
          method: String(c.method),
          params: isRecord(c.params) ? c.params : {},
        }))
        : [],
      settings: t.settings ?? {},
      waitAnswer: t.wait_answer ?? false,
      validateFail: typeof t.validate_fail === "string"
        ? t.validate_fail
        : undefined,
      serviceHandle: t.service_handle ?? "h1",
      readyAnswers: Array.isArray(t.ready_answers) ? t.ready_answers : [true],
      crashExit: typeof t.crash_exit === "number" ? t.crash_exit : undefined,
    });
  }
}
const FAIL_HOOK = isRecord(PLAN) && typeof PLAN.failHook === "string"
  ? PLAN.failHook
  : undefined;

function targetOf(params: unknown): string {
  return isRecord(params) && typeof params.target === "string"
    ? params.target
    : "";
}

function script(params: unknown): Script {
  const name = targetOf(params);
  const found = SCRIPTS.get(name);
  if (found === undefined) throw new Error(`no such target "${name}"`);
  return found;
}

function hook(name: string, detail: (params: unknown) => string) {
  return (params: unknown) => {
    console.log(`call: build.${name}${detail(params)}`);
    if (FAIL_HOOK === name) {
      throw new RpcFailure(-32000, `the worker's ${name} threw`);
    }
  };
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

/** Issue the script's calls to the engine, printing each answer. */
async function callAll(peer: Peer, name: string, s: Script): Promise<void> {
  for (const call of s.calls) {
    try {
      const answer = await peer.request(call.method, {
        target: name,
        ...call.params,
      });
      console.log(`answer: ${call.method} ${JSON.stringify(answer)}`);
    } catch (error) {
      console.log(
        `answer: ${call.method} error ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** Run the script's execs through the engine; the last one's stdout. */
async function execAll(peer: Peer, name: string, s: Script): Promise<string> {
  let lastStdout = "";
  for (const argv of s.exec) {
    const result = await peer.request("exec", {
      target: s.execAs ?? name,
      argv,
    });
    lastStdout = isRecord(result) && typeof result.stdout === "string"
      ? result.stdout
      : "";
  }
  return lastStdout;
}

async function runTarget(peer: Peer, params: unknown): Promise<unknown> {
  const name = targetOf(params);
  const s = script(params);
  console.log(`call: target.run ${name}`);
  started.add(name);
  if (s.barrier !== undefined) await awaitBarrier(s.barrier);
  const lastStdout = await execAll(peer, name, s);
  if (
    s.expectStdout !== undefined &&
    !lastStdout.includes(s.expectStdout)
  ) {
    throw new Error(
      `expected stdout to contain "${s.expectStdout}", got "${lastStdout.trim()}"`,
    );
  }
  await callAll(peer, name, s);
  if (s.crashExit !== undefined) Deno.exit(s.crashExit);
  const attempt = (attempts.get(name) ?? 0) + 1;
  attempts.set(name, attempt);
  if (attempt <= s.failTimes) {
    throw new RpcFailure(-32000, `attempt ${attempt} of ${name} failed`);
  }
  if (s.fail !== undefined) throw new RpcFailure(-32000, s.fail);
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
peer.on("target.condition", (params) => {
  console.log(`call: target.condition ${targetOf(params)}`);
  return script(params).condition;
});
peer.on("target.cacheKey", (params) => {
  console.log(`call: target.cacheKey ${targetOf(params)}`);
  return script(params).cacheKey;
});
peer.on("service.start", async (params) => {
  const name = targetOf(params);
  console.log(`call: service.start ${name}`);
  await execAll(peer, name, script(params));
  await callAll(peer, name, script(params));
  return { handle: script(params).serviceHandle };
});
peer.on("service.ready", (params) => {
  const s = script(params);
  const handle = isRecord(params) ? params.handle : undefined;
  console.log(`call: service.ready ${targetOf(params)} ${String(handle)}`);
  return s.readyAnswers.length > 1 ? s.readyAnswers.shift() : s.readyAnswers[0];
});
peer.on("service.stop", (params) => {
  const handle = isRecord(params) ? params.handle : undefined;
  console.log(`call: service.stop ${targetOf(params)} ${String(handle)}`);
});
peer.on("target.settings", (params) => {
  console.log(`call: target.settings ${targetOf(params)}`);
  return script(params).settings;
});
peer.on("wait.check", (params) => {
  console.log(`call: wait.check ${targetOf(params)}`);
  return script(params).waitAnswer;
});
peer.on("target.validate", (params) => {
  const check = isRecord(params) && typeof params.check === "string"
    ? params.check
    : "?";
  console.log(`call: target.validate ${targetOf(params)} ${check}`);
  if (script(params).validateFail === check) {
    throw new RpcFailure(-32000, `check ${check} found a problem`);
  }
});
peer.on("run.exit", (params) => {
  console.log(
    `call: run.exit ${
      isRecord(params) && params.suspended === true ? "suspended" : "done"
    }`,
  );
  peer.close();
  Deno.exit(0);
});
peer.on("build.onStart", hook("onStart", () => ""));
peer.on("build.onTargetStart", hook("onTargetStart", (p) => ` ${targetOf(p)}`));
peer.on(
  "build.onTargetEnd",
  hook(
    "onTargetEnd",
    (p) =>
      ` ${targetOf(p)} ${
        isRecord(p) && typeof p.status === "string" ? p.status : "?"
      }`,
  ),
);
peer.on(
  "build.onFinish",
  hook("onFinish", (p) => ` ${isRecord(p) && p.ok === true ? "ok" : "failed"}`),
);
peer.on("run.cancel", () => {});
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
