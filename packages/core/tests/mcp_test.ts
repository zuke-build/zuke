import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build, parameter, target } from "../mod.ts";
import {
  type ByteWriter,
  METHOD_NOT_FOUND,
  serveStdio,
} from "../src/mcp/jsonrpc.ts";
import { McpServer, PROTOCOL_VERSION } from "../src/mcp/server.ts";
import { serveMcp } from "../src/mcp/command.ts";

/** A small build with parameters and a dependency edge, for the server tests. */
class Demo extends Build {
  environment = parameter("Target environment").options("dev", "prod")
    .required();
  workers = parameter("Upload workers").number().default(2);
  lint = target().description("Lint the code").executes(() => {});
  build = target().description("Build the app").dependsOn(this.lint).executes(
    () => {},
  );
}

/** A JSON-RPC request object for `method` with `id` 1. */
function req(method: string, params?: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) };
}

/** Read the single text block out of a `tools/call` result. */
function callText(result: unknown): { text: string; isError: boolean } {
  if (
    typeof result !== "object" || result === null || !("content" in result)
  ) throw new Error("not a tool result");
  const content = (result as { content: Array<{ text: string }> }).content;
  const isError = (result as { isError?: boolean }).isError ?? false;
  return { text: content[0].text, isError };
}

Deno.test("initialize echoes the client's protocol version and names the server", async () => {
  const server = new McpServer(new Demo());
  const res = await server.handleMessage(
    req("initialize", { protocolVersion: "2024-11-05" }),
  );
  const result = res?.result as Record<string, unknown>;
  assertEquals(result.protocolVersion, "2024-11-05");
  assertEquals((result.serverInfo as { name: string }).name, "zuke");
  // With no version supplied, it falls back to the server's newest.
  const res2 = await server.handleMessage(req("initialize", {}));
  assertEquals(
    (res2?.result as Record<string, unknown>).protocolVersion,
    PROTOCOL_VERSION,
  );
});

Deno.test("ping returns an empty result", async () => {
  const server = new McpServer(new Demo());
  const res = await server.handleMessage(req("ping"));
  assertEquals(res?.result, {});
});

Deno.test("tools/list is read-only until running is allowed", async () => {
  const readOnly = new McpServer(new Demo());
  const res = await readOnly.handleMessage(req("tools/list"));
  const tools = (res?.result as { tools: Array<{ name: string }> }).tools;
  assertEquals(tools.map((t) => t.name), [
    "list_targets",
    "describe_build",
    "graph",
  ]);

  const withRun = new McpServer(new Demo(), { allowRun: true });
  const res2 = await withRun.handleMessage(req("tools/list"));
  const names = (res2?.result as { tools: Array<{ name: string }> }).tools.map((
    t,
  ) => t.name);
  assertEquals(names.includes("run:lint"), true);
  assertEquals(names.includes("run:build"), true);
});

Deno.test("a run tool's schema is built from the build's parameters", async () => {
  const server = new McpServer(new Demo(), { allowRun: true });
  const res = await server.handleMessage(req("tools/list"));
  const tools = (res?.result as {
    tools: Array<
      {
        name: string;
        inputSchema: {
          properties: Record<string, unknown>;
          required?: string[];
        };
        annotations?: { destructiveHint?: boolean };
      }
    >;
  }).tools;
  const run = tools.find((t) => t.name === "run:build");
  if (!run) throw new Error("missing run:build");
  // Declared parameters become typed properties; the required one is required.
  assertEquals(run.inputSchema.required, ["environment"]);
  assertEquals("workers" in run.inputSchema.properties, true);
  assertEquals("dryRun" in run.inputSchema.properties, true);
  assertEquals(run.annotations?.destructiveHint, true);
});

Deno.test("the read tools report the build's shape", async () => {
  const server = new McpServer(new Demo());
  const targets = callText(
    (await server.handleMessage(
      req("tools/call", { name: "list_targets" }),
    ))?.result,
  );
  assertStringIncludes(targets.text, "lint");
  assertEquals(targets.isError, false);

  const describe = callText(
    (await server.handleMessage(
      req("tools/call", { name: "describe_build" }),
    ))?.result,
  );
  assertStringIncludes(describe.text, "parameters");

  const graph = callText(
    (await server.handleMessage(req("tools/call", { name: "graph" })))?.result,
  );
  assertStringIncludes(graph.text, "build -> lint");
});

Deno.test("running is refused until --allow-run", async () => {
  const server = new McpServer(new Demo()); // allowRun defaults to false
  const res = await server.handleMessage(
    req("tools/call", { name: "run:build", arguments: { environment: "dev" } }),
  );
  const out = callText(res?.result);
  assertEquals(out.isError, true);
  assertStringIncludes(out.text, "--allow-run");
});

Deno.test("running a target executes it and returns the captured output", async () => {
  const server = new McpServer(new Demo(), { allowRun: true });
  const res = await server.handleMessage(
    req("tools/call", { name: "run:build", arguments: { environment: "dev" } }),
  );
  const out = callText(res?.result);
  assertEquals(out.isError, false);
  assertStringIncludes(out.text, "build");
  assertStringIncludes(out.text, "succeeded");
});

