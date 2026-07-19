/**
 * Unit tests for {@link RegistryMcpServer}: live discovery from the registry,
 * spawn-based execution through an injected runner (no real subprocess), the M5
 * authz tiers keyed on the qualified `<buildId>:<target>` name, and auditing.
 */

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build } from "../src/build.ts";
import {
  type ByteWriter,
  type JsonRpcResponse,
  METHOD_NOT_FOUND,
} from "../src/mcp/jsonrpc.ts";
import { PROTOCOL_VERSION } from "../src/mcp/server.ts";
import { serveMcp } from "../src/mcp/command.ts";
import {
  defaultRegistryRunner,
  RegistryMcpServer,
  type RegistryRunner,
  type RegistryRunResult,
} from "../src/mcp/registry_server.ts";
import {
  type BuildDescriptor,
  type BuildLocation,
  toBuildSummary,
} from "../src/registry/descriptor.ts";
import type {
  BuildRegistry,
  PutBuildResult,
} from "../src/registry/registry.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import type { StateHost } from "../src/state/store.ts";

// ---- fakes ------------------------------------------------------------------

/** An in-memory {@link BuildRegistry}. */
class FakeRegistry implements BuildRegistry {
  readonly map = new Map<string, BuildDescriptor>();
  add(descriptor: BuildDescriptor): void {
    this.map.set(descriptor.id, descriptor);
  }
  getBuild(id: string) {
    const descriptor = this.map.get(id);
    return Promise.resolve(
      descriptor ? { descriptor, version: "v1" } : null,
    );
  }
  register(descriptor: BuildDescriptor): Promise<PutBuildResult> {
    this.map.set(descriptor.id, descriptor);
    return Promise.resolve({ ok: true, version: "v1" });
  }
  deregister(id: string): Promise<void> {
    this.map.delete(id);
    return Promise.resolve();
  }
  listBuilds() {
    return Promise.resolve([...this.map.values()].map(toBuildSummary));
  }
}

/** An in-memory {@link StateHost} for a real FileSystemStateStore (audit trail). */
class FakeStateHost implements StateHost {
  readonly files = new Map<string, string>();
  readonly locks = new Set<string>();
  readText(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }
  writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }
  rename(from: string, to: string): Promise<void> {
    const content = this.files.get(from);
    if (content !== undefined) {
      this.files.set(to, content);
      this.files.delete(from);
    }
    return Promise.resolve();
  }
  createExclusive(path: string): Promise<boolean> {
    if (this.locks.has(path)) return Promise.resolve(false);
    this.locks.add(path);
    return Promise.resolve(true);
  }
  remove(path: string): Promise<void> {
    this.files.delete(path);
    this.locks.delete(path);
    return Promise.resolve();
  }
  listDir(): Promise<string[]> {
    return Promise.resolve([]);
  }
  mkdirp(): Promise<void> {
    return Promise.resolve();
  }
  now(): number {
    return 1_000_000;
  }
}

/** A descriptor with the given id, target names, and (optional) launch location. */
function descriptor(
  id: string,
  targets: string[],
  location?: BuildLocation,
): BuildDescriptor {
  return {
    id,
    name: id,
    location: location ??
      { kind: "module", module: `file:///r/${id}.ts`, cwd: "/r" },
    surface: {
      commands: [],
      flags: [],
      targets: targets.map((name) => ({
        name,
        description: "",
        dependsOn: [],
        default: false,
        unlisted: false,
      })),
      parameters: [],
    },
    actor: "me",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** A runner that records every spawn (argv, cwd, actor) and returns a fixed result. */
function recordingRunner(
  result: RegistryRunResult = { code: 0, stdout: "ran", stderr: "" },
): {
  runner: RegistryRunner;
  calls: { argv: string[]; cwd: string; actor?: string }[];
} {
  const calls: { argv: string[]; cwd: string; actor?: string }[] = [];
  const runner: RegistryRunner = (argv, cwd, options) => {
    calls.push({ argv: [...argv], cwd, actor: options?.actor });
    return Promise.resolve(result);
  };
  return { runner, calls };
}

/** A build whose `registry()` returns a fixed registry (for the serveMcp path). */
class RegistryBuild extends Build {
  constructor(private readonly reg: BuildRegistry) {
    super();
  }
  override registry(): BuildRegistry {
    return this.reg;
  }
}

/** A ReadableStream that emits the given string chunks, then closes. */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
      controller.close();
    },
  });
}

