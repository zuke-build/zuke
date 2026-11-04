// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import {
  type BuildProbe,
  defaultPrompter,
  main,
  type ProjectHost,
} from "../mod.ts";
import { parseEnginePinFlags } from "../src/engine_pin.ts";
import { FakeHost, pinRegistry, testPin } from "./_fakes.ts";
import { launcherBash, launcherPwsh } from "../src/launcher.ts";
import {
  binaryLauncherBash,
  binaryLauncherPwsh,
} from "../src/binary_launcher.ts";
import type { BinaryPin } from "../src/binary_pin.ts";

/** The zuke releases the engine pin tests resolve against: 2.4.0 is the latest. */
const RELEASES: readonly BinaryPin[] = [
  testPin("2.4.0", "1.4.0"),
  testPin("2.3.0", "1.3.0"),
];

/** The working directory as discovery reports it. */
const ROOT = Deno.cwd().replaceAll("\\", "/");

/** A probe for a project at the cwd holding `names`, whose `zuke.json` reads `config`. */
function projectAt(names: string[], config: string): BuildProbe {
  const present = new Set(names.map((name) => `${ROOT}/${name}`));
  return {
    exists: (path) => Promise.resolve(present.has(path)),
    ownership: () => Promise.resolve(null),
    realPath: (path) => Promise.resolve(path),
    readLink: () => Promise.resolve(null),
    uid: () => null,
    readText: () => Promise.resolve(config),
  };
}

/**
 * A {@link ProjectHost} over `files` (name → text at the root), recording
 * writes; `others` are names that exist as a directory or a link.
 */
function filesHost(
  files: Record<string, string>,
  others: readonly string[] = [],
): ProjectHost & { written: Map<string, string> } {
  const host = {
    written: new Map<string, string>(),
    entry: (path: string) => {
      const name = path.slice(ROOT.length + 1);
      return Promise.resolve(
        others.includes(name)
          ? "other" as const
          : name in files
          ? "file" as const
          : "missing" as const,
      );
    },
    readText: (path: string) => {
      const name = path.slice(ROOT.length + 1);
      return name in files
        ? Promise.resolve(files[name])
        : Promise.reject(new Deno.errors.NotFound(path));
    },
    writeText: (path: string, content: string) => {
      host.written.set(path.slice(ROOT.length + 1), content);
      return Promise.resolve();
    },
    remove: () => Promise.resolve(),
    deno: () => Promise.resolve(0),
    denoVersion: () => "2.9.3",
  };
  return host;
}

/** Run `zuke upgrade --engine <args>` against the fakes, returning the code and the log. */
async function pin(
  args: string[],
  probe: BuildProbe,
  files: ProjectHost,
  releases: readonly BinaryPin[] | Error = RELEASES,
): Promise<{ code: number; log: string }> {
  const host = new FakeHost();
  const code = await main(
    ["upgrade", "--engine", ...args],
    host,
    defaultPrompter,
    undefined,
    undefined,
    undefined,
    probe,
    pinRegistry(releases),
    files,
  );
  return { code, log: host.logs.join("\n") };
}

const PINNED =
  '{\n  "name": "Acme",\n  "sdk": { "command": ["uv", "run", "build.py"] },\n  "engine": "1.2.0"\n}\n';

/** A project still on the Deno launchers it was scaffolded with before. */
const ON_DENO = {
  "zuke.json": PINNED,
  "zuke": launcherBash({ bootstrapDeno: true }),
  "zuke.ps1": launcherPwsh({ bootstrapDeno: true }),
};

Deno.test("parseEnginePinFlags reads a version and --dry-run, and refuses the rest", () => {
  assertEquals(parseEnginePinFlags([]), { dryRun: false });
  assertEquals(parseEnginePinFlags(["2.4.0", "--dry-run"]), {
    version: "2.4.0",
    dryRun: true,
  });
  assertThrows(() => parseEnginePinFlags(["--force"]), Error, "unknown option");
  assertThrows(
    () => parseEnginePinFlags(["2.4.0", "2.3.0"]),
    Error,
    "one version",
  );
  assertThrows(
    () => parseEnginePinFlags(["latest"]),
    Error,
    "not a version — name a zuke release such as 2.4.0",
  );
});

