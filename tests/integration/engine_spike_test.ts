// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The engine/worker spike, driven through the real CLI `main()`: a build the
 * scripted fake worker describes over the loopback socket runs on the
 * unmodified engine, with every subprocess spawned by the engine.
 */

import { Build, target } from "../../packages/core/mod.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { WorkerHost } from "../../spike/engine/src/host.ts";
import { materialize } from "../../spike/engine/src/materialize.ts";
import { runCli, withStateDir } from "./_harness.ts";

const FAKE =
  new URL("../../spike/engine/fixtures/fake_worker.ts", import.meta.url)
    .href;

interface PlanTarget {
  name: string;
  description?: string;
  dependsOn?: string[];
  exec?: string[][];
  expectStdout?: string;
  barrier?: string;
  fail?: string;
  execAs?: string;
  condition?: boolean;
  condition_answer?: unknown;
  cacheKey?: boolean;
  cacheKey_answer?: unknown;
  calls?: Array<{ method: string; params: Record<string, unknown> }>;
  validateDuring?: boolean;
  settings?: unknown;
  validate_fail?: string;
}

/** Start the fake worker on `plan` and materialise its build. */
async function fake(
  targets: PlanTarget[],
  options: {
    badToken?: string;
    connectTimeoutMs?: number;
    manifest?: Record<string, unknown>;
  } = {},
): Promise<{ host: WorkerHost; Remote: new () => Build }> {
  Deno.env.set(
    "ZUKE_FAKE_PLAN",
    JSON.stringify({ name: "Fake", targets, ...options.manifest }),
  );
  if (options.badToken !== undefined) {
    Deno.env.set("ZUKE_FAKE_BAD_TOKEN", options.badToken);
  } else Deno.env.delete("ZUKE_FAKE_BAD_TOKEN");
  const host = await WorkerHost.start({
    command: [Deno.execPath(), "run", "-A", FAKE],
    cwd: Deno.cwd(),
    connectTimeoutMs: options.connectTimeoutMs,
    graceMs: 1_000,
  });
  return { host, Remote: materialize(await host.describe(), host) };
}

/** An argv that runs `source` in a fresh Deno. */
function evalArgv(source: string): string[] {
  return [Deno.execPath(), "eval", source];
}

Deno.test("--list --json for a worker-described build matches its zuke.ts twin", async () => {
  class Twin extends Build {
    lint = target().description("lint it");
    test = target().description("test it").dependsOn(this.lint);
    default = target().description("all").dependsOn(this.test);
  }
  const { host, Remote } = await fake([
    { name: "lint", description: "lint it" },
    { name: "test", description: "test it", dependsOn: ["lint"] },
    { name: "default", description: "all", dependsOn: ["test"] },
  ]);
  try {
    const remote = await runCli(Remote, ["--list", "--json"]);
    const twin = await runCli(Twin, ["--list", "--json"]);
    assertEquals(remote.code, 0);
    assertEquals(remote.out, twin.out);
  } finally {
    await host.finish(0);
  }
});

Deno.test("the engine runs the graph, spawns each exec itself with the worker's env, and logs the worker's prints to stderr", async () => {
  await withStateDir(async (dir) => {
    const marker = `${dir}/marker`;
    const { host, Remote } = await fake([
      {
        name: "a",
        barrier: "pair",
        exec: [evalArgv("console.log(Deno.env.get('ZUKE_FAKE_ENV_MARK'))")],
        expectStdout: "from-worker",
      },
      {
        name: "b",
        barrier: "pair",
        exec: [
          evalArgv(`Deno.writeTextFileSync(${JSON.stringify(marker)}, "1")`),
        ],
      },
      { name: "all", dependsOn: ["a", "b"] },
    ]);
    try {
      const result = await runCli(Remote, ["all", "--parallel"]);
      assertEquals(result.code, 0, result.out + result.err);
      assertEquals(await Deno.readTextFile(marker), "1");
      assertStringIncludes(result.err, "worker: call: target.run a");
      assertStringIncludes(result.out, "all succeeded");
    } finally {
      await host.finish(0);
    }
  });
});

Deno.test("a body that fails marks its target failed with the worker's message", async () => {
  await withStateDir(async () => {
    const { host, Remote } = await fake([
      { name: "boom", fail: "the worker said no" },
      { name: "after", dependsOn: ["boom"] },
    ]);
    try {
      const result = await runCli(Remote, ["after"]);
      assertEquals(result.code, 1);
      assertStringIncludes(result.out + result.err, "the worker said no");
    } finally {
      await host.finish(1);
    }
  });
});