/** A ByteWriter that records everything written. */
function capturingWriter(): { output: ByteWriter; text(): string } {
  const parts: string[] = [];
  const dec = new TextDecoder();
  return {
    output: {
      write(p) {
        parts.push(dec.decode(p));
        return Promise.resolve(p.length);
      },
    },
    text: () => parts.join(""),
  };
}

// ---- response helpers (no casts) -------------------------------------------

function isRec(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function req(method: string, params?: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) };
}
function resultOf(res: unknown): Record<string, unknown> {
  if (isRec(res) && isRec(res.result)) return res.result;
  throw new Error(`expected a result: ${JSON.stringify(res)}`);
}
function toolNames(res: unknown): string[] {
  const tools = resultOf(res).tools;
  if (!Array.isArray(tools)) throw new Error("no tools array");
  return tools.map((
    t,
  ) => (isRec(t) && typeof t.name === "string" ? t.name : ""));
}
function callText(res: unknown): { text: string; isError: boolean } {
  const result = resultOf(res);
  const content = result.content;
  if (
    !Array.isArray(content) || !isRec(content[0]) ||
    typeof content[0].text !== "string"
  ) {
    throw new Error("not a tool result");
  }
  return { text: content[0].text, isError: result.isError === true };
}

/** Call a tool and return its text block. */
async function call(
  server: RegistryMcpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; isError: boolean }> {
  const res = await server.handleMessage(
    req("tools/call", { name, arguments: args }),
  );
  return callText(res);
}

// ---- tests ------------------------------------------------------------------

Deno.test("initialize negotiates the version; ping is empty", async () => {
  const server = new RegistryMcpServer(new FakeRegistry());
  const res = await server.handleMessage(
    req("initialize", { protocolVersion: "2024-11-05" }),
  );
  assertEquals(resultOf(res).protocolVersion, "2024-11-05");
  const res2 = await server.handleMessage(req("initialize", {}));
  assertEquals(resultOf(res2).protocolVersion, PROTOCOL_VERSION);
  assertEquals((await server.handleMessage(req("ping")))?.result, {});
});

Deno.test("tools/list is read-only until running is allowed, and re-reads live", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));

  const readOnly = new RegistryMcpServer(registry);
  assertEquals(toolNames(await readOnly.handleMessage(req("tools/list"))), [
    "list_builds",
    "describe_build",
  ]);

  const server = new RegistryMcpServer(registry, { allowRun: true });
  assertEquals(
    toolNames(await server.handleMessage(req("tools/list"))).includes(
      "run:Api:deploy",
    ),
    true,
  );

  // A build registered later appears without reconstructing the server.
  registry.add(descriptor("Web", ["build", "release"]));
  const names = toolNames(await server.handleMessage(req("tools/list")));
  assertEquals(names.includes("run:Web:build"), true);
  assertEquals(names.includes("run:Web:release"), true);
});

Deno.test("describe_build returns a surface or a friendly miss", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const server = new RegistryMcpServer(registry);

  const ok = await call(server, "describe_build", { build: "Api" });
  assertEquals(ok.isError, false);
  assertStringIncludes(ok.text, "deploy");

  assertEquals(
    (await call(server, "describe_build", { build: "Nope" })).isError,
    true,
  );
  assertEquals((await call(server, "describe_build", {})).isError, true);
});

Deno.test("list_builds returns the catalog", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const server = new RegistryMcpServer(registry);
  const { text } = await call(server, "list_builds");
  assertStringIncludes(text, "Api");
});

Deno.test("a run tool is disabled without --allow-run", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, { runner });
  const result = await call(server, "run:Api:deploy");
  assertEquals(result.isError, true);
  assertStringIncludes(result.text, "disabled");
  assertEquals(calls.length, 0);
});

Deno.test("a run tool spawns the descriptor's module location", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const { runner, calls } = recordingRunner({
    code: 0,
    stdout: "DEPLOYED",
    stderr: "",
  });
  const server = new RegistryMcpServer(registry, { allowRun: true, runner });

  const result = await call(server, "run:Api:deploy");
  assertEquals(result.isError, false);
  assertStringIncludes(result.text, "DEPLOYED");
  assertStringIncludes(result.text, "succeeded");
  assertEquals(calls.length, 1);
  // deno run -A <module> deploy
  assertEquals(calls[0].argv.slice(1), [
    "run",
    "-A",
    "file:///r/Api.ts",
    "deploy",
  ]);
});

