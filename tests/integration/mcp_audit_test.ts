/**
 * Integration: the MCP audit trail is rendered by `zuke runs show`, driven
 * through the real CLI `main()`. A record with an audit event is persisted to
 * the temp state store (as the MCP server appends one), then read back and shown
 * through the CLI — exercising the `formatRunDetail` audit section end to end.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  FileSystemStateStore,
  type RunRecord,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

class Demo extends Build {
  go = target().executes(() => {});
}

Deno.test("runs show renders the MCP audit trail", async () => {
  await withStateDir(async (dir) => {
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const now = new Date().toISOString();
    const record: RunRecord = {
      id: "run-1",
      build: "Demo",
      rootTarget: "go",
      status: "succeeded",
      actor: "alice",
      createdAt: now,
      updatedAt: now,
      graph: [{ name: "go", dependsOn: [] }],
      params: {},
      targets: { go: { status: "succeeded", meta: {} } },
      signals: {},
      // The event an MCP `run:go` call would have appended.
      events: [{
        at: now,
        tool: "run:go",
        actor: "session-b",
        outcome: "ok",
        args: { environment: "dev" },
      }],
    };
    const put = await store.putRun(record, null);
    assertEquals(put.ok, true);

    const { code, out } = await runCli(Demo, ["runs", "show", "run-1"]);
    assertEquals(code, 0);
    assertStringIncludes(out, "Audit:");
    assertStringIncludes(out, "run:go");
    assertStringIncludes(out, "session-b");
  });
});

Deno.test("runs show omits the audit section when there are no events", async () => {
  await withStateDir(async (dir) => {
    class B extends Build {
      build = target().executes(() => {});
    }
    const run = await runCli(B, ["build"]);
    assertEquals(run.code, 0);
    const id =
      (await new FileSystemStateStore(dir, defaultStateHost).listRuns({}))[0]
        .id;

    const { code, out } = await runCli(B, ["runs", "show", id]);
    assertEquals(code, 0);
    assertEquals(out.includes("Audit:"), false);
  });
});
