// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The engine/worker spike, driven through the real CLI `main()`: a build the
 * scripted fake worker describes over the loopback socket runs on the
 * unmodified engine, with every subprocess spawned by the engine.
 */

import {
  Build,
  cicd,
  FileSystemBuildRegistry,
  parameter,
  target,
} from "../../packages/core/mod.ts";
import { McpServer } from "../../packages/core/src/mcp/server.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { FakeGraphHost } from "../../packages/core/tests/_fakes.ts";
import { WorkerHost } from "../../spike/engine/src/host.ts";
import { materialize } from "../../spike/engine/src/materialize.ts";
import { isRecord } from "../../spike/engine/src/protocol.ts";
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
  kind?: "target" | "service";
  ready?: boolean;
  readyTimeoutMs?: number;
  ready_answers?: boolean[];
  onCancel?: string;
  onFailure?: string;
  crash_exit?: number;
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

Deno.test("a service's start phase execs through the engine, and a body-only call is refused by name", async () => {
  await withStateDir(async (dir) => {
    const marker = `${dir}/service-marker`;
    const { host, Remote } = await fake([
      {
        name: "db",
        kind: "service",
        exec: [
          evalArgv(`Deno.writeTextFileSync(${JSON.stringify(marker)}, "up")`),
        ],
        calls: [{ method: "state.get", params: {} }],
      },
      { name: "test", dependsOn: ["db"] },
    ]);
    try {
      const result = await runCli(Remote, ["test"]);
      assertEquals(result.code, 0, result.out + result.err);
      assertEquals(await Deno.readTextFile(marker), "up");
      assertStringIncludes(
        result.err,
        "answer: state.get error state.get: a service phase has no body",
      );
      assertStringIncludes(result.err, "worker: call: service.stop db h1");
    } finally {
      await host.finish(0);
    }
  });
});

Deno.test("a service whose probe never turns true fails the run with core's timeout", async () => {
  await withStateDir(async () => {
    const { host, Remote } = await fake([
      {
        name: "db",
        kind: "service",
        ready: true,
        readyTimeoutMs: 300,
        ready_answers: [false],
      },
      { name: "test", dependsOn: ["db"] },
    ]);
    try {
      const result = await runCli(Remote, ["test"]);
      assertEquals(result.code, 1);
      assertStringIncludes(
        result.out + result.err,
        'Service "db" was not ready within 300ms',
      );
      assertEquals(result.err.includes("worker: call: target.run test"), false);
    } finally {
      await host.finish(1);
    }
  });
});

Deno.test("a worker that dies mid-body fails the target with its exit code, and the compensation runs in a fresh worker", async () => {
  await withStateDir(async () => {
    const { host, Remote } = await fake([
      { name: "deploy", onCancel: "rollback" },
      {
        name: "verify",
        dependsOn: ["deploy"],
        onFailure: "cancel-run",
        crash_exit: 7,
      },
      { name: "rollback" },
    ]);
    try {
      const result = await runCli(Remote, ["verify"]);
      assertEquals(result.code, 1);
      assertStringIncludes(result.out + result.err, "exited with code 7");
      assertStringIncludes(result.err, "worker: call: target.run rollback");
      // The replacement greets and is configured again; the first worker's
      // greeting predates the run's capture.
      assertStringIncludes(result.err, "worker: fake worker started");
      assertEquals(
        result.err.split("worker: call: build.configure").length - 1,
        2,
      );
    } finally {
      await host.finish(1);
    }
  });
});