Deno.test("a non-zero exit is reported as an error", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const { runner } = recordingRunner({
    code: 2,
    stdout: "boom",
    stderr: "bad",
  });
  const server = new RegistryMcpServer(registry, { allowRun: true, runner });
  const result = await call(server, "run:Api:deploy");
  assertEquals(result.isError, true);
  assertStringIncludes(result.text, "exited 2");
});

Deno.test("dryRun appends --dry-run to the spawn argv", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, { allowRun: true, runner });
  await call(server, "run:Api:deploy", { dryRun: true });
  assertEquals(calls[0].argv.includes("--dry-run"), true);
});

Deno.test("the allow-list glob restricts by qualified name", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy", "check"]));
  registry.add(descriptor("Web", ["deploy"]));
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    allowRunPatterns: ["Api:*"],
    runner,
  });
  const names = toolNames(await server.handleMessage(req("tools/list")));
  assertEquals(names.includes("run:Api:deploy"), true);
  assertEquals(names.includes("run:Web:deploy"), false);

  // A call to a non-allow-listed build is indistinguishable from unknown.
  const denied = await call(server, "run:Web:deploy");
  assertEquals(denied.isError, true);
  assertStringIncludes(denied.text, "Unknown tool");
  assertEquals(calls.length, 0);
});

Deno.test("a protected target requires a valid operator token", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    protectPatterns: ["Api:deploy"],
    operatorToken: "good-token",
    runner,
  });
  // Missing token → denied, no spawn.
  assertStringIncludes(
    (await call(server, "run:Api:deploy")).text,
    "missing_operator_token",
  );
  // Wrong token → denied.
  assertStringIncludes(
    (await call(server, "run:Api:deploy", { operatorToken: "nope" })).text,
    "invalid_operator_token",
  );
  assertEquals(calls.length, 0);
  // Right token → runs.
  const okd = await call(server, "run:Api:deploy", {
    operatorToken: "good-token",
  });
  assertEquals(okd.isError, false);
  assertEquals(calls.length, 1);
});

Deno.test("a protected target with no server token is fail-closed", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    protectPatterns: ["Api:deploy"],
    runner: recordingRunner().runner,
  });
  assertStringIncludes(
    (await call(server, "run:Api:deploy", { operatorToken: "x" })).text,
    "operator_token_unconfigured",
  );
});

Deno.test("--confirm-destructive returns a confirmation unless confirmed", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    confirmDestructive: true,
    runner,
  });
  const gated = await call(server, "run:Api:deploy");
  assertStringIncludes(gated.text, "confirmation_required");
  assertEquals(calls.length, 0);
  // A dry run is NOT exempt: a spawn can't enforce dry-run, so it still gates.
  const gatedDry = await call(server, "run:Api:deploy", { dryRun: true });
  assertStringIncludes(gatedDry.text, "confirmation_required");
  assertEquals(calls.length, 0);
  // confirm:true runs it.
  await call(server, "run:Api:deploy", { confirm: true });
  assertEquals(calls.length, 1);
});

Deno.test("an unknown build/target run is a plain unknown tool", async () => {
  const registry = new FakeRegistry();
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    runner: recordingRunner().runner,
  });
  assertStringIncludes(
    (await call(server, "run:Ghost:deploy")).text,
    "Unknown tool",
  );
  // A name with no colon is also unknown, not a crash.
  assertStringIncludes((await call(server, "run:bare")).text, "Unknown tool");
});

Deno.test("a command location spawns the command; an empty one errors", async () => {
  const registry = new FakeRegistry();
  registry.add(
    descriptor("Api", ["deploy"], {
      kind: "command",
      command: ["make", "deploy-it"],
      cwd: "/w",
    }),
  );
  registry.add(
    descriptor("Broke", ["deploy"], {
      kind: "command",
      command: [],
      cwd: "/w",
    }),
  );
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, { allowRun: true, runner });

  await call(server, "run:Api:deploy");
  assertEquals(calls[0].argv, ["make", "deploy-it", "deploy"]);
  assertEquals(calls[0].cwd, "/w");

  const broke = await call(server, "run:Broke:deploy");
  assertEquals(broke.isError, true);
  assertStringIncludes(broke.text, "no runnable launch command");
});

Deno.test("a runner that throws is caught, not crashed", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const runner: RegistryRunner = () => Promise.reject(new Error("no exec"));
  const server = new RegistryMcpServer(registry, { allowRun: true, runner });
  const result = await call(server, "run:Api:deploy");
  assertEquals(result.isError, true);
  assertStringIncludes(result.text, "Failed to spawn");
});

