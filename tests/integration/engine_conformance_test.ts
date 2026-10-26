// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Replay every case under `spike/engine/conformance/` through the real CLI
 * `main()`: the fake worker answers the case's manifest, and the run must make
 * exactly the calls the case lists, exit as it says, and list what it says.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { WorkerHost } from "../../spike/engine/src/host.ts";
import { materialize } from "../../spike/engine/src/materialize.ts";
import { isRecord } from "../../spike/engine/src/protocol.ts";
import { runCli, withStateDir } from "./_harness.ts";

const CASES = new URL("../../spike/engine/conformance/", import.meta.url);
const FAKE =
  new URL("../../spike/engine/fixtures/fake_worker.ts", import.meta.url)
    .href;

interface Case {
  readonly manifest: unknown;
  readonly list?: { targets: unknown; parameters: unknown };
  readonly argv: string[];
  readonly code: number;
  readonly calls: string[];
  readonly configure: unknown;
}

function caseOf(value: unknown, file: string): Case {
  if (
    !isRecord(value) || !Array.isArray(value.argv) ||
    typeof value.code !== "number" || !Array.isArray(value.calls) ||
    value.configure === undefined
  ) {
    throw new Error(
      `${file}: a case needs manifest, argv, code, calls and configure`,
    );
  }
  const list = isRecord(value.list)
    ? { targets: value.list.targets, parameters: value.list.parameters }
    : undefined;
  return {
    manifest: value.manifest,
    list,
    argv: value.argv.map(String),
    code: value.code,
    calls: value.calls.map(String),
    configure: value.configure,
  };
}

/** The `worker: <prefix> …` lines of the log, without the prefix. */
function logged(err: string, prefix: string): string[] {
  return err.split("\n").flatMap((line) =>
    line.startsWith(`worker: ${prefix} `)
      ? [line.slice(`worker: ${prefix} `.length)]
      : []
  );
}

for await (const entry of Deno.readDir(CASES)) {
  if (!entry.name.endsWith(".json")) continue;
  const spec = caseOf(
    JSON.parse(await Deno.readTextFile(new URL(entry.name, CASES))),
    entry.name,
  );
  Deno.test(`conformance: ${entry.name}`, async () => {
    // Each case runs from its own empty directory: the incremental cache
    // lives under the working directory's `.zuke/`, so a repeat of the
    // cache-key case in the repository would be a cache hit, not a run.
    const dir = await Deno.makeTempDir();
    const previous = Deno.cwd();
    Deno.chdir(dir);
    try {
      await replay(spec);
    } finally {
      Deno.chdir(previous);
      await Deno.remove(dir, { recursive: true });
    }
  });
}

async function replay(spec: Case): Promise<void> {
  await withStateDir(async () => {
    Deno.env.set("ZUKE_FAKE_PLAN", JSON.stringify(spec.manifest));
    Deno.env.delete("ZUKE_FAKE_BAD_TOKEN");
    const host = await WorkerHost.start({
      command: [Deno.execPath(), "run", "-A", FAKE],
      cwd: Deno.cwd(),
      graceMs: 1_000,
    });
    try {
      const Remote = materialize(await host.describe(), host);
      if (spec.list !== undefined) {
        const listed = await runCli(Remote, ["--list", "--json"]);
        assertEquals(listed.code, 0, listed.err);
        const surface: unknown = JSON.parse(listed.out);
        const actual = isRecord(surface) ? surface : {};
        assertEquals(actual.targets, spec.list.targets);
        assertEquals(actual.parameters, spec.list.parameters);
      }
      const result = await runCli(Remote, spec.argv);
      assertEquals(result.code, spec.code, result.out + result.err);
      assertEquals(logged(result.err, "call:"), spec.calls);
      const [configure] = logged(result.err, "configure:");
      const sent: unknown = JSON.parse(configure ?? "{}");
      const { parameters } = isRecord(sent) ? sent : {};
      assertEquals({ parameters }, spec.configure);
    } finally {
      await host.finish(0);
    }
  });
}
