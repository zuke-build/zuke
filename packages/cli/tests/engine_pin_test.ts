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
import { engineRegistry, FakeHost } from "./_fakes.ts";

/** The registry document the engine pin tests resolve against. */
const META = {
  latest: "1.5.0",
  versions: { "1.5.0": {}, "1.2.0": {}, "1.1.0": { yanked: true } },
};

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

/** A {@link ProjectHost} over one file, recording what is written. */
function fileHost(text: string): ProjectHost & { written: string[] } {
  const host = {
    written: [] as string[],
    readText: () => Promise.resolve(text),
    writeText: (_path: string, content: string) => {
      host.written.push(content);
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
  registry: unknown = META,
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
    engineRegistry(registry),
    files,
  );
  return { code, log: host.logs.join("\n") };
}

const PINNED =
  '{\n  "name": "Acme",\n  "sdk": { "command": ["uv", "run", "build.py"] },\n  "engine": "1.2.0"\n}\n';

Deno.test("parseEnginePinFlags reads a version and --dry-run, and refuses the rest", () => {
  assertEquals(parseEnginePinFlags([]), { dryRun: false });
  assertEquals(parseEnginePinFlags(["1.2.0", "--dry-run"]), {
    version: "1.2.0",
    dryRun: true,
  });
  assertThrows(() => parseEnginePinFlags(["--force"]), Error, "unknown option");
  assertThrows(
    () => parseEnginePinFlags(["1.2.0", "1.3.0"]),
    Error,
    "one version",
  );
  assertThrows(() => parseEnginePinFlags(["latest"]), Error, "not a version");
});

Deno.test("zuke upgrade --engine moves the pin to the latest release, keeping the other fields", async () => {
  const files = fileHost(PINNED);
  const { code, log } = await pin([], projectAt(["zuke.json"], PINNED), files);
  assertEquals(code, 0);
  assertStringIncludes(
    log,
    `Moved engine from 1.2.0 to 1.5.0 in ${ROOT}/zuke.json`,
  );
  assertEquals(files.written, [
    JSON.stringify(
      {
        name: "Acme",
        sdk: { command: ["uv", "run", "build.py"] },
        engine: "1.5.0",
      },
      null,
      2,
    ) + "\n",
  ]);
});

Deno.test("zuke upgrade --engine notes a deno.lock that pins the old engine", async () => {
  const files = fileHost(PINNED);
  const { code, log } = await pin(
    [],
    projectAt(["zuke.json", "deno.lock"], PINNED),
    files,
  );
  assertEquals(code, 0);
  assertStringIncludes(
    log,
    `${ROOT}/deno.lock pins @zuke/engine 1.2.0, so the next run refuses it`,
  );
  // Without a lock there is nothing to say.
  const unlocked = await pin(
    [],
    projectAt(["zuke.json"], PINNED),
    fileHost(PINNED),
  );
  assertEquals(unlocked.log.includes("deno.lock"), false);
});

Deno.test("zuke upgrade --engine <version> pins that release, and --dry-run only says so", async () => {
  const files = fileHost(PINNED);
  const probe = projectAt(["zuke.json"], PINNED);
  const dry = await pin(["1.5.0", "--dry-run"], probe, files);
  assertEquals(dry.code, 0);
  assertStringIncludes(dry.log, "Would move engine from 1.2.0 to 1.5.0");
  assertEquals(files.written, []);
  // A file that changed under the probe is still rewritten as an object.
  const changed = fileHost("[]");
  const { code } = await pin(["1.5.0"], probe, changed);
  assertEquals(code, 0);
  assertEquals(changed.written, ['{\n  "engine": "1.5.0"\n}\n']);
});

Deno.test("zuke upgrade --engine=<version> is the inline spelling of the same pin", async () => {
  const files = fileHost(PINNED);
  const host = new FakeHost();
  const code = await main(
    ["upgrade", "--engine=1.5.0", "--dry-run"],
    host,
    defaultPrompter,
    undefined,
    undefined,
    undefined,
    projectAt(["zuke.json"], PINNED),
    engineRegistry(META),
    files,
  );
  assertEquals(code, 0);
  assertStringIncludes(
    host.logs.join("\n"),
    "Would move engine from 1.2.0 to 1.5.0",
  );
  assertEquals(files.written, []);
});

Deno.test("zuke upgrade --engine says when the pin is already there, and writes nothing", async () => {
  const files = fileHost(PINNED);
  const latest = await pin([], projectAt(["zuke.json"], PINNED), files, {
    latest: "1.2.0",
    versions: { "1.2.0": {} },
  });
  assertEquals(latest.code, 0);
  assertStringIncludes(
    latest.log,
    "1.2.0 is already pinned, and is the latest release",
  );
  const named = await pin(["1.2.0"], projectAt(["zuke.json"], PINNED), files);
  assertStringIncludes(named.log, "1.2.0 is already pinned.");
  assertEquals(files.written, []);
});

Deno.test("zuke upgrade --engine refuses what it cannot move, naming the fix", async () => {
  const cases: Array<[string[], BuildProbe, unknown, string]> = [
    [[], projectAt([], "{}"), META, "no zuke.json in this directory"],
    [[], projectAt(["zuke.json", "zuke.ts"], "{}"), META, "zuke relock moves"],
    [["1.1.0"], projectAt(["zuke.json"], PINNED), META, "has been yanked"],
    [
      [],
      projectAt(["zuke.json"], PINNED),
      new Error("offline"),
      "could not read @zuke/engine's versions",
    ],
    [
      ["--force"],
      projectAt(["zuke.json"], PINNED),
      META,
      "unknown option --force",
    ],
  ];
  for (const [args, probe, registry, message] of cases) {
    const files = fileHost(PINNED);
    const { code, log } = await pin(args, probe, files, registry);
    assertEquals(code, 1, message);
    assertStringIncludes(log, message);
    assertEquals(files.written, [], message);
  }
});
