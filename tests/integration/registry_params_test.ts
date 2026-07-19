/**
 * Integration: a build's declared parameters flow all the way from
 * `zuke register` through a real {@link FileSystemBuildRegistry} (descriptor
 * serialized to JSON and parsed back) into a {@link RegistryMcpServer}'s run
 * tool — its input schema, its validation, and the `--flag=value` arguments it
 * forwards to the spawned build. A secret parameter is proven absent end-to-end.
 * Unlike the unit tests, nothing here hand-builds a descriptor.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { registerCommand } from "../../packages/core/src/registry/register.ts";
import { FileSystemBuildRegistry } from "../../packages/core/src/registry/fs_registry.ts";
import {
  RegistryMcpServer,
  type RegistryRunner,
} from "../../packages/core/src/mcp/registry_server.ts";

/** A parameterized deploy build, including a secret that must never surface. */
class Deploy extends Build {
  repos = parameter("service repos to deploy").array();
  skipE2e = parameter("skip the e2e stage").boolean();
  sit = parameter("SIT slot");
  apiToken = parameter("deploy API token").secret();
  deploy = target().description("Deploy the repos").executes(() => {});
}

/** Run `fn` with console output suppressed (registerCommand prints a line). */
async function quietly(fn: () => Promise<void>): Promise<void> {
  const log = console.log;
  console.log = () => {};
  try {
    await fn();
  } finally {
    console.log = log;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The named tool's input schema from a `tools/list` reply. */
function inputSchema(reply: unknown, name: string): Record<string, unknown> {
  const result = isRecord(reply) ? reply.result : undefined;
  const tools = isRecord(result) && Array.isArray(result.tools)
    ? result.tools
    : [];
  for (const t of tools) {
    if (isRecord(t) && t.name === name && isRecord(t.inputSchema)) {
      return t.inputSchema;
    }
  }
  throw new Error(`no tool ${name}`);
}

/** The text + isError of a `tools/call` reply. */
function callResult(reply: unknown): { text: string; isError: boolean } {
  const result = isRecord(reply) ? reply.result : undefined;
  const content = isRecord(result) ? result.content : undefined;
  const first = Array.isArray(content) ? content[0] : undefined;
  const text = isRecord(first) && typeof first.text === "string"
    ? first.text
    : "";
  return { text, isError: isRecord(result) && result.isError === true };
}

Deno.test("a registered build's parameters flow into the registry run tool", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-registry-params-" });
  try {
    const registry = new FileSystemBuildRegistry(dir);
    await quietly(async () => {
      const code = await registerCommand(new Deploy(), {
        registry,
        location: { kind: "module", module: "file:///r/deploy.ts", cwd: "/r" },
        readEnv: () => undefined,
        now: () => "2026-01-01T00:00:00.000Z",
      });
      assertEquals(code, 0);
    });

    const calls: { argv: string[]; cwd: string }[] = [];
    const runner: RegistryRunner = (argv, cwd) => {
      calls.push({ argv: [...argv], cwd });
      return Promise.resolve({ code: 0, stdout: "ok", stderr: "" });
    };
    const server = new RegistryMcpServer(registry, { allowRun: true, runner });

    // The run tool advertises the non-secret parameters; the secret is absent.
    const schema = inputSchema(
      await server.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
      "run:Deploy:deploy",
    );
    const props = isRecord(schema.properties) ? schema.properties : {};
    assertEquals(isRecord(props.repos), true);
    assertEquals(isRecord(props.skipE2e), true);
    assertEquals(isRecord(props.sit), true);
    assertEquals("apiToken" in props, false); // secret excluded end-to-end

    // A call forwards the values to the spawn as --flag=value arguments.
    const ok = callResult(
      await server.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "run:Deploy:deploy",
          arguments: { repos: ["a", "b"], skipE2e: true },
        },
      }),
    );
    assertEquals(ok.isError, false);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].argv.includes("--repos=a,b"), true);
    assertEquals(calls[0].argv.includes("--skip-e2e=true"), true);

    // The secret cannot be passed: it is rejected as an unknown parameter and
    // no second spawn happens.
    const rejected = callResult(
      await server.handleMessage({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "run:Deploy:deploy",
          arguments: { apiToken: "s3cr3t" },
        },
      }),
    );
    assertEquals(rejected.isError, true);
    assertStringIncludes(rejected.text, "apiToken");
    assertEquals(calls.length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