Deno.test("unknown methods and malformed calls are handled", async () => {
  const server = new RegistryMcpServer(new FakeRegistry());
  const unknown = await server.handleMessage(req("does/not/exist"));
  assertEquals(
    isRec(unknown) && isRec(unknown.error) ? unknown.error.code : 0,
    METHOD_NOT_FOUND,
  );
  const noName = await server.handleMessage(
    req("tools/call", { arguments: {} }),
  );
  assertEquals(isRec(noName) && "error" in noName, true);
  // A message with no method is an invalid request (an error response).
  const invalid = await server.handleMessage({ jsonrpc: "2.0", id: 5 });
  assertEquals(isRec(invalid) && "error" in invalid, true);
  // A notification (no id) is silently accepted with no reply.
  assertEquals(
    await server.handleMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    null,
  );
});

Deno.test("mutating and denied calls are written to the audit log", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const store = new FileSystemStateStore("/state", new FakeStateHost());
  const { runner } = recordingRunner();
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    stateStore: store,
    runner,
  });
  await call(server, "run:Api:deploy"); // ok
  await call(server, "run:Ghost:deploy"); // denied

  const audit = await store.getRun("mcp-audit");
  const events = audit?.record.events ?? [];
  assertEquals(
    events.some((e) => e.tool === "run:Api:deploy" && e.outcome === "ok"),
    true,
  );
  assertEquals(
    events.some((e) => e.tool === "run:Ghost:deploy" && e.outcome === "denied"),
    true,
  );
  // The operator token never reaches the trail.
  assertEquals(events.every((e) => !("operatorToken" in e.args)), true);
});

/** Find one tool definition by name from a `tools/list` reply. */
function toolDef(res: unknown, name: string): Record<string, unknown> {
  const tools = resultOf(res).tools;
  if (!Array.isArray(tools)) throw new Error("no tools array");
  const found = tools.find((t) => isRec(t) && t.name === name);
  if (!isRec(found)) throw new Error(`no tool ${name}`);
  return found;
}

Deno.test("a protected/confirmable target advertises its extra inputs", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    protectPatterns: ["Api:deploy"],
    confirmDestructive: true,
  });
  const tool = toolDef(
    await server.handleMessage(req("tools/list")),
    "run:Api:deploy",
  );
  const schema = isRec(tool.inputSchema) ? tool.inputSchema : {};
  const properties = isRec(schema.properties) ? schema.properties : {};
  assertEquals("operatorToken" in properties, true);
  assertEquals("confirm" in properties, true);
  assertEquals(
    Array.isArray(schema.required) && schema.required.includes("operatorToken"),
    true,
  );
});

Deno.test("a build deregistered between list and read is skipped, not crashed", async () => {
  // listBuilds names a build that getBuild can no longer load.
  class GhostRegistry extends FakeRegistry {
    override getBuild() {
      return Promise.resolve(null);
    }
  }
  const registry = new GhostRegistry();
  registry.add(descriptor("Ghost", ["x"]));
  const server = new RegistryMcpServer(registry, { allowRun: true });
  assertEquals(toolNames(await server.handleMessage(req("tools/list"))), [
    "list_builds",
    "describe_build",
  ]);
});

Deno.test("a registry error during a call is a JSON-RPC error, not a crash", async () => {
  class BrokenRegistry extends FakeRegistry {
    override getBuild(): Promise<never> {
      return Promise.reject(new Error("store down"));
    }
  }
  const server = new RegistryMcpServer(new BrokenRegistry(), {
    allowRun: true,
  });
  const res = await server.handleMessage(
    req("tools/call", { name: "run:Api:deploy", arguments: {} }),
  );
  assertEquals(
    isRec(res) && isRec(res.error) ? typeof res.error.code : "none",
    "number",
  );
});

Deno.test("serveMcp --registry resolves the registry and serves the catalog", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const { output, text } = capturingWriter();
  const banner: string[] = [];
  const origErr = console.error;
  console.error = (...a: unknown[]) => void banner.push(a.join(" "));
  try {
    const code = await serveMcp(new RegistryBuild(registry), {
      useRegistry: true,
      allowRun: true,
      runner: recordingRunner().runner,
      input: streamOf('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n'),
      output,
    });
    assertEquals(code, 0);
  } finally {
    console.error = origErr;
  }
  assertStringIncludes(banner.join("\n"), "registry");
  assertStringIncludes(text(), "run:Api:deploy");
});

