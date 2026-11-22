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
  npmOperand,
  parseDependencyArgs,
  runDependencies,
} from "../src/dependencies.ts";
import { noProjectProbe } from "./_fakes.ts";

/** The fake project's root. */
const ROOT = "/work/app";

/** A probe that finds a project at {@link ROOT}, with no trust gate. */
const projectProbe: BuildProbe = {
  // A TypeScript build: its zuke.json and its zuke.ts.
  exists: (path) =>
    Promise.resolve(path === `${ROOT}/zuke.json` || path === `${ROOT}/zuke.ts`),
  ownership: () => Promise.resolve(null),
  realPath: (path) => Promise.resolve(path),
  readLink: () => Promise.resolve(null),
  uid: () => null,
  readText: () => Promise.resolve("{}"),
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

  entry(path: string): Promise<"file" | "missing"> {
    return Promise.resolve(this.files.has(path) ? "file" : "missing");
  }
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
    return this.#ran();
  }
  /** Runs npm as `deno` runs Deno, recording into {@link npmRuns}. */
  readonly npmRuns: { args: string[]; cwd: string }[] = [];
  /** The files as each npm run found them. */
  readonly npmSaw: Map<string, string>[] = [];
  npm(args: string[], cwd: string): Promise<number> {
    this.npmRuns.push({ args, cwd });
    this.npmSaw.push(new Map(this.files));
    return this.#ran();
  }
  #ran(): Promise<number> {
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
  assertEquals(parseInstallFlags("relock", []), {
    entrypoints: [],
    dryRun: false,
  });
  assertEquals(parseInstallFlags("relock", ["--min-dep-age", "0"]), {
    entrypoints: [],
    dryRun: false,
    minDepAge: "0",
  });
  assertEquals(parseInstallFlags("cache", ["--min-dep-age=P2D", "--dry-run"]), {
    entrypoints: [],
    dryRun: true,
    minDepAge: "P2D",
  });
  // Anything not an option is a further entrypoint.
  assertEquals(parseInstallFlags("relock", ["main.ts", "tools/x.ts"]), {
    entrypoints: ["main.ts", "tools/x.ts"],
    dryRun: false,
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
  assertEquals(
    installArgs(
      "cache",
      { entrypoints: [], dryRun: false },
      "2.9.3",
      "build.ts",
    ),
    [
      "install",
      "--entrypoint",
      "build.ts",
    ],
  );
  assertEquals(
    installArgs(
      "cache",
      { entrypoints: [], dryRun: false, minDepAge: "0" },
      "2.9.3",
      "zuke.ts",
    ),
    [
      "install",
      "--entrypoint",
      "zuke.ts",
      "--minimum-dependency-age=0",
    ],
  );
  assertThrows(
    () =>
      installArgs(
        "relock",
        { entrypoints: [], dryRun: false, minDepAge: "0" },
        "2.4.5",
        "zuke.ts",
      ),
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
    args: [
      "install",
      "--entrypoint",
      "zuke.ts",
      "--minimum-dependency-age=0",
      "--frozen=false",
    ],
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
  host.files.set(`${ROOT}/deno.json`, "{}");
  host.writes = { [`${ROOT}/deno.json`]: '{ "imports": {} }' };
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
  host.writes = { [`${ROOT}/deno.json`]: "{}" };
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

Deno.test("remove says so when deno remove found nothing to remove", async () => {
  const host = new FakeProjectHost();
  host.files.set(`${ROOT}/deno.json`, '{ "imports": {} }');
  const { code, logs } = await collect((log) =>
    runDependencies(
      "remove",
      ["missing"],
      log,
      host,
      PLAIN_PAINT,
      ROOT,
      projectProbe,
    )
  );
  assertEquals(code, 1);
  assertStringIncludes(logs, "nothing was removed");
  assertEquals(logs.includes("Removed"), false);
});

Deno.test("relock keeps a backup on disk while it works, and removes it after", async () => {
  const host = new FakeProjectHost();
  const original = coreLock("1.66.0");
  host.files.set(`${ROOT}/deno.lock`, original);
  host.writes = { [`${ROOT}/deno.lock`]: coreLock("1.69.0") };
  const seen: (string | undefined)[] = [];
  const deno = host.deno.bind(host);
  host.deno = (args, cwd) => {
    // Mid-install: the old lock is on disk as a backup, the lock is emptied.
    seen.push(host.files.get(`${ROOT}/deno.lock.relock-backup`));
    seen.push(host.files.get(`${ROOT}/deno.lock`));
    return deno(args, cwd);
  };
  const { code } = await collect((log) =>
    runRelock([], log, host, PLAIN_PAINT, ROOT, projectProbe)
  );
  assertEquals(code, 0);
  assertEquals(seen[0], original);
  assertEquals(JSON.parse(seen[1] ?? "{}"), { version: "5" });
  assertEquals(host.files.has(`${ROOT}/deno.lock.relock-backup`), false);
});

Deno.test("relock refuses to start over a backup a dead run left behind", async () => {
  const host = new FakeProjectHost();
  host.files.set(`${ROOT}/deno.lock`, '{ "version": "5" }');
  host.files.set(`${ROOT}/deno.lock.relock-backup`, coreLock("1.66.0"));
  await assertRejects(
    () => runRelock([], () => {}, host, PLAIN_PAINT, ROOT, projectProbe),
    Error,
    "did not finish",
  );
  assertEquals(host.runs, []);
  assertEquals(
    host.files.get(`${ROOT}/deno.lock.relock-backup`),
    coreLock("1.66.0"),
  );
});

Deno.test("relock names further entrypoints, and the packages a narrower graph dropped", async () => {
  const host = new FakeProjectHost();
  host.files.set(
    `${ROOT}/deno.lock`,
    JSON.stringify({
      version: "5",
      specifiers: {
        "jsr:@zuke/core@^1": "1.66.0",
        "jsr:@std/path@^1": "1.0.0",
      },
    }),
  );
  host.writes = { [`${ROOT}/deno.lock`]: coreLock("1.69.0") };
  const { logs } = await collect((log) =>
    runRelock(["main.ts"], log, host, PLAIN_PAINT, ROOT, projectProbe)
  );
  assertEquals(host.runs[0].args.slice(0, 4), [
    "install",
    "--entrypoint",
    "zuke.ts",
    "main.ts",
  ]);
  assertStringIncludes(logs, "No longer locked: @std/path");
  assertStringIncludes(logs, "zuke.ts and main.ts were resolved");
});

Deno.test("relock warns when Deno's dependency age resolved an older core", async () => {
  const host = new FakeProjectHost();
  host.files.set(`${ROOT}/deno.lock`, coreLock("1.70.0"));
  host.writes = { [`${ROOT}/deno.lock`]: coreLock("1.67.0") };
  const plain = await collect((log) =>
    runRelock([], log, host, PLAIN_PAINT, ROOT, projectProbe)
  );
  assertStringIncludes(plain.logs, "--min-dep-age 0");

  const asked = new FakeProjectHost();
  asked.files.set(`${ROOT}/deno.lock`, coreLock("1.70.0"));
  asked.writes = { [`${ROOT}/deno.lock`]: coreLock("1.67.0") };
  const told = await collect((log) =>
    runRelock(
      ["--min-dep-age", "P7D"],
      log,
      asked,
      PLAIN_PAINT,
      ROOT,
      projectProbe,
    )
  );
  assertEquals(told.logs.includes("resolved older"), false);
});

Deno.test("relock in a workspace member does not claim to restore what was never there", async () => {
  const host = new FakeProjectHost();
  const { code, logs } = await collect((log) =>
    runRelock([], log, host, PLAIN_PAINT, ROOT, projectProbe)
  );
  assertEquals(code, 1);
  assertEquals(logs.includes("restored"), false);
  assertStringIncludes(logs, "workspace root");
});

/** A probe that finds a build another SDK hosts at {@link ROOT}, on engine 1.2.0. */
const hostedProbe: BuildProbe = {
  ...projectProbe,
  exists: (path) => Promise.resolve(path === `${ROOT}/zuke.json`),
  readText: () => Promise.resolve('{ "engine": "1.2.0" }'),
};

Deno.test("the project commands refuse a build another SDK hosts, running nothing", async () => {
  const host = new FakeProjectHost();
  const commands: Array<
    [string, (log: (line: string) => void) => Promise<number>]
  > = [
    ["cache", (log) => runCache([], log, host, PLAIN_PAINT, ROOT, hostedProbe)],
    [
      "relock",
      (log) => runRelock([], log, host, PLAIN_PAINT, ROOT, hostedProbe),
    ],
    [
      "add",
      (log) =>
        runDependencies(
          "add",
          ["docker"],
          log,
          host,
          PLAIN_PAINT,
          ROOT,
          hostedProbe,
        ),
    ],
    [
      "remove",
      (log) =>
        runDependencies(
          "remove",
          ["docker"],
          log,
          host,
          PLAIN_PAINT,
          ROOT,
          hostedProbe,
        ),
    ],
  ];
  for (const [name, run] of commands) {
    await assertRejects(
      () => run(() => {}),
      Error,
      `zuke ${name}: the project at ${ROOT} is a build another SDK hosts, ` +
        "run on @zuke/engine 1.2.0",
    );
  }
  assertEquals(host.runs, []);
  assertEquals(host.files.size, 0);
});

/** A probe that finds a project at {@link ROOT} whose build runs on Node. */
const nodeProbe: BuildProbe = {
  ...projectProbe,
  readText: () => Promise.resolve('{ "runtime": "node" }'),
};

Deno.test("npmOperand maps a Zuke package to its npm alias, and passes npm: specifiers through", () => {
  const docker = dependencySpecifier("add", "docker");
  assertEquals(
    npmOperand("add", docker),
    "@zuke/docker@npm:@zuke-build/docker@^1",
  );
  assertEquals(npmOperand("remove", docker), "@zuke/docker");
  assertEquals(npmOperand("add", "npm:left-pad@1"), "left-pad@1");
  assertEquals(npmOperand("remove", "npm:left-pad@1"), "left-pad");
  assertEquals(npmOperand("remove", "npm:@types/node@26"), "@types/node");
  assertEquals(npmOperand("remove", "npm:@types/node"), "@types/node");
  const refused = assertThrows(() => npmOperand("add", "jsr:@std/yaml"));
  assertStringIncludes(String(refused), "npm:<name>");
});

Deno.test("zuke add and remove run npm in a Node project, never deno", async () => {
  const host = new FakeProjectHost();
  host.files.set(`${ROOT}/package.json`, "{}");
  host.writes = { [`${ROOT}/package.json`]: '{"dependencies":{}}' };
  const added = await collect((log) =>
    runDependencies(
      "add",
      ["docker", "npm:left-pad@1"],
      log,
      host,
      PLAIN_PAINT,
      ROOT,
      nodeProbe,
    )
  );
  assertEquals(added.code, 0, added.logs);
  assertStringIncludes(added.logs, "Added @zuke/docker, left-pad.");
  assertEquals(host.runs, []);
  assertEquals(host.npmRuns, [{
    args: [
      "install",
      "--ignore-scripts",
      "@zuke/docker@npm:@zuke-build/docker@^1",
      "left-pad@1",
    ],
    cwd: ROOT,
  }]);

  // Nothing changed in package.json: nothing was there to remove.
  const removed = await collect((log) =>
    runDependencies(
      "remove",
      ["docker"],
      log,
      host,
      PLAIN_PAINT,
      ROOT,
      nodeProbe,
    )
  );
  assertEquals(removed.code, 1);
  assertStringIncludes(removed.logs, "package.json has no @zuke/docker.");
  assertEquals(host.npmRuns[1].args, [
    "uninstall",
    "--ignore-scripts",
    "@zuke/docker",
  ]);

  const dry = await collect((log) =>
    runDependencies(
      "add",
      ["gh", "--dry-run"],
      log,
      host,
      PLAIN_PAINT,
      ROOT,
      nodeProbe,
    )
  );
  assertEquals(dry.code, 0);
  assertStringIncludes(
    dry.logs,
    "npm install --ignore-scripts @zuke/gh@npm:@zuke-build/gh@^1",
  );
  assertEquals(host.npmRuns.length, 2);

  host.exit = 7;
  const failed = await collect((log) =>
    runDependencies("add", ["gh"], log, host, PLAIN_PAINT, ROOT, nodeProbe)
  );
  assertEquals(failed.code, 7);
  assertStringIncludes(failed.logs, "npm install exited 7");
  await assertRejects(() =>
    runDependencies(
      "add",
      ["@std/yaml"],
      () => {},
      host,
      PLAIN_PAINT,
      ROOT,
      nodeProbe,
    )
  );
});

Deno.test("zuke cache runs npm ci over a Node project's lock, or npm install without one", async () => {
  const host = new FakeProjectHost();
  const run = (args: string[]) =>
    collect((log) => runCache(args, log, host, PLAIN_PAINT, ROOT, nodeProbe));
  assertEquals((await run([])).code, 0);
  host.files.set(`${ROOT}/package-lock.json`, "{}");
  assertEquals((await run([])).code, 0);
  assertEquals(host.npmRuns.map((r) => r.args), [
    ["install", "--ignore-scripts"],
    ["ci", "--ignore-scripts"],
  ]);
  assertStringIncludes(
    (await run(["--dry-run"])).logs,
    "npm ci --ignore-scripts",
  );
  host.exit = 2;
  const failed = await run([]);
  assertEquals(failed.code, 2);
  assertStringIncludes(failed.logs, "npm ci exited 2");
  await assertRejects(() => run(["main.ts"]), Error, "only --dry-run");
  await assertRejects(
    () => run(["--min-dep-age", "0"]),
    Error,
    "only --dry-run",
  );
  assertEquals(host.runs, []);
});

Deno.test("zuke relock regenerates a Node project's package-lock.json behind a backup", async () => {
  const lock = `${ROOT}/package-lock.json`;
  const backup = `${lock}.relock-backup`;
  const host = new FakeProjectHost();
  const run = (args: string[] = []) =>
    collect((log) => runRelock(args, log, host, PLAIN_PAINT, ROOT, nodeProbe));
  host.files.set(lock, "old");
  host.writes = { [lock]: "new" };
  const ok = await run();
  assertEquals(ok.code, 0, ok.logs);
  assertEquals(host.npmRuns[0].args, [
    "install",
    "--package-lock-only",
    "--ignore-scripts",
  ]);
  assertEquals(host.files.get(lock), "new");
  assertEquals(host.files.has(backup), false);
  // npm found the lock emptied in place, not removed, so a link stays one;
  // an unreadable lock takes npm's current format.
  assertEquals(JSON.parse(host.npmSaw[0].get(lock) ?? ""), {
    lockfileVersion: 3,
    packages: {},
  });

  // A failed npm puts the old lock back and drops the backup.
  host.writes = {};
  host.exit = 1;
  const failed = await run();
  assertEquals(failed.code, 1);
  assertStringIncludes(failed.logs, "package-lock.json is unchanged");
  assertEquals(host.files.get(lock), "new");
  assertEquals(host.files.has(backup), false);

  // The lock's own format version is kept.
  host.files.set(lock, '{ "lockfileVersion": 2, "packages": { "x": {} } }');
  await run();
  assertEquals(JSON.parse(host.npmSaw.at(-1)?.get(lock) ?? ""), {
    lockfileVersion: 2,
    packages: {},
  });
  host.files.set(lock, "new");

  // So does one that throws.
  host.throws = new Error("spawn failed");
  await assertRejects(() => run(), Error, "spawn failed");
  assertEquals(host.files.get(lock), "new");
  assertEquals(host.files.has(backup), false);
  host.throws = undefined;

  // A first lock has nothing to back up.
  host.files.delete(lock);
  host.exit = 0;
  host.writes = { [lock]: "first" };
  assertEquals((await run()).code, 0);
  assertEquals(host.files.get(lock), "first");

  // A backup left by an unfinished run stops the next one.
  host.files.set(backup, "older");
  await assertRejects(() => run(), Error, "did not finish");
  assertEquals(host.files.get(lock), "first");

  host.files.delete(backup);
  assertStringIncludes(
    (await run(["--dry-run"])).logs,
    "npm install --package-lock-only",
  );
  await assertRejects(
    () => run(["--min-dep-age", "0"]),
    Error,
    "only --dry-run",
  );
  assertEquals(host.runs, []);
});
