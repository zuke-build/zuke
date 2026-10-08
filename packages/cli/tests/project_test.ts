// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { stripAnsi } from "@zuke/core/render";
import type { BuildProbe } from "../src/dispatch.ts";
import { PLAIN_PAINT } from "../src/paint.ts";
import {
  installArgs,
  parseInstallFlags,
  type ProjectHost,
} from "../src/project.ts";
import { runRelock } from "../src/relock.ts";
import { runCache } from "../src/cache.ts";
import {
  dependencySpecifier,
  parseDependencyArgs,
  runDependencies,
} from "../src/dependencies.ts";
import { noProjectProbe } from "./_fakes.ts";

/** The fake project's root. */
const ROOT = "/work/app";

/** A probe that finds a project at {@link ROOT}, with no trust gate. */
const projectProbe: BuildProbe = {
  exists: (path) => Promise.resolve(path === `${ROOT}/zuke.json`),
  ownership: () => Promise.resolve(null),
  realPath: (path) => Promise.resolve(path),
  readLink: () => Promise.resolve(null),
  uid: () => null,
};

/** A lock resolving `@zuke/core` to `version`. */
function coreLock(version: string): string {
  return JSON.stringify({
    version: "5",
    specifiers: { "jsr:@zuke/core@^1": version },
  });
}

/** An in-memory {@link ProjectHost}; its `deno` writes `writes` into files. */
class FakeProjectHost implements ProjectHost {
  readonly files = new Map<string, string>();
  readonly runs: { args: string[]; cwd: string }[] = [];
  /** What each `deno` run writes, by path, before exiting with `exit`. */
  writes: Record<string, string> = {};
  exit = 0;
  /** When set, `deno` throws this instead of exiting. */
  throws: Error | undefined;
  version = "2.9.3";

  readText(path: string): Promise<string> {
    const text = this.files.get(path);
    return text === undefined
      ? Promise.reject(new Deno.errors.NotFound(path))
      : Promise.resolve(text);
  }
  writeText(path: string, text: string): Promise<void> {
    this.files.set(path, text);
    return Promise.resolve();
  }
  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }
  deno(args: string[], cwd: string): Promise<number> {
    this.runs.push({ args, cwd });
    if (this.throws !== undefined) return Promise.reject(this.throws);
    for (const [path, text] of Object.entries(this.writes)) {
      this.files.set(path, text);
    }
    return Promise.resolve(this.exit);
  }
  denoVersion(): string {
    return this.version;
  }
}

/** Run a project command, collecting its log lines. */
async function collect(
  run: (log: (line: string) => void) => Promise<number>,
): Promise<{ code: number; logs: string }> {
  const lines: string[] = [];
  const code = await run((line) => lines.push(stripAnsi(line)));
  return { code, logs: lines.join("\n") };
}

Deno.test("parseInstallFlags reads --min-dep-age in both forms, and --dry-run", () => {
  assertEquals(parseInstallFlags("relock", []), { dryRun: false });
  assertEquals(parseInstallFlags("relock", ["--min-dep-age", "0"]), {
    dryRun: false,
    minDepAge: "0",
  });
  assertEquals(parseInstallFlags("cache", ["--min-dep-age=P2D", "--dry-run"]), {
    dryRun: true,
    minDepAge: "P2D",
  });
});

Deno.test("parseInstallFlags refuses an unknown option or a missing value", () => {
  assertThrows(
    () => parseInstallFlags("relock", ["--force"]),
    Error,
    "unknown",
  );
  for (
    const bad of [["--min-dep-age"], ["--min-dep-age", "--dry-run"], [
      "--min-dep-age=",
    ], ["--min-dep-age", ""]]
  ) {
    assertThrows(
      () => parseInstallFlags("relock", bad),
      Error,
      "needs a value",
    );
  }
});

Deno.test("installArgs adds the dependency-age flag only when asked, and only where Deno has it", () => {
  assertEquals(installArgs("cache", { dryRun: false }, "2.9.3"), [
    "install",
    "--entrypoint",
    "zuke.ts",
  ]);
  assertEquals(
    installArgs("cache", { dryRun: false, minDepAge: "0" }, "2.9.3"),
    [
      "install",
      "--entrypoint",
      "zuke.ts",
      "--minimum-dependency-age=0",
    ],
  );
  assertThrows(
    () => installArgs("relock", { dryRun: false, minDepAge: "0" }, "2.4.5"),
    Error,
    "does not accept",
  );
});

