/**
 * Unit tests for {@link RegistryMcpServer}: live discovery from the registry,
 * spawn-based execution through an injected runner (no real subprocess), the M5
 * authz tiers keyed on the qualified `<buildId>:<target>` name, and auditing.
 */

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build } from "../src/build.ts";
import { type ByteWriter, METHOD_NOT_FOUND } from "../src/mcp/jsonrpc.ts";
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

/** A runner that records every spawn and returns a fixed result. */
function recordingRunner(
  result: RegistryRunResult = { code: 0, stdout: "ran", stderr: "" },
): { runner: RegistryRunner; calls: { argv: string[]; cwd: string }[] } {
  const calls: { argv: string[]; cwd: string }[] = [];
  const runner: RegistryRunner = (argv, cwd) => {
    calls.push({ argv: [...argv], cwd });
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