Deno.test("a replacement worker that describes a different build is refused", async () => {
  await withStateDir(async (dir) => {
    Deno.env.set("ZUKE_FAKE_GENERATION_FILE", `${dir}/generation`);
    Deno.env.set(
      "ZUKE_FAKE_RESPAWN_PLAN",
      JSON.stringify({
        name: "Fake",
        targets: [
          { name: "deploy" },
          { name: "verify" },
          { name: "rollback" },
          {
            name: "extra",
          },
        ],
      }),
    );
    try {
      const { host, Remote } = await fake([
        { name: "deploy", onCancel: "rollback" },
        {
          name: "verify",
          dependsOn: ["deploy"],
          onFailure: "cancel-run",
          crash_exit: 3,
        },
        { name: "rollback" },
      ]);
      try {
        const result = await runCli(Remote, ["verify"]);
        assertEquals(result.code, 1);
        assertStringIncludes(
          result.out + result.err,
          "described a different build",
        );
        assertEquals(result.err.includes("call: target.run rollback"), false);
      } finally {
        await host.finish(1);
      }
    } finally {
      Deno.env.delete("ZUKE_FAKE_GENERATION_FILE");
      Deno.env.delete("ZUKE_FAKE_RESPAWN_PLAN");
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

/** Run `fn` with the process cwd in a fresh temp dir, removed afterwards. */
async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-engine-" });
  const prev = Deno.cwd();
  Deno.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    Deno.chdir(prev);
    await Deno.remove(dir, { recursive: true });
  }
}

/** Run `fn` with `name` set in the environment, restoring it afterwards. */
async function withEnv<T>(
  name: string,
  value: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = Deno.env.get(name);
  Deno.env.set(name, value);
  try {
    return await fn();
  } finally {
    if (prev === undefined) Deno.env.delete(name);
    else Deno.env.set(name, prev);
  }
}

Deno.test("graph, its HTML page and the completion script for a worker-described build match the twin's", async () => {
  class Twin extends Build {
    lint = target().description("lint it");
    test = target().description("test it").dependsOn(this.lint);
    default = target().description("all").dependsOn(this.test);
  }
  const { host, Remote } = await fake([
    { name: "lint", description: "lint it" },
    { name: "test", description: "test it", dependsOn: ["lint"] },
    { name: "default", description: "all", dependsOn: ["test"] },
  ], { manifest: { name: "Twin" } });
  try {
    for (
      const argv of [["graph"], ["completions", "print", "bash"], ["--help"]]
    ) {
      const remote = await runCli(Remote, argv);
      const twin = await runCli(Twin, argv);
      assertEquals(remote.code, 0, remote.err);
      assertEquals(remote.out, twin.out, argv.join(" "));
    }
    const page = async (B: new () => Build) => {
      const graphHost = new FakeGraphHost("/repo", ["/repo/zuke.json"]);
      const result = await runCli(B, ["graph", "--output=html", "--no-open"], {
        graphHost,
      });
      assertEquals(result.code, 0, result.err);
      return graphHost.files.get("/repo/.zuke/graph.html") ?? "";
    };
    const html = await page(Remote);
    assertStringIncludes(html, "<html");
    assertEquals(html, await page(Twin));
  } finally {
    await host.finish(0);
  }
});

Deno.test("generate-ci writes for a worker-described build the files its twin declares, byte for byte", async () => {
  const pin = (action: string) =>
    `${action}@0000000000000000000000000000000000000000`;
  const gate = {
    name: "Gate",
    triggers: { push: ["main"], pullRequest: ["main"] },
    permissions: { contents: "read", "pull-requests": "write" },
  };
  const matrix = { os: ["ubuntu-latest", "windows-latest"] };
  const publish = {
    jobs: [{ id: "publish", steps: [{ run: "./zuke publish" }] }],
  };
  class Twin extends Build {
    lint = target().description("lint it");
    test = target().description("test it").dependsOn(this.lint);
    gateWorkflow = cicd({
      pipeline: gate,
      invokes: [this.lint, {
        target: this.test,
        after: [this.lint],
        matrix,
        env: { CI: "1" },
      }],
      pins: pin,
    });
    release = cicd({ provider: "gitlab", pipeline: publish });
  }
  const paths = [".github/workflows/gate.yml", ".gitlab-ci.yml"];
  const generated = (B: new () => Build) =>
    inTempDir(async (dir) => {
      const result = await runCli(B, ["generate-ci"]);
      assertEquals(result.code, 0, result.out + result.err);
      return await Promise.all(
        paths.map((path) => Deno.readTextFile(`${dir}/${path}`)),
      );
    });
  const { host, Remote } = await fake([
    { name: "lint", description: "lint it" },
    { name: "test", description: "test it", dependsOn: ["lint"] },
  ], {
    manifest: {
      ci: [
        {
          name: "gateWorkflow",
          pipeline: gate,
          invokes: ["lint", {
            target: "test",
            after: ["lint"],
            matrix,
            env: { CI: "1" },
          }],
          pins: Object.fromEntries(
            [
              "zuke-build/zuke",
              "step-security/harden-runner",
              "actions/checkout",
            ]
              .map((action) => [action, pin(action)]),
          ),
        },
        { name: "release", provider: "gitlab", pipeline: publish },
      ],
    },
  });
  try {
    const [workflow, pipeline] = await generated(Remote);
    assertStringIncludes(workflow, "windows-latest");
    assertStringIncludes(workflow, "./zuke test");
    assertStringIncludes(pipeline, "./zuke publish");
    assertEquals([workflow, pipeline], await generated(Twin));
  } finally {
    await host.finish(0);
  }
});

Deno.test("register writes for a worker-described build the descriptor its twin writes", async () => {
  class Twin extends Build {
    apiToken = parameter("api token").secret();
    lint = target().description("lint it");
    build = target().description("build it").dependsOn(this.lint);
  }
  const { host, Remote } = await fake([
    { name: "lint", description: "lint it" },
    { name: "build", description: "build it", dependsOn: ["lint"] },
  ], {
    manifest: {
      name: "Twin",
      parameters: [{
        name: "apiToken",
        description: "api token",
        secret: true,
      }],
    },
  });
  const registered = (B: new () => Build) =>
    inTempDir((dir) =>
      withEnv("ZUKE_REGISTRY_DIR", dir, async () => {
        const result = await runCli(B, ["register"]);
        assertEquals(result.code, 0, result.out + result.err);
        assertStringIncludes(result.out, 'Registered build "Twin"');
        const loaded = await new FileSystemBuildRegistry(dir).getBuild("Twin");
        if (loaded === null) throw new Error("not registered");
        // The timestamps and the temp cwd are the run's; the rest is the build's.
        const { createdAt: _c, updatedAt: _u, location, ...descriptor } =
          loaded.descriptor;
        assertEquals(location.kind, "module");
        return descriptor;
      })
    );
  try {
    const remote = await registered(Remote);
    assertEquals(remote.surface.targets.map((t) => t.name), ["lint", "build"]);
    assertEquals(remote.surface.parameters, []); // the secret stays out
    assertEquals(remote, await registered(Twin));
  } finally {
    await host.finish(0);
  }
});

Deno.test("an MCP server lists the twin's tools for a worker-described build, and every run it serves gets a worker", async () => {
  await withStateDir(async () => {
    class Twin extends Build {
      a = target().description("A").executes(() => {});
      b = target().description("B").dependsOn(this.a).executes(() => {});
    }
    const { Remote } = await fake([
      { name: "a", description: "A" },
      { name: "b", description: "B", dependsOn: ["a"] },
    ], { manifest: { name: "Twin" } });
    const tools = (B: new () => Build) =>
      new McpServer(new B(), { allowRun: true }).handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      });
    assertEquals(
      JSON.stringify(await tools(Remote)),
      JSON.stringify(await tools(Twin)),
    );
    // The first run's `run.exit` ends the worker; the second run is served by
    // a fresh one, described and configured again, in the same server.
    const server = new McpServer(new Remote(), { allowRun: true });
    for (const id of [1, 2]) {
      const response = await server.handleMessage({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "run:b", arguments: {} },
      });
      const result = isRecord(response) ? response.result : undefined;
      const text = JSON.stringify(result);
      assertEquals(isRecord(result) && result.isError === true, false, text);
      assertStringIncludes(text, "b succeeded");
    }
  });
});