Deno.test("relock regenerates the lock and reports core before and after", async () => {
  const host = new FakeProjectHost();
  host.files.set(`${ROOT}/deno.lock`, coreLock("1.66.0"));
  host.writes = { [`${ROOT}/deno.lock`]: coreLock("1.69.0") };
  const { code, logs } = await collect((log) =>
    runRelock(
      ["--min-dep-age", "0"],
      log,
      host,
      PLAIN_PAINT,
      ROOT,
      projectProbe,
    )
  );
  assertEquals(code, 0);
  assertEquals(host.runs, [{
    args: ["install", "--entrypoint", "zuke.ts", "--minimum-dependency-age=0"],
    cwd: ROOT,
  }]);
  assertStringIncludes(
    logs,
    "Regenerated deno.lock: @zuke/core 1.66.0 → 1.69.0",
  );
});

Deno.test("relock says when core did not move, and handles a project with no lock yet", async () => {
  const same = new FakeProjectHost();
  same.files.set(`${ROOT}/deno.lock`, coreLock("1.69.0"));
  same.writes = { [`${ROOT}/deno.lock`]: coreLock("1.69.0") };
  const kept = await collect((log) =>
    runRelock([], log, same, PLAIN_PAINT, ROOT, projectProbe)
  );
  assertStringIncludes(kept.logs, "@zuke/core 1.69.0");
  assertEquals(kept.logs.includes("→"), false);

  const fresh = new FakeProjectHost();
  fresh.writes = { [`${ROOT}/deno.lock`]: coreLock("1.69.0") };
  const made = await collect((log) =>
    runRelock([], log, fresh, PLAIN_PAINT, ROOT, projectProbe)
  );
  assertEquals(made.code, 0);
  assertStringIncludes(made.logs, "none → 1.69.0");
});

Deno.test("relock puts the old lock back, byte for byte, when the install fails", async () => {
  const original = coreLock("1.66.0") + "\n";
  const failed = new FakeProjectHost();
  failed.files.set(`${ROOT}/deno.lock`, original);
  failed.exit = 1;
  const { code, logs } = await collect((log) =>
    runRelock([], log, failed, PLAIN_PAINT, ROOT, projectProbe)
  );
  assertEquals(code, 1);
  assertEquals(failed.files.get(`${ROOT}/deno.lock`), original);
  assertStringIncludes(logs, "deno.lock is unchanged");

  const thrown = new FakeProjectHost();
  thrown.files.set(`${ROOT}/deno.lock`, original);
  thrown.throws = new Error("no deno");
  await assertRejects(
    () => runRelock([], () => {}, thrown, PLAIN_PAINT, ROOT, projectProbe),
    Error,
    "no deno",
  );
  assertEquals(thrown.files.get(`${ROOT}/deno.lock`), original);

  const silent = new FakeProjectHost();
  silent.files.set(`${ROOT}/deno.lock`, original);
  const none = await collect((log) =>
    runRelock([], log, silent, PLAIN_PAINT, ROOT, projectProbe)
  );
  assertEquals(none.code, 1);
  assertEquals(silent.files.get(`${ROOT}/deno.lock`), original);
  assertStringIncludes(none.logs, "wrote no deno.lock");
});

Deno.test("relock follows the configured lock path, and refuses a disabled lock", async () => {
  const moved = new FakeProjectHost();
  moved.files.set(`${ROOT}/deno.json`, '{ "lock": "locks/zuke.lock" }');
  moved.writes = { [`${ROOT}/locks/zuke.lock`]: coreLock("1.69.0") };
  const { logs } = await collect((log) =>
    runRelock([], log, moved, PLAIN_PAINT, ROOT, projectProbe)
  );
  assertStringIncludes(logs, "Regenerated locks/zuke.lock");

  const off = new FakeProjectHost();
  off.files.set(`${ROOT}/deno.json`, '{ "lock": false }');
  await assertRejects(
    () => runRelock([], () => {}, off, PLAIN_PAINT, ROOT, projectProbe),
    Error,
    "disables its lock",
  );
  assertEquals(off.runs, []);
});

Deno.test("relock --dry-run names the command and changes nothing", async () => {
  const host = new FakeProjectHost();
  host.files.set(`${ROOT}/deno.lock`, coreLock("1.66.0"));
  const { code, logs } = await collect((log) =>
    runRelock(["--dry-run"], log, host, PLAIN_PAINT, ROOT, projectProbe)
  );
  assertEquals(code, 0);
  assertEquals(host.runs, []);
  assertEquals(host.files.get(`${ROOT}/deno.lock`), coreLock("1.66.0"));
  assertStringIncludes(logs, "deno install --entrypoint zuke.ts");
});