Deno.test("a throwing registry on tools/list is a JSON-RPC error, not a crash", async () => {
  class BrokenListRegistry extends FakeRegistry {
    override listBuilds(): Promise<never> {
      return Promise.reject(new Error("registry down"));
    }
  }
  const server = new RegistryMcpServer(new BrokenListRegistry(), {
    allowRun: true,
  });
  const res = await server.handleMessage(req("tools/list"));
  // An error response, not a rejected promise that would kill the transport.
  assertEquals(
    isRec(res) && isRec(res.error) ? typeof res.error.code : "none",
    "number",
  );
  // The server keeps answering afterwards.
  assertEquals((await server.handleMessage(req("ping")))?.result, {});
});

Deno.test("defaultRegistryRunner spawns a real process and captures its output", async () => {
  const result = await defaultRegistryRunner(
    [Deno.execPath(), "eval", "console.log('spawned-ok')"],
    Deno.cwd(),
  );
  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "spawned-ok");
});

Deno.test("defaultRegistryRunner strips server secrets from the spawned env", async () => {
  const prev = Deno.env.get("ZUKE_OPERATOR_TOKEN");
  Deno.env.set("ZUKE_OPERATOR_TOKEN", "server-secret");
  try {
    const result = await defaultRegistryRunner(
      [
        Deno.execPath(),
        "eval",
        "console.log(Deno.env.get('ZUKE_OPERATOR_TOKEN') ?? 'STRIPPED', " +
        "Deno.env.get('PATH') ? 'HAS_PATH' : 'NO_PATH')",
      ],
      Deno.cwd(),
    );
    assertEquals(result.code, 0);
    // The operator token is gone, but the rest of the environment is intact.
    assertStringIncludes(result.stdout, "STRIPPED");
    assertStringIncludes(result.stdout, "HAS_PATH");
  } finally {
    if (prev === undefined) Deno.env.delete("ZUKE_OPERATOR_TOKEN");
    else Deno.env.set("ZUKE_OPERATOR_TOKEN", prev);
  }
});

// ---- M12: build parameters --------------------------------------------------

/** A descriptor for build "Deploy" whose "deploy" target declares parameters. */
function paramDescriptor(): BuildDescriptor {
  const base = descriptor("Deploy", ["deploy"]);
  return {
    ...base,
    surface: {
      ...base.surface,
      parameters: [
        {
          name: "repos",
          flag: "repos",
          description: "service repos to deploy",
          required: true,
          kind: "string",
          boolean: false,
          array: true,
          options: [],
        },
        {
          name: "sit",
          flag: "sit",
          description: "SIT slot",
          required: false,
          kind: "string",
          boolean: false,
          array: false,
          options: [],
        },
        {
          name: "skipE2e",
          flag: "skip-e2e",
          description: "skip the e2e stage",
          required: false,
          kind: "boolean",
          boolean: true,
          array: false,
          options: [],
          default: "false",
        },
        {
          name: "workers",
          flag: "workers",
          description: "worker count",
          required: false,
          kind: "number",
          boolean: false,
          array: false,
          options: [],
        },
        {
          name: "env",
          flag: "env",
          description: "environment",
          required: false,
          kind: "string",
          boolean: false,
          array: false,
          options: ["dev", "prod"],
        },
      ],
    },
  };
}

/** The `properties` map of an input schema, or `{}` when absent. */
function schemaProps(schema: Record<string, unknown>): Record<string, unknown> {
  return isRec(schema.properties) ? schema.properties : {};
}

/** The `run:<name>` tool's input schema from a `tools/list` response. */
function runToolSchema(res: unknown, name: string): Record<string, unknown> {
  const tools = resultOf(res).tools;
  if (!Array.isArray(tools)) throw new Error("no tools array");
  for (const t of tools) {
    if (isRec(t) && t.name === name && isRec(t.inputSchema)) {
      return t.inputSchema;
    }
  }
  throw new Error(`no tool ${name}`);
}