Deno.test("zuke upgrade --engine moves a project off Deno to the latest zuke and its engine", async () => {
  const files = filesHost(ON_DENO);
  const { code, log } = await pin(
    [],
    projectAt(["zuke.json", "zuke", "zuke.ps1"], PINNED),
    files,
  );
  assertEquals(code, 0, log);
  assertStringIncludes(
    log,
    `Moved ${ROOT} to zuke 2.4.0, with @zuke/engine 1.4.0.`,
  );
  const latest = testPin("2.4.0", "1.4.0");
  assertEquals(Object.fromEntries(files.written), {
    "zuke.json": JSON.stringify(
      {
        name: "Acme",
        sdk: { command: ["uv", "run", "build.py"] },
        engine: "1.4.0",
      },
      null,
      2,
    ) + "\n",
    "zuke": binaryLauncherBash({ download: true }, latest),
    "zuke.ps1": binaryLauncherPwsh({ download: true }, latest),
  });
});

Deno.test("zuke upgrade --engine keeps a plain launcher plain, and a project without launchers without", async () => {
  const plain = filesHost({
    "zuke.json": PINNED,
    "zuke": launcherBash({ bootstrapDeno: false }),
    "zuke.ps1": binaryLauncherPwsh({ download: false }, testPin("2.3.0")),
  });
  await pin(["2.4.0"], projectAt(["zuke.json"], PINNED), plain);
  const pinned = testPin("2.4.0", "1.4.0");
  assertEquals(
    plain.written.get("zuke"),
    binaryLauncherBash({ download: false }, pinned),
  );
  // A plain binary launcher pins nothing, so it has nothing to move.
  assertEquals(plain.written.has("zuke.ps1"), false);
  const bare = filesHost({ "zuke.json": PINNED });
  const { code } = await pin([], projectAt(["zuke.json"], PINNED), bare);
  assertEquals(code, 0);
  assertEquals([...bare.written.keys()], ["zuke.json"]);
});

Deno.test("zuke upgrade --engine leaves what is not a launcher it wrote, and says so", async () => {
  // A zuke/ directory (why --launcher-name exists), a zuke.ps1 linked to a
  // launcher shared across repositories, and a zuke script of the user's own.
  const files = filesHost({
    "zuke.json": PINNED,
    "zuke.ps1": launcherPwsh({ bootstrapDeno: true }),
  }, ["zuke", "zuke.ps1"]);
  const { code, log } = await pin(
    [],
    projectAt(["zuke.json"], PINNED),
    files,
  );
  assertEquals(code, 0, log);
  assertEquals([...files.written.keys()], ["zuke.json"]);
  assertStringIncludes(
    log,
    `${ROOT}/zuke is a directory or a link, so it is left as it is.`,
  );
  assertStringIncludes(log, "a launcher kept under another name");
  const own = filesHost({ "zuke.json": PINNED, "zuke": "#!/bin/sh\nmake\n" });
  const mine = await pin([], projectAt(["zuke.json"], PINNED), own);
  assertStringIncludes(mine.log, `${ROOT}/zuke is not a Zuke launcher`);
  assertEquals(own.written.has("zuke"), false);
});

Deno.test("zuke upgrade --engine moves an MCP server off Deno, and leaves any other", async () => {
  const onDeno = JSON.stringify({
    mcpServers: {
      other: { command: "x", args: [] },
      zuke: {
        command: "deno",
        args: ["run", "-A", "jsr:@zuke/engine@1.2.0", "mcp", "--allow-run"],
      },
    },
  });
  const files = filesHost({ ...ON_DENO, ".mcp.json": onDeno });
  await pin([], projectAt(["zuke.json"], PINNED), files);
  assertEquals(JSON.parse(files.written.get(".mcp.json") ?? "{}"), {
    mcpServers: {
      other: { command: "x", args: [] },
      zuke: { command: "zuke", args: ["mcp", "--allow-run"] },
    },
  });
  for (
    const text of [
      JSON.stringify({
        mcpServers: { zuke: { command: "zuke", args: ["mcp"] } },
      }),
      "not json",
    ]
  ) {
    const kept = filesHost({ ...ON_DENO, ".mcp.json": text });
    await pin([], projectAt(["zuke.json"], PINNED), kept);
    assertEquals(kept.written.has(".mcp.json"), false);
  }
});

Deno.test("zuke upgrade --engine refuses a zuke.json it would write through", async () => {
  const { code, log } = await pin(
    [],
    projectAt(["zuke.json"], PINNED),
    filesHost({}, ["zuke.json"]),
  );
  assertEquals(code, 1);
  assertStringIncludes(log, "zuke.json is not a regular file");
});