Deno.test("the project commands need a project", async () => {
  for (
    const run of [
      () =>
        runRelock(
          [],
          () => {},
          new FakeProjectHost(),
          PLAIN_PAINT,
          ROOT,
          noProjectProbe,
        ),
      () =>
        runCache(
          [],
          () => {},
          new FakeProjectHost(),
          PLAIN_PAINT,
          ROOT,
          noProjectProbe,
        ),
      () =>
        runDependencies(
          "add",
          ["docker"],
          () => {},
          new FakeProjectHost(),
          PLAIN_PAINT,
          ROOT,
          noProjectProbe,
        ),
    ]
  ) {
    await assertRejects(run, Error, "no zuke.json");
  }
});

Deno.test("cache installs the build's graph, keeping the lock", async () => {
  const host = new FakeProjectHost();
  host.files.set(`${ROOT}/deno.lock`, coreLock("1.66.0"));
  const ok = await collect((log) =>
    runCache([], log, host, PLAIN_PAINT, ROOT, projectProbe)
  );
  assertEquals(ok.code, 0);
  assertEquals(host.runs, [{
    args: ["install", "--entrypoint", "zuke.ts"],
    cwd: ROOT,
  }]);
  assertEquals(host.files.get(`${ROOT}/deno.lock`), coreLock("1.66.0"));
  assertStringIncludes(ok.logs, "Cached everything");

  const dry = new FakeProjectHost();
  const plan = await collect((log) =>
    runCache(
      ["--dry-run", "--min-dep-age=0"],
      log,
      dry,
      PLAIN_PAINT,
      ROOT,
      projectProbe,
    )
  );
  assertEquals(dry.runs, []);
  assertStringIncludes(plan.logs, "--minimum-dependency-age=0");

  const failed = new FakeProjectHost();
  failed.exit = 3;
  const bad = await collect((log) =>
    runCache([], log, failed, PLAIN_PAINT, ROOT, projectProbe)
  );
  assertEquals(bad.code, 3);
  assertStringIncludes(bad.logs, "exited 3");
});

Deno.test("dependencySpecifier maps short names to Zuke packages and passes full specifiers", () => {
  assertEquals(dependencySpecifier("add", "docker"), "jsr:@zuke/docker");
  assertEquals(dependencySpecifier("add", "@std/yaml"), "jsr:@std/yaml");
  assertEquals(
    dependencySpecifier("add", "jsr:@zuke/gh@^1"),
    "jsr:@zuke/gh@^1",
  );
  assertEquals(dependencySpecifier("remove", "npm:chalk"), "npm:chalk");
  // Never an option Deno would read, nor a name no registry has.
  for (const bad of ["--config=x", "-D", "Docker", "../x", "@x", "a b"]) {
    assertThrows(() => dependencySpecifier("add", bad), Error, "not a package");
  }
});

Deno.test("parseDependencyArgs needs a package", () => {
  assertThrows(() => parseDependencyArgs("add", []), Error, "at least one");
  assertThrows(
    () => parseDependencyArgs("remove", ["--dry-run"]),
    Error,
    "at least one",
  );
  assertEquals(parseDependencyArgs("add", ["gh", "--dry-run"]), {
    specifiers: ["jsr:@zuke/gh"],
    dryRun: true,
  });
});

Deno.test("add and remove run deno add / remove in the root", async () => {
  const host = new FakeProjectHost();
  const added = await collect((log) =>
    runDependencies(
      "add",
      ["docker", "gh"],
      log,
      host,
      PLAIN_PAINT,
      ROOT,
      projectProbe,
    )
  );
  assertEquals(added.code, 0);
  assertStringIncludes(added.logs, "Added jsr:@zuke/docker, jsr:@zuke/gh.");
  const removed = await collect((log) =>
    runDependencies(
      "remove",
      ["docker"],
      log,
      host,
      PLAIN_PAINT,
      ROOT,
      projectProbe,
    )
  );
  assertStringIncludes(removed.logs, "Removed jsr:@zuke/docker.");
  assertEquals(host.runs, [
    { args: ["add", "jsr:@zuke/docker", "jsr:@zuke/gh"], cwd: ROOT },
    { args: ["remove", "jsr:@zuke/docker"], cwd: ROOT },
  ]);

  const dry = new FakeProjectHost();
  const plan = await collect((log) =>
    runDependencies(
      "add",
      ["docker", "--dry-run"],
      log,
      dry,
      PLAIN_PAINT,
      ROOT,
      projectProbe,
    )
  );
  assertEquals(dry.runs, []);
  assertStringIncludes(plan.logs, "deno add jsr:@zuke/docker");

  const failed = new FakeProjectHost();
  failed.exit = 1;
  const bad = await collect((log) =>
    runDependencies(
      "remove",
      ["docker"],
      log,
      failed,
      PLAIN_PAINT,
      ROOT,
      projectProbe,
    )
  );
  assertEquals(bad.code, 1);
  assertStringIncludes(bad.logs, "deno remove exited 1");
});