Deno.test("a worker hook that throws fails the run with its message", async () => {
  await withStateDir(async () => {
    const { host, Remote } = await fake(
      [{ name: "a" }],
      {
        manifest: { hooks: { onTargetStart: true }, failHook: "onTargetStart" },
      },
    );
    try {
      const result = await runCli(Remote, ["a"]);
      assertEquals(result.code, 1);
      assertStringIncludes(
        result.out + result.err,
        "the worker's onTargetStart threw",
      );
      assertEquals(result.err.includes("worker: call: target.run a"), false);
    } finally {
      await host.finish(1);
    }
  });
});

Deno.test("a condition answered with the wrong type is refused, naming the target", async () => {
  await withStateDir(async () => {
    const { host, Remote } = await fake([
      { name: "gated", condition: true, condition_answer: "yes" },
    ]);
    try {
      const gated = await runCli(Remote, ["gated"]);
      assertEquals(gated.code, 1);
      assertStringIncludes(
        gated.out + gated.err,
        'target.condition: "gated" must answer a boolean',
      );
      assertEquals(gated.err.includes("worker: call: target.run"), false);
    } finally {
      await host.finish(1);
    }
  });
});

Deno.test("a cache key answered with the wrong type is refused, naming the target", async () => {
  await withStateDir(async () => {
    const { host, Remote } = await fake([
      { name: "keyed", cacheKey: true, cacheKey_answer: 1 },
    ]);
    try {
      const keyed = await runCli(Remote, ["keyed"]);
      assertEquals(keyed.code, 1);
      assertStringIncludes(
        keyed.out + keyed.err,
        'target.cacheKey: "keyed" must answer a string',
      );
    } finally {
      await host.finish(1);
    }
  });
});

Deno.test("a registered secret is redacted from the summary the engine renders", async () => {
  await withStateDir(async () => {
    const { host, Remote } = await fake([{
      name: "leaky",
      calls: [
        { method: "secret.register", params: { value: "hunter2-secret" } },
        { method: "log", params: { line: "token is hunter2-secret" } },
        {
          method: "summary.report",
          params: { pairs: { Token: "hunter2-secret" } },
        },
      ],
    }]);
    try {
      const result = await runCli(Remote, ["leaky"]);
      assertEquals(result.code, 0, result.out + result.err);
      assertStringIncludes(result.out, "Token: [redacted]");
      // A log line is the worker's print: not redacted, like a body's console.log.
      assertStringIncludes(result.out, "token is hunter2-secret");
    } finally {
      await host.finish(0);
    }
  });
});

Deno.test("a body reads a settled dependency's outcome, null for an unknown target, and the outcomes map", async () => {
  await withStateDir(async () => {
    const { host, Remote } = await fake([
      { name: "dep" },
      {
        name: "asker",
        dependsOn: ["dep"],
        calls: [
          { method: "outcome.of", params: { of: "dep" } },
          { method: "outcome.of", params: { of: "ghost" } },
          { method: "outcomes", params: {} },
        ],
      },
    ]);
    try {
      const result = await runCli(Remote, ["asker"]);
      assertEquals(result.code, 0, result.out + result.err);
      const answers = result.err.split("\n").filter((l) =>
        l.includes("answer: outcome")
      );
      assertStringIncludes(answers[0] ?? "", '"status":"succeeded"');
      assertStringIncludes(answers[1] ?? "", "outcome.of null");
      assertStringIncludes(answers[2] ?? "", '"dep":{"status":"succeeded"');
    } finally {
      await host.finish(0);
    }
  });
});

Deno.test("a malformed context call is refused naming the field, and the body goes on", async () => {
  await withStateDir(async () => {
    const { host, Remote } = await fake([{
      name: "sloppy",
      calls: [
        { method: "state.set", params: { patch: "nope" } },
        { method: "summary.report", params: { pairs: { Count: true } } },
        { method: "secret.register", params: { value: "" } },
        { method: "outcome.of", params: {} },
      ],
    }]);
    try {
      const result = await runCli(Remote, ["sloppy"]);
      assertEquals(result.code, 0, result.out + result.err);
      assertStringIncludes(
        result.err,
        'answer: state.set error state.set: field "patch" must be an object',
      );
      assertStringIncludes(
        result.err,
        'field "pairs.Count" must be a string or a number',
      );
      assertStringIncludes(result.err, "value must not be empty");
      assertStringIncludes(result.err, 'outcome.of: missing field "of"');
    } finally {
      await host.finish(0);
    }
  });
});