Deno.test("a run missing a required parameter fails through the result", async () => {
  const server = new McpServer(new Demo(), { allowRun: true });
  // environment is required and unset in the (hermetic) environment.
  const res = await server.handleMessage(
    req("tools/call", { name: "run:build", arguments: {} }),
  );
  const out = callText(res?.result);
  assertEquals(out.isError, true);
});

Deno.test("a dry-run plans without failing on a missing body result", async () => {
  const server = new McpServer(new Demo(), { allowRun: true });
  const res = await server.handleMessage(
    req("tools/call", {
      name: "run:lint",
      arguments: { environment: "dev", dryRun: true },
    }),
  );
  const out = callText(res?.result);
  assertEquals(out.isError, false);
});

Deno.test("an unknown target or tool is surfaced through the result, not the transport", async () => {
  const server = new McpServer(new Demo(), { allowRun: true });
  const unknownTarget = callText(
    (await server.handleMessage(
      req("tools/call", {
        name: "run:nope",
        arguments: { environment: "dev" },
      }),
    ))?.result,
  );
  assertEquals(unknownTarget.isError, true);
  assertStringIncludes(unknownTarget.text, "Unknown target");

  const unknownTool = callText(
    (await server.handleMessage(
      req("tools/call", { name: "no-such-tool" }),
    ))?.result,
  );
  assertEquals(unknownTool.isError, true);
  assertStringIncludes(unknownTool.text, "Unknown tool");
});

Deno.test("tools/call validates its parameters", async () => {
  const server = new McpServer(new Demo());
  const res = await server.handleMessage(req("tools/call", {}));
  assertEquals(res?.error?.message, "tools/call requires a tool name");
  const res2 = await server.handleMessage(req("tools/call", { name: 5 }));
  assertStringIncludes(res2?.error?.message ?? "", "must be a string");
});

Deno.test("an unknown method errors; an invalid message is rejected", async () => {
  const server = new McpServer(new Demo());
  const res = await server.handleMessage(req("does/not/exist"));
  assertEquals(res?.error?.code, METHOD_NOT_FOUND);
  const bad = await server.handleMessage({ jsonrpc: "2.0", id: 1 });
  assertStringIncludes(bad?.error?.message ?? "", "Invalid Request");
});

Deno.test("notifications never get a reply", async () => {
  const server = new McpServer(new Demo());
  const initialized = await server.handleMessage({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assertEquals(initialized, null);
  // An id-less unknown request is treated as a notification, so also silent.
  const other = await server.handleMessage({ jsonrpc: "2.0", method: "foo" });
  assertEquals(other, null);
});

// --- transport (serveStdio / serveMcp) ---

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

/** A ByteWriter that records everything written, decodable as JSON lines. */
function capturingWriter(): { output: ByteWriter; messages(): unknown[] } {
  const parts: string[] = [];
  const dec = new TextDecoder();
  return {
    output: {
      write(p) {
        parts.push(dec.decode(p));
        return Promise.resolve(p.length);
      },
    },
    messages: () =>
      parts.join("").split("\n").filter((l) => l.trim() !== "").map((l) =>
        JSON.parse(l)
      ),
  };
}

Deno.test("serveStdio frames messages and answers each request", async () => {
  const seen: unknown[] = [];
  const { output, messages } = capturingWriter();
  await serveStdio(
    (message) => {
      seen.push(message);
      const id = (message as { id?: number }).id ?? null;
      return Promise.resolve(
        id === null ? null : { jsonrpc: "2.0", id, result: { ok: true } },
      );
    },
    // A request, a notification (no id → no reply), split across chunk boundaries.
    streamOf(
      '{"jsonrpc":"2.0","id":1,"method":"a"}\n{"jsonrpc":"2.0",',
      '"method":"n"}\n',
    ),
    output,
  );
  assertEquals(seen.length, 2);
  const out = messages();
  assertEquals(out.length, 1); // only the request got a reply
  assertEquals((out[0] as { id: number }).id, 1);
});

Deno.test("serveStdio answers an unparseable line with a parse error", async () => {
  const { output, messages } = capturingWriter();
  await serveStdio(
    () => Promise.resolve(null),
    streamOf("not json{\n"),
    output,
  );
  const out = messages();
  assertEquals((out[0] as { error: { code: number } }).error.code, -32700);
});

Deno.test("serveMcp prints a startup banner to stderr unless quiet", async () => {
  const { output } = capturingWriter();
  const original = console.error;
  const banner: string[] = [];
  console.error = (...args: unknown[]) => void banner.push(args.join(" "));
  try {
    await serveMcp(new Demo(), {
      allowRun: true, // exercises the "run enabled" mode label
      input: streamOf(""),
      output,
    });
  } finally {
    console.error = original;
  }
  assertStringIncludes(banner.join("\n"), "run enabled");
});

Deno.test("serveMcp runs the whole handshake over injected streams", async () => {
  const { output, messages } = capturingWriter();
  const code = await serveMcp(new Demo(), {
    quiet: true,
    input: streamOf(
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' +
        '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
    ),
    output,
  });
  assertEquals(code, 0);
  const out = messages();
  assertEquals(out.length, 2);
  assertStringIncludes(JSON.stringify(out[0]), "zuke");
  assertStringIncludes(JSON.stringify(out[1]), "list_targets");
});