Deno.test("a run tool's inputSchema exposes the build's parameters", async () => {
  const registry = new FakeRegistry();
  registry.add(paramDescriptor());
  const server = new RegistryMcpServer(registry, { allowRun: true });
  const schema = runToolSchema(
    await server.handleMessage(req("tools/list")),
    "run:Deploy:deploy",
  );
  const props = schemaProps(schema);
  // repos: an array of strings, described, and required.
  assertEquals(props.repos, {
    type: "array",
    items: { type: "string" },
    description: "service repos to deploy",
  });
  assertEquals(
    Array.isArray(schema.required) && schema.required.includes("repos"),
    true,
  );
  // sit: an optional string.
  assertEquals(props.sit, { type: "string", description: "SIT slot" });
  // skipE2e: a boolean carrying its declared default.
  assertEquals(props.skipE2e, {
    type: "boolean",
    description: "skip the e2e stage",
    default: false,
  });
  // env: a constrained string (enum).
  assertEquals(props.env, {
    type: "string",
    description: "environment",
    enum: ["dev", "prod"],
  });
  // The reserved control key coexists with the parameters.
  assertEquals(isRec(props.dryRun), true);
});

Deno.test("a run tool forwards validated parameters as --flag=value", async () => {
  const registry = new FakeRegistry();
  registry.add(paramDescriptor());
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, { allowRun: true, runner });
  const result = await call(server, "run:Deploy:deploy", {
    repos: ["expense-service", "web"],
    skipE2e: true,
    workers: 4,
  });
  assertEquals(result.isError, false);
  assertEquals(calls.length, 1);
  const argv = calls[0].argv;
  assertEquals(argv.includes("--repos=expense-service,web"), true);
  assertEquals(argv.includes("--skip-e2e=true"), true);
  assertEquals(argv.includes("--workers=4"), true);
  // The target name still leads the trailing args.
  assertEquals(argv.includes("deploy"), true);
});

Deno.test("a boolean parameter forwards its false value explicitly", async () => {
  const registry = new FakeRegistry();
  registry.add(paramDescriptor());
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, { allowRun: true, runner });
  await call(server, "run:Deploy:deploy", { repos: ["a"], skipE2e: false });
  assertEquals(calls[0].argv.includes("--skip-e2e=false"), true);
});

Deno.test("a type-mismatched array parameter is rejected before any spawn", async () => {
  const registry = new FakeRegistry();
  registry.add(paramDescriptor());
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, { allowRun: true, runner });
  // A bare string where an array is required.
  const result = await call(server, "run:Deploy:deploy", {
    repos: "expense-service",
  });
  assertEquals(result.isError, true);
  assertStringIncludes(result.text, "repos");
  assertEquals(calls.length, 0); // never spawned
});

Deno.test("a non-numeric number and an out-of-set enum are rejected", async () => {
  const registry = new FakeRegistry();
  registry.add(paramDescriptor());
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, { allowRun: true, runner });
  const badNumber = await call(server, "run:Deploy:deploy", {
    repos: ["a"],
    workers: "four",
  });
  assertEquals(badNumber.isError, true);
  assertStringIncludes(badNumber.text, "workers");
  const badEnum = await call(server, "run:Deploy:deploy", {
    repos: ["a"],
    env: "staging",
  });
  assertEquals(badEnum.isError, true);
  assertStringIncludes(badEnum.text, "env");
  assertEquals(calls.length, 0);
});

Deno.test("an unknown parameter is rejected naming it", async () => {
  const registry = new FakeRegistry();
  registry.add(paramDescriptor());
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, { allowRun: true, runner });
  const result = await call(server, "run:Deploy:deploy", {
    repos: ["a"],
    nope: "x",
  });
  assertEquals(result.isError, true);
  assertStringIncludes(result.text, "nope");
  assertStringIncludes(result.text, "unknown");
  assertEquals(calls.length, 0);
});

Deno.test("parameters coexist with the operator token and confirmation", async () => {
  const registry = new FakeRegistry();
  registry.add(paramDescriptor());
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    runner,
    confirmDestructive: true,
    protectPatterns: ["Deploy:*"],
    operatorToken: "good-token",
  });
  const result = await call(server, "run:Deploy:deploy", {
    repos: ["a"],
    confirm: true,
    operatorToken: "good-token",
  });
  assertEquals(result.isError, false);
  assertEquals(calls.length, 1);
  const argv = calls[0].argv;
  // The build parameter is forwarded; the control keys never are.
  assertEquals(argv.includes("--repos=a"), true);
  assertEquals(argv.some((a) => a.includes("operator")), false);
  assertEquals(argv.some((a) => a.includes("confirm")), false);
});

// ---- M12 adversarial-review regressions -------------------------------------