Deno.test("zuke upgrade --engine notes a deno.lock nothing reads any more", async () => {
  const { code, log } = await pin(
    [],
    projectAt(["zuke.json", "deno.lock"], PINNED),
    filesHost(ON_DENO),
  );
  assertEquals(code, 0);
  assertStringIncludes(
    log,
    `zuke reads no ${ROOT}/deno.lock: it carries the exact releases it runs`,
  );
  const unlocked = await pin(
    [],
    projectAt(["zuke.json"], PINNED),
    filesHost(ON_DENO),
  );
  assertEquals(unlocked.log.includes("deno.lock"), false);
});

Deno.test("zuke upgrade --engine <version> moves to that release, and --dry-run only says so", async () => {
  const files = filesHost(ON_DENO);
  const probe = projectAt(["zuke.json"], PINNED);
  const dry = await pin(["2.3.0", "--dry-run"], probe, files);
  assertEquals(dry.code, 0);
  assertStringIncludes(
    dry.log,
    `Would move ${ROOT} to zuke 2.3.0, with @zuke/engine 1.3.0, rewriting:\n` +
      `  ${ROOT}/zuke.json\n  ${ROOT}/zuke\n  ${ROOT}/zuke.ps1`,
  );
  assertEquals(files.written.size, 0);
  // A file that changed under the probe is still rewritten as an object.
  const changed = filesHost({ "zuke.json": "[]" });
  const { code } = await pin(["2.3.0"], probe, changed);
  assertEquals(code, 0);
  assertEquals(changed.written.get("zuke.json"), '{\n  "engine": "1.3.0"\n}\n');
});

Deno.test("zuke upgrade --engine=<version> is the inline spelling of the same move", async () => {
  const files = filesHost(ON_DENO);
  const host = new FakeHost();
  const code = await main(
    ["upgrade", "--engine=2.3.0", "--dry-run"],
    host,
    defaultPrompter,
    undefined,
    undefined,
    undefined,
    projectAt(["zuke.json"], PINNED),
    pinRegistry(RELEASES),
    files,
  );
  assertEquals(code, 0);
  assertStringIncludes(host.logs.join("\n"), "Would move");
  assertEquals(files.written.size, 0);
});

Deno.test("zuke upgrade --engine says when the project is already there, and writes nothing", async () => {
  const latest = testPin("2.4.0", "1.4.0");
  const config = '{"engine": "1.4.0"}';
  const files = filesHost({
    "zuke.json": config,
    "zuke": binaryLauncherBash({ download: true }, latest),
    "zuke.ps1": binaryLauncherPwsh({ download: true }, latest),
  });
  const probe = projectAt(["zuke.json"], config);
  const current = await pin([], probe, files);
  assertEquals(current.code, 0);
  assertStringIncludes(
    current.log,
    "zuke 2.4.0 (@zuke/engine 1.4.0) is already pinned, and is the latest " +
      "release",
  );
  const named = await pin(["2.4.0"], probe, files);
  assertStringIncludes(named.log, "is already pinned.");
  assertEquals(files.written.size, 0);
});

Deno.test("zuke upgrade --engine refuses what it cannot move, naming the fix", async () => {
  const cases: Array<
    [string[], BuildProbe, readonly BinaryPin[] | Error, string]
  > = [
    [[], projectAt([], "{}"), RELEASES, "no zuke.json in this directory"],
    [
      [],
      projectAt(["zuke.json", "zuke.ts"], "{}"),
      RELEASES,
      "zuke relock moves",
    ],
    [
      ["9.9.9"],
      projectAt(["zuke.json"], PINNED),
      RELEASES,
      "9.9.9",
    ],
    [
      [],
      projectAt(["zuke.json"], PINNED),
      new Error("offline"),
      "could not read @zuke/cli's versions",
    ],
    [
      [],
      projectAt(["zuke.json"], PINNED),
      [testPin("2.3.0")],
      "zuke upgrade --engine: zuke 2.4.0's published binaries could not be " +
      "read. A release's binaries are published shortly after it",
    ],
    [
      ["--force"],
      projectAt(["zuke.json"], PINNED),
      RELEASES,
      "unknown option --force",
    ],
  ];
  for (const [args, probe, releases, message] of cases) {
    const files = filesHost(ON_DENO);
    const { code, log } = await pin(args, probe, files, releases);
    assertEquals(code, 1, message);
    assertStringIncludes(log, message);
    assertEquals(files.written.size, 0, message);
  }
});