Deno.test("a validateDuring check the worker fails ends the target with its message", async () => {
  await withStateDir(async () => {
    const { host, Remote } = await fake([{
      name: "slow",
      validateDuring: true,
      settings: { validateDuring: { every: "50ms", checks: ["disk", "mem"] } },
      validate_fail: "mem",
      exec: [evalArgv("await new Promise((r) => setTimeout(r, 5_000))")],
    }]);
    try {
      const result = await runCli(Remote, ["slow"]);
      assertEquals(result.code, 1);
      assertStringIncludes(
        result.out + result.err,
        "check mem found a problem",
      );
      assertStringIncludes(
        result.err,
        "worker: call: target.validate slow disk",
      );
    } finally {
      await host.finish(1);
    }
  });
});

Deno.test("--dry-run never calls a body, so nothing is spawned", async () => {
  await withStateDir(async (dir) => {
    const marker = `${dir}/dry-marker`;
    const { host, Remote } = await fake([
      {
        name: "write",
        exec: [
          evalArgv(`Deno.writeTextFileSync(${JSON.stringify(marker)}, "1")`),
        ],
      },
    ]);
    try {
      const result = await runCli(Remote, ["write", "--dry-run"]);
      assertEquals(result.code, 0, result.out + result.err);
      assertStringIncludes(result.out, "dry run");
      await assertRejects(() => Deno.stat(marker), Deno.errors.NotFound);
    } finally {
      await host.finish(0);
    }
  });
});

Deno.test("a cancel mid-exec kills the child, fails the body as cancelled, and ends the run", async () => {
  await withStateDir(async () => {
    const { host, Remote } = await fake([
      {
        name: "slow",
        exec: [evalArgv("await new Promise((r) => setTimeout(r, 30_000))")],
      },
    ]);
    const controller = new AbortController();
    const started = Date.now();
    try {
      setTimeout(() => controller.abort(), 500);
      const result = await runCli(Remote, ["slow"], {
        signal: controller.signal,
      });
      assertEquals(result.code !== 0, true, result.out + result.err);
      assertStringIncludes((result.out + result.err).toLowerCase(), "cancel");
      assertEquals(Date.now() - started < 20_000, true);
    } finally {
      await host.finish(1);
    }
  });
});

Deno.test("an exec attributed to a target with no running body is refused", async () => {
  await withStateDir(async () => {
    const { host, Remote } = await fake([
      { name: "x", execAs: "ghost", exec: [evalArgv("1")] },
    ]);
    try {
      assertEquals(host.sdk, "zuke-fake");
      const result = await runCli(Remote, ["x"]);
      assertEquals(result.code, 1);
      assertStringIncludes(
        result.out + result.err,
        'target "ghost" has no body running',
      );
    } finally {
      await host.finish(1);
    }
  });
});

Deno.test({
  name:
    "a worker that ignores SIGTERM is killed within the grace period on a failed start",
  ignore: Deno.build.os === "windows", // No SIGTERM listener there; kill is final.
  async fn() {
    const started = Date.now();
    await assertRejects(
      () =>
        WorkerHost.start({
          command: evalArgv(
            "Deno.addSignalListener('SIGTERM', () => {}); " +
              "await new Promise((r) => setTimeout(r, 60_000))",
          ),
          cwd: Deno.cwd(),
          connectTimeoutMs: 300,
          graceMs: 300,
        }),
      Error,
      "did not connect within 300ms",
    );
    assertEquals(Date.now() - started < 10_000, true);
  },
});

Deno.test("a worker that never connects, exits early, or greets with the wrong token, is reported and killed", async () => {
  await assertRejects(
    () =>
      WorkerHost.start({
        command: evalArgv("Deno.exit(3)"),
        cwd: Deno.cwd(),
      }),
    Error,
    "exited with code 3 before connecting",
  );
  await assertRejects(
    () =>
      WorkerHost.start({
        command: evalArgv("await new Promise((r) => setTimeout(r, 60_000))"),
        cwd: Deno.cwd(),
        connectTimeoutMs: 500,
      }),
    Error,
    "did not connect within 500ms",
  );
  await assertRejects(
    () => fake([{ name: "x" }], { badToken: "wrong" }),
    Error,
    "token mismatch",
  );
});