Deno.test("a value supplied under an unknown/secret key is elided from the audit log", async () => {
  const registry = new FakeRegistry();
  registry.add(paramDescriptor());
  const store = new FileSystemStateStore("/state", new FakeStateHost());
  const { runner } = recordingRunner();
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    stateStore: store,
    runner,
  });
  // `apiToken` is not a declared parameter (a secret would be absent from the
  // descriptor); a mistaken value under it must not land verbatim in the trail.
  await call(server, "run:Deploy:deploy", {
    repos: ["expense-service"],
    apiToken: "sk-live-SECRET",
  });

  const audit = await store.getRun("mcp-audit");
  const events = audit?.record.events ?? [];
  const serialized = JSON.stringify(events);
  // The secret value never appears; the unknown key is recorded but elided.
  assertEquals(serialized.includes("sk-live-SECRET"), false);
  assertEquals(serialized.includes("<omitted>"), true);
  // A declared parameter's value is still recorded (the point of the trail).
  assertEquals(serialized.includes("expense-service"), true);
});

Deno.test("a malformed default/enum from an untrusted descriptor is dropped from the schema", async () => {
  const registry = new FakeRegistry();
  const base = descriptor("Api", ["deploy"]);
  registry.add({
    ...base,
    surface: {
      ...base.surface,
      parameters: [
        // A number parameter carrying a non-numeric default and a (string) enum
        // — both invalid for the declared kind, as only an untrusted registry
        // could produce.
        {
          name: "workers",
          flag: "workers",
          description: "",
          required: false,
          kind: "number",
          boolean: false,
          array: false,
          options: ["1", "2"],
          default: "abc",
        },
      ],
    },
  });
  const server = new RegistryMcpServer(registry, { allowRun: true });
  const schema = runToolSchema(
    await server.handleMessage(req("tools/list")),
    "run:Api:deploy",
  );
  const workers = schemaProps(schema).workers;
  // The schema is well-formed: a number type with neither a string enum nor a
  // non-numeric default.
  assertEquals(workers, { type: "number" });
});

// ---- M13: trusted per-call identity ----------------------------------------

/** Send a tools/call with the given request headers. */
function callWith(
  server: RegistryMcpServer,
  name: string,
  headers: Record<string, string>,
  args: Record<string, unknown> = {},
): Promise<JsonRpcResponse | null> {
  return server.handleMessage(
    req("tools/call", { name, arguments: args }),
    { headers: new Headers(headers) },
  );
}

Deno.test("an identity hook attributes the call to the trusted actor, not the label", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const store = new FileSystemStateStore("/state", new FakeStateHost());
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    runner,
    stateStore: store,
    actor: "config-actor", // even an explicit --actor is overridden by the hook
    identity: (ctx) => {
      const sub = ctx.headers.get("x-user");
      if (sub === null) throw new Error("no identity from proxy");
      return { actor: sub, via: "oauth-proxy" };
    },
  });

  // The client self-reports a name; the hook must win over it.
  await server.handleMessage(
    req("initialize", { clientInfo: { name: "spoofed-client" } }),
    { headers: new Headers({ "x-user": "engineer-a" }) },
  );
  const res = await callWith(server, "run:Api:deploy", {
    "x-user": "engineer-a",
  });
  assertEquals(res?.result !== undefined, true);

  // The audit trail and the spawned child both name the trusted actor.
  const events = (await store.getRun("mcp-audit"))?.record.events ?? [];
  assertEquals(events.length > 0, true);
  assertEquals(events.every((e) => e.actor === "engineer-a"), true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].actor, "engineer-a");
});

Deno.test("a throwing identity hook rejects the request and writes nothing", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const store = new FileSystemStateStore("/state", new FakeStateHost());
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    runner,
    stateStore: store,
    identity: (ctx) => {
      const sub = ctx.headers.get("x-user");
      if (sub === null) throw new Error("no identity from proxy");
      return { actor: sub };
    },
  });

  // No `x-user` header → the hook throws → a JSON-RPC auth error, no dispatch.
  const res = await callWith(server, "run:Api:deploy", {});
  assertEquals(res?.result, undefined);
  assertEquals(res?.error?.message, "Unauthorized");
  // Nothing executed and nothing was written to the audit trail.
  assertEquals(calls.length, 0);
  assertEquals(await store.getRun("mcp-audit"), null);
});

Deno.test("without an identity hook, attribution is unchanged (stdio/local)", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const store = new FileSystemStateStore("/state", new FakeStateHost());
  const { runner } = recordingRunner();
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    runner,
    stateStore: store,
    actor: "ci-bot",
  });
  await call(server, "run:Api:deploy");
  const events = (await store.getRun("mcp-audit"))?.record.events ?? [];
  assertEquals(events.every((e) => e.actor === "ci-bot"), true);
});

Deno.test("a hook yielding an empty actor is rejected, never a spawn", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const store = new FileSystemStateStore("/state", new FakeStateHost());
  const { runner, calls } = recordingRunner();
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    runner,
    stateStore: store,
    actor: "ci-bot", // the static fallback that must NOT be used
    // `headers.get(...) ?? ""` yields `{ actor: "" }` on a missing header.
    identity: (ctx) => ({ actor: ctx.headers.get("x-user") ?? "" }),
  });
  const res = await callWith(server, "run:Api:deploy", {});
  assertEquals(res?.error?.message, "Unauthorized");
  // No spawn (so no child ZUKE_ACTOR), and nothing audited.
  assertEquals(calls.length, 0);
  assertEquals(await store.getRun("mcp-audit"), null);
});

// ---- M14: concurrent registry serving + run cap ----------------------------

/** A runner whose spawns block until released, exposing the in-flight count. */
function gatedRunner(): {
  runner: RegistryRunner;
  active: () => number;
  release: () => void;
} {
  let active = 0;
  let open = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const runner: RegistryRunner = async () => {
    active++;
    try {
      await gate;
    } finally {
      active--;
    }
    return { code: 0, stdout: "ok", stderr: "" };
  };
  return { runner, active: () => active, release: () => open() };
}

/** Wait until `predicate` holds (bounded), so we observe in-flight spawns. */
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !predicate(); i++) {
    await new Promise((r) => setTimeout(r, 1));
  }
}

Deno.test("the concurrency cap refuses a spawn past the limit, immediately", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const { runner, active, release } = gatedRunner();
  const server = new RegistryMcpServer(registry, {
    allowRun: true,
    runner,
    maxConcurrentRuns: 2,
  });

  // Two runs start and block in the runner — both in flight.
  const r1 = server.handleMessage(
    req("tools/call", { name: "run:Api:deploy" }),
  );
  const r2 = server.handleMessage(
    req("tools/call", { name: "run:Api:deploy" }),
  );
  await until(() => active() === 2);

  // A third is refused at once with the structured busy error (not queued).
  const third = callText(
    await server.handleMessage(req("tools/call", { name: "run:Api:deploy" })),
  );
  assertEquals(third.isError, true);
  const body = JSON.parse(third.text);
  assertEquals(body.error, "at_capacity");
  assertEquals(body.cap, 2);
  assertEquals(body.running, 2);

  // A read tool is never counted or blocked, even at capacity.
  const list = await call(server, "list_builds");
  assertEquals(list.isError, false);
  assertStringIncludes(list.text, "Api");

  // Releasing the two lets them finish and frees the slots.
  release();
  await Promise.all([r1, r2]);
  assertEquals(active(), 0);
  // A run tool works again once below the cap.
  assertEquals((await call(server, "run:Api:deploy")).isError, false);
});

Deno.test("registry HTTP serving does not head-of-line-block a read behind a run", async () => {
  const registry = new FakeRegistry();
  registry.add(descriptor("Api", ["deploy"]));
  const { runner, active, release } = gatedRunner();
  const ac = new AbortController();
  let setPort = (_: number) => {};
  const portReady = new Promise<number>((r) => (setPort = r));
  const finished = serveMcp(new RegistryBuild(registry), {
    useRegistry: true,
    allowRun: true,
    runner,
    http: { host: "127.0.0.1", port: 0 },
    quiet: true,
    signal: ac.signal,
    onListen: (a) => setPort(a.port),
  });
  const url = `http://127.0.0.1:${await portReady}/`;
  const post = (body: unknown) =>
    fetch(url, { method: "POST", body: JSON.stringify(body) });
  try {
    // Start a run that blocks in the runner; do not await it.
    const running = post({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "run:Api:deploy", arguments: {} },
    });
    await until(() => active() === 1);

    // A read returns while the run is still blocked — proving no serialization.
    const list = await post({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_builds", arguments: {} },
    });
    assertEquals(list.status, 200);
    assertStringIncludes(JSON.stringify(await list.json()), "Api");
    assertEquals(active(), 1); // the run is still in flight, untouched

    // Release the run and drain it.
    release();
    const ran = await running;
    await ran.json();
  } finally {
    ac.abort();
    await finished;
  }
});
