// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "./_assert.ts";
import { Build, cicd, group, type Plugin, target } from "../mod.ts";
import {
  formatGraph,
  formatHelp,
  formatList,
  main,
  parseArgs,
  run,
} from "../src/cli.ts";
import { discoverGroups, discoverTargets } from "../src/build.ts";
import { FakeGraphHost } from "./_fakes.ts";
import { CONFIG_FILE } from "../src/config.ts";
import { discoverParameters, parameter } from "../src/params.ts";
import { BUILTIN_FLAGS, RESERVED_COMMANDS } from "../src/cli_spec.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost } from "../src/state/store.ts";
import type { RunRecord } from "../src/state/types.ts";
import { withTemp } from "./_temp.ts";
import { capture } from "./_console.ts";

/** A minimal valid run record for the `runs` command tests. */
function sampleRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: overrides.id ?? "run-z",
    build: overrides.build ?? "Demo",
    rootTarget: overrides.rootTarget ?? "build",
    status: overrides.status ?? "succeeded",
    actor: overrides.actor ?? "alice",
    createdAt: overrides.createdAt ?? "2026-07-17T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-17T10:00:00.000Z",
    graph: overrides.graph ?? [{ name: "build", dependsOn: [] }],
    params: overrides.params ?? {},
    targets: overrides.targets ?? { build: { status: "succeeded", meta: {} } },
    signals: overrides.signals ?? {},
    events: overrides.events ?? [],
    degraded: overrides.degraded,
  };
}

/** A build with declared parameters, for the parameter-aware CLI tests. */
class Parameterised extends Build {
  environment = parameter("Target environment").options("dev", "prod")
    .required();
  verbose = parameter("Verbose logging").boolean();
  greet = target().executes(() => {
    console.log(`env=${this.environment.value} verbose=${this.verbose.value}`);
  });
}

const greetFlags = [
  { name: "environment", flag: "environment", boolean: false, array: false },
  { name: "verbose", flag: "verbose", boolean: true, array: false },
];

/** Run `fn` with `console.log`/`console.error` captured instead of printed. */
class Demo extends Build {
  clean = target().description("Clean").executes(() => {});
  build = target().description("Build").dependsOn(this.clean).executes(
    () => {},
  );
}

Deno.test("parseArgs reads a positional target", () => {
  assertEquals(parseArgs(["build"]).target, "build");
});

Deno.test("parseArgs recognises flags and aliases", () => {
  assertEquals(parseArgs(["--list"]).list, true);
  assertEquals(parseArgs(["-l"]).list, true);
  assertEquals(parseArgs(["--help"]).help, true);
  assertEquals(parseArgs(["-h"]).help, true);
});

Deno.test("parseArgs recognises the graph command and its output formats", () => {
  const text = parseArgs(["graph"]);
  assertEquals([text.graph, text.output, text.target], [
    true,
    "text",
    undefined,
  ]);

  const eq = parseArgs(["graph", "--output=html", "--no-open"]);
  assertEquals([eq.graph, eq.output, eq.open], [true, "html", false]);

  const spaced = parseArgs(["graph", "--output", "html"]);
  assertEquals(spaced.output, "html");

  // An unknown format falls back to text.
  assertEquals(parseArgs(["graph", "--output=svg"]).output, "text");
});

Deno.test("parseArgs defaults graph to false, output to text, open to true", () => {
  const parsed = parseArgs(["build"]);
  assertEquals([parsed.graph, parsed.output, parsed.open], [
    false,
    "text",
    true,
  ]);
});

Deno.test("parseArgs reads the --json flag, defaulting to false", () => {
  assertEquals(parseArgs(["build"]).json, false);
  assertEquals(parseArgs(["--list", "--json"]).json, true);
  assertEquals(parseArgs(["--json"]).json, true);
});

Deno.test("main --json prints the build surface as JSON", async () => {
  const { code, out } = await capture(() => main(Demo, ["--list", "--json"]));
  assertEquals(code, 0);
  const surface = JSON.parse(out.join("\n"));
  assertEquals(surface.targets.map((t: { name: string }) => t.name), [
    "clean",
    "build",
  ]);
  assertEquals(surface.commands.length > 0, true);
  assertEquals(surface.flags.length > 0, true);
});

Deno.test("parseArgs reads the completions sub-action and shell", () => {
  const print = parseArgs(["completions", "print", "zsh"]);
  assertEquals(
    [print.completions, print.completionsAction, print.shell, print.target],
    [true, "print", "zsh", undefined],
  );

  const install = parseArgs(["completions", "install", "fish"]);
  assertEquals([install.completionsAction, install.shell], ["install", "fish"]);

  // The first positional is always the sub-action, so a bare shell lands there
  // (an invalid action) and main() reports the misuse.
  const bareShell = parseArgs(["completions", "bash"]);
  assertEquals([bareShell.completionsAction, bareShell.shell], [
    "bash",
    undefined,
  ]);

  // No sub-action at all.
  const bare = parseArgs(["completions"]);
  assertEquals([bare.completions, bare.completionsAction], [true, undefined]);

  // Defaults when the command is absent.
  assertEquals(parseArgs(["build"]).completions, false);
});

Deno.test("every reserved command is honoured by the parser and help", () => {
  const targets = discoverTargets(new Demo());
  const help = formatHelp(targets);
  for (const command of RESERVED_COMMANDS) {
    // The registry and the parser agree: a reserved command is never a target.
    assertEquals(parseArgs([command.name]).target, undefined);
    // …and it is documented, so a new command can't be added without help.
    assertStringIncludes(help, command.name);
  }
  for (const flag of BUILTIN_FLAGS) assertStringIncludes(help, flag.name);
});

Deno.test("parseArgs accumulates --allowed-origin (repeatable and comma-list)", () => {
  const p = parseArgs([
    "mcp",
    "--allowed-origin",
    "https://a.example",
    "--allowed-origin=https://b.example,https://c.example",
  ]);
  assertEquals(p.allowedOrigins, [
    "https://a.example",
    "https://b.example",
    "https://c.example",
  ]);
  // Absent by default.
  assertEquals(parseArgs(["mcp"]).allowedOrigins, undefined);
  // The inline form also works as the first (only) occurrence.
  assertEquals(
    parseArgs(["mcp", "--allowed-origin=https://solo.example"]).allowedOrigins,
    ["https://solo.example"],
  );
});

Deno.test("parseArgs recognises the doc command and its spec", () => {
  const p = parseArgs(["doc", "jsr:@zuke/deno"]);
  assertEquals(p.doc, true);
  assertEquals(p.docSpec, "jsr:@zuke/deno");
  assertEquals(p.target, undefined); // a command, not a target
});

Deno.test("main doc runs the doc runner with the spec and passes its exit code", async () => {
  const seen: string[] = [];
  const runner = (spec: string) => {
    seen.push(spec);
    return Promise.resolve(0);
  };
  const { code } = await capture(() =>
    main(Demo, ["doc", "jsr:@zuke/deno"], { docRunner: runner })
  );
  assertEquals(code, 0);
  assertEquals(seen, ["jsr:@zuke/deno"]);
});

Deno.test("main doc resolves a relative spec to an absolute path before running", async () => {
  const seen: string[] = [];
  const runner = (spec: string) => {
    seen.push(spec);
    return Promise.resolve(0);
  };
  // Both a dot-prefixed and a bare relative file path resolve against cwd…
  await capture(() => main(Demo, ["doc", "./mod.ts"], { docRunner: runner }));
  await capture(() => main(Demo, ["doc", "src/lib.ts"], { docRunner: runner }));
  // …while a URL and an absolute path pass through unchanged.
  await capture(() => main(Demo, ["doc", "npm:cowsay"], { docRunner: runner }));
  await capture(() =>
    main(Demo, ["doc", "/abs/mod.ts"], { docRunner: runner })
  );
  // A Windows drive-absolute path is absolute, not a URL scheme to resolve.
  await capture(() =>
    main(Demo, ["doc", "C:/mods/mod.ts"], { docRunner: runner })
  );
  assertEquals(seen, [
    `${Deno.cwd()}/./mod.ts`,
    `${Deno.cwd()}/src/lib.ts`,
    "npm:cowsay",
    "/abs/mod.ts",
    "C:/mods/mod.ts",
  ]);
});

Deno.test("main doc reports a non-Error rejection from the runner", async () => {
  const { code, err } = await capture(() =>
    main(Demo, ["doc", "jsr:@zuke/x"], {
      // A non-Error rejection still surfaces as a friendly message.
      docRunner: () => Promise.reject("doc blew up"),
    })
  );
  assertEquals(code, 1);
  assertStringIncludes(err.join("\n"), "doc blew up");
});

Deno.test("main doc returns a friendly non-zero exit when the runner throws", async () => {
  const { code, err } = await capture(() =>
    main(Demo, ["doc", "jsr:@zuke/deno"], {
      docRunner: () => Promise.reject(new Error("deno doc exploded")),
    })
  );
  assertEquals(code, 1);
  assertStringIncludes(err.join("\n"), "deno doc exploded"); // not a raw stack
});

Deno.test("main doc propagates the runner's non-zero exit code", async () => {
  const { code } = await capture(() =>
    main(Demo, ["doc", "jsr:@zuke/x"], { docRunner: () => Promise.resolve(3) })
  );
  assertEquals(code, 3);
});

Deno.test("main doc without a spec prints usage and fails", async () => {
  const { code, err } = await capture(() => main(Demo, ["doc"]));
  assertEquals(code, 1);
  assertStringIncludes(err.join("\n"), "Usage: zuke doc");
});

Deno.test("parseArgs collects declared parameter flags", () => {
  const valued = parseArgs(
    ["greet", "--environment", "prod", "--verbose"],
    greetFlags,
  );
  assertEquals(valued.target, "greet");
  assertEquals(valued.values, { environment: "prod", verbose: "true" });

  const inline = parseArgs(["--environment=dev"], greetFlags);
  assertEquals(inline.values, { environment: "dev" });

  // An unrecognized flag is rejected, not silently treated as absent.
  assertThrows(() => parseArgs(["--nope", "x"], greetFlags), Error, "--nope");
});

Deno.test("parseArgs rejects an unknown flag with a did-you-mean suggestion", () => {
  const error = assertThrows(
    () => parseArgs(["build", "--dry-rn"]),
    Error,
    '"--dry-rn"',
  );
  assertStringIncludes(error.message, 'Did you mean "--dry-run"?');
});

Deno.test("parseArgs rejects an unknown flag with no near match, no suggestion offered", () => {
  const error = assertThrows(
    () => parseArgs(["build", "--no-such-flag"]),
    Error,
    '"--no-such-flag"',
  );
  assertEquals(error.message.includes("Did you mean"), false);
});

Deno.test("parseArgs accepts every flag it advertises in help", () => {
  // Now that an unknown flag is fatal, a flag listed in cli_spec.ts without a
  // parser branch would be advertised in help and completions and then hard
  // rejected. Every entry must parse.
  const rejected = BUILTIN_FLAGS.filter((flag) => {
    try {
      parseArgs([flag.name]);
      return false;
    } catch {
      return true;
    }
  }).map((flag) => flag.name);
  assertEquals(rejected, []);
});

Deno.test("parseArgs rejects --builtin=value naming the real fix, not itself", () => {
  // Fifteen built-ins take no inline value, so `--skip=lint` never parsed. It
  // must not suggest "--skip" as the fix for "--skip".
  for (const arg of ["--skip=lint", "--dry-run=true", "--json=1"]) {
    const flag = arg.slice(0, arg.indexOf("="));
    const error = assertThrows(() => parseArgs(["build", arg]), Error, arg);
    assertStringIncludes(error.message, `"${flag}" is a flag`);
    assertStringIncludes(error.message, 'does not take an inline "=value"');
    assertEquals(error.message.includes("Did you mean"), false);
  }
  // The built-ins that *do* accept `=value` keep working.
  assertEquals(parseArgs(["graph", "--output=html"]).output, "html");
  assertEquals(parseArgs(["build", "--actor=bo"]).actor, "bo");
  assertEquals(parseArgs(["build", "--affected=main"]).affectedBase, "main");
  assertEquals(parseArgs(["build", "--parallel=2"]).parallel, 2);
});

Deno.test("parseArgs lets --help win over an unknown flag", () => {
  // Help is exactly what someone who mistyped a flag is asking for, so it must
  // not be pre-empted by the rejection.
  assertEquals(parseArgs(["--help", "--bogus"]).help, true);
  assertEquals(parseArgs(["--bogus", "--help"]).help, true);
  assertEquals(parseArgs(["build", "-h", "--dry-rn"]).help, true);
});

Deno.test("parseArgs skips a bare -- argument separator", () => {
  // Wrappers insert one on their own; it is not an unknown flag.
  assertEquals(parseArgs(["--", "build"]).target, "build");
  assertEquals(parseArgs(["build", "--"]).target, "build");
  assertEquals(parseArgs(["--"]).target, undefined);
});

Deno.test("parseArgs still accepts a declared parameter flag", () => {
  assertEquals(
    parseArgs(["greet", "--environment", "prod"], greetFlags).values,
    { environment: "prod" },
  );
});

Deno.test("parseArgs reads the --parallel flag and count", () => {
  assertEquals(parseArgs(["build", "--parallel"]).parallel, true);
  assertEquals(parseArgs(["build", "--parallel=4"]).parallel, 4);
  assertEquals(parseArgs(["build", "--parallel=bad"]).parallel, true);
  assertEquals(parseArgs(["build"]).parallel, undefined);
});

Deno.test("parseArgs reads --dry-run, defaulting to false", () => {
  assertEquals(parseArgs(["build"]).dryRun, false);
  assertEquals(parseArgs(["build", "--dry-run"]).dryRun, true);
});

Deno.test("parseArgs reads --state and --actor", () => {
  assertEquals(parseArgs(["build"]).state, false);
  assertEquals(parseArgs(["build"]).actor, undefined);
  assertEquals(parseArgs(["build", "--state"]).state, true);
  assertEquals(parseArgs(["build", "--actor", "alice"]).actor, "alice");
  assertEquals(parseArgs(["build", "--actor=bob"]).actor, "bob");
  // An empty space-form value (an unset shell variable) is dropped as absent —
  // unlike --keep/--limit, which capture it so their validator can reject it.
  assertEquals(parseArgs(["build", "--actor", ""]).actor, undefined);
  // The inline form has no such guard: `--actor=` is an explicit empty value.
  assertEquals(parseArgs(["build", "--actor="]).actor, "");
});

Deno.test("parseArgs reads resume with its run id, signal, data, and flags", () => {
  const p = parseArgs([
    "resume",
    "run-9",
    "--signal",
    "approved",
    "--data",
    '{"by":"qa"}',
    "--force-graph",
    // A registered builtin: the parser must accept it, not reject it as unknown.
    "--resume-degraded",
  ]);
  assertEquals(p.resume, true);
  assertEquals(p.resumeRunId, "run-9");
  assertEquals(p.signal, "approved");
  assertEquals(p.data, '{"by":"qa"}');
  assertEquals(p.forceGraph, true);
  assertEquals(p.resumeDegraded, true);
  assertEquals(parseArgs(["resume", "run-9"]).resumeDegraded, false);

  const check = parseArgs(["resume", "--check"]);
  assertEquals(check.resume, true);
  assertEquals(check.check, true);
  assertEquals(check.resumeRunId, undefined);
});

Deno.test("parseArgs reads the runs command, sub-action, id, and filters", () => {
  assertEquals(parseArgs(["runs"]).runs, true);
  assertEquals(parseArgs(["build"]).runs, false);

  const list = parseArgs([
    "runs",
    "list",
    "--status",
    "failed",
    "--target",
    "deploy",
    "--since",
    "2026-01-01",
    "--limit",
    "5",
  ]);
  assertEquals(
    [
      list.runs,
      list.runsAction,
      list.runStatus,
      list.runTarget,
      list.since,
      list.runLimit,
    ],
    [true, "list", "failed", "deploy", "2026-01-01", "5"],
  );

  const show = parseArgs(["runs", "show", "run-9"]);
  assertEquals([show.runsAction, show.runsRunId], ["show", "run-9"]);

  // prune flags, space form.
  const prune = parseArgs([
    "runs",
    "prune",
    "--keep",
    "90d",
    "--keep-last",
    "50",
  ]);
  assertEquals([prune.runsAction, prune.keep, prune.keepLast], [
    "prune",
    "90d",
    "50",
  ]);

  // Inline `=` forms of the filters and prune flags.
  const eq = parseArgs([
    "runs",
    "list",
    "--status=succeeded",
    "--target=t",
    "--since=x",
    "--limit=3",
  ]);
  assertEquals([eq.runStatus, eq.runTarget, eq.since, eq.runLimit], [
    "succeeded",
    "t",
    "x",
    "3",
  ]);
  const eqPrune = parseArgs(["runs", "prune", "--keep=30d", "--keep-last=10"]);
  assertEquals([eqPrune.keep, eqPrune.keepLast], ["30d", "10"]);

  // An explicit empty value (e.g. `--keep "$UNSET"`) is captured, not dropped,
  // so it is validated and rejected rather than silently weakening prune.
  const empty = parseArgs(["runs", "prune", "--keep", "", "--keep-last", "5"]);
  assertEquals([empty.keep, empty.keepLast], ["", "5"]);
});

Deno.test("main: runs list reads persisted runs; --json emits run data", async () => {
  await withTemp(async (dir) => {
    const store = new FileSystemStateStore(dir, defaultStateHost);
    await store.putRun(sampleRunRecord({ id: "run-z" }), null);
    class Stateful extends Build {
      override stateStore() {
        return store;
      }
      build = target().executes(() => {});
    }

    const list = await capture(() => main(Stateful, ["runs", "list"]));
    assertEquals(list.code, 0);
    assertStringIncludes(list.out.join("\n"), "run-z");

    // --json must emit the run summaries, not the build surface.
    const json = await capture(() =>
      main(Stateful, ["runs", "list", "--json"])
    );
    assertEquals(json.code, 0);
    const summaries = JSON.parse(json.out.join("\n"));
    assertEquals(Array.isArray(summaries), true);
    assertEquals(summaries[0].id, "run-z");

    const show = await capture(() => main(Stateful, ["runs", "show", "run-z"]));
    assertEquals(show.code, 0);
    assertStringIncludes(show.out.join("\n"), "Run run-z");
  });
});

Deno.test("main: runs list rejects an unknown --status", async () => {
  const { code, err } = await capture(() =>
    main(Demo, ["runs", "list", "--status", "bogus"])
  );
  assertEquals(code, 1);
  assertStringIncludes(err.join("\n"), 'unknown --status "bogus"');
});

Deno.test("main: runs prune validates --limit, --keep, and --keep-last", async () => {
  const badLimit = await capture(() =>
    main(Demo, ["runs", "list", "--limit", "nope"])
  );
  assertEquals(badLimit.code, 1);
  assertStringIncludes(badLimit.err.join("\n"), "--limit must be a positive");

  const badKeep = await capture(() =>
    main(Demo, ["runs", "prune", "--keep", "banana"])
  );
  assertEquals(badKeep.code, 1);
  assertStringIncludes(badKeep.err.join("\n"), "--keep");

  const badKeepLast = await capture(() =>
    main(Demo, ["runs", "prune", "--keep-last", "-1"])
  );
  assertEquals(badKeepLast.code, 1);
  assertStringIncludes(badKeepLast.err.join("\n"), "--keep-last must be");

  // An empty --keep (an unset CI variable) errors rather than silently pruning
  // with only the other rule — it must not be treated as "no age window".
  const emptyKeep = await capture(() =>
    main(Demo, ["runs", "prune", "--keep", "", "--keep-last", "5"])
  );
  assertEquals(emptyKeep.code, 1);
  assertStringIncludes(emptyKeep.err.join("\n"), "--keep");
});

Deno.test("main: runs prune deletes eligible runs through the CLI", async () => {
  await withTemp(async (dir) => {
    const store = new FileSystemStateStore(dir, defaultStateHost);
    await store.putRun(
      sampleRunRecord({
        id: "old",
        status: "succeeded",
        createdAt: "2020-01-01T00:00:00.000Z",
      }),
      null,
    );
    class Stateful extends Build {
      override stateStore() {
        return store;
      }
      build = target().executes(() => {});
    }
    const ok = await capture(() =>
      main(Stateful, ["runs", "prune", "--keep", "1d"])
    );
    assertEquals(ok.code, 0);
    assertStringIncludes(ok.out.join("\n"), "Pruned 1 run");
    assertEquals(await store.getRun("old"), null);
  });
});

Deno.test("parseArgs reads the mcp --http address", () => {
  assertEquals(parseArgs(["mcp", "--http", "7777"]).httpAddr, "7777");
  assertEquals(
    parseArgs(["mcp", "--http=127.0.0.1:8080"]).httpAddr,
    "127.0.0.1:8080",
  );
  assertEquals(parseArgs(["mcp"]).httpAddr, undefined);
});

Deno.test("parseArgs reads --max-concurrent-runs as a positive integer", () => {
  assertEquals(
    parseArgs(["mcp", "--registry", "--max-concurrent-runs", "8"])
      .maxConcurrentRuns,
    8,
  );
  assertEquals(
    parseArgs(["mcp", "--max-concurrent-runs=2"]).maxConcurrentRuns,
    2,
  );
  // Absent, or an invalid value, leaves it unset (the server default applies).
  assertEquals(parseArgs(["mcp"]).maxConcurrentRuns, undefined);
  assertEquals(
    parseArgs(["mcp", "--max-concurrent-runs=0"]).maxConcurrentRuns,
    undefined,
  );
  assertEquals(
    parseArgs(["mcp", "--max-concurrent-runs=x"]).maxConcurrentRuns,
    undefined,
  );
});

Deno.test("main: mcp --http rejects an invalid address", async () => {
  const { code, err } = await capture(() =>
    main(Demo, ["mcp", "--http", "nope"])
  );
  assertEquals(code, 1);
  assertStringIncludes(err.join("\n"), "invalid --http");
});

Deno.test("parseArgs reads --affected with an optional base", () => {
  assertEquals(parseArgs(["build"]).affected, false);
  assertEquals(parseArgs(["build", "--affected"]).affected, true);
  assertEquals(parseArgs(["build", "--affected"]).affectedBase, undefined);
  const based = parseArgs(["build", "--affected=origin/main"]);
  assertEquals(based.affected, true);
  assertEquals(based.affectedBase, "origin/main");
});

Deno.test("parseArgs reads --no-remote-cache, defaulting to undefined", () => {
  assertEquals(parseArgs(["build"]).remoteCache, undefined);
  assertEquals(parseArgs(["build", "--no-remote-cache"]).remoteCache, false);
});

Deno.test("parseArgs accumulates repeated list flags comma-joined", () => {
  const flags = [
    { name: "tags", flag: "tags", boolean: false, array: true },
  ];
  // Repeated flags join; scalar form and inline `=` both contribute.
  const repeated = parseArgs(["--tags", "a", "--tags", "b", "--tags=c"], flags);
  assertEquals(repeated.values, { tags: "a,b,c" });
  // A single occurrence is unchanged.
  assertEquals(parseArgs(["--tags", "solo"], flags).values, { tags: "solo" });
});

Deno.test("parseArgs collects repeatable --skip and keeps first positional", () => {
  const parsed = parseArgs([
    "build",
    "--skip",
    "clean",
    "--skip",
    "restore",
    "extra",
  ]);
  assertEquals(parsed.target, "build");
  assertEquals(parsed.skip, ["clean", "restore"]);
});

Deno.test("formatList shows targets, descriptions and dependencies", () => {
  const list = formatList(discoverTargets(new Demo()));
  assertEquals(list.includes("clean"), true);
  assertEquals(list.includes("Build"), true);
  assertEquals(list.includes("(depends on: clean)"), true);
});

Deno.test("formatGraph renders adjacency, formatHelp includes usage", () => {
  const targets = discoverTargets(new Demo());
  assertEquals(formatGraph(targets).includes("build → clean"), true);
  assertEquals(formatHelp(targets).includes("Usage:"), true);
});

Deno.test("formatGraph annotates group membership", () => {
  class B extends Build {
    checks = group();
    lint = target().partOf(this.checks).executes(() => {});
  }
  const b = new B();
  const targets = discoverTargets(b);
  discoverGroups(b);
  assertEquals(formatGraph(targets).includes("lint  [group: checks]"), true);
});

Deno.test("formatList hides unlisted targets but keeps the rest", () => {
  class B extends Build {
    visible = target().description("Shown").executes(() => {});
    helper = target().unlisted().executes(() => {});
  }
  const list = formatList(discoverTargets(new B()));
  assertEquals(list.includes("visible"), true);
  assertEquals(list.includes("helper"), false);
});

Deno.test("formatList/formatGraph handle an empty build", () => {
  class Empty extends Build {}
  const targets = discoverTargets(new Empty());
  assertEquals(formatList(targets), "No targets defined.");
  assertEquals(formatGraph(targets), "No targets defined.");
});

Deno.test("main --help prints usage and returns 0", async () => {
  const { code, out } = await capture(() => main(Demo, ["--help"]));
  assertEquals(code, 0);
  assertEquals(out.join("\n").includes("Usage:"), true);
});

Deno.test("main --list and graph (text) return 0", async () => {
  const list = await capture(() => main(Demo, ["--list"]));
  assertEquals(list.code, 0);
  assertEquals(list.out.join("\n").includes("Targets:"), true);

  const graph = await capture(() => main(Demo, ["graph"]));
  assertEquals(graph.code, 0);
  assertEquals(graph.out.join("\n").includes("Dependency graph:"), true);
});

Deno.test("main completions print writes a script for a valid shell", async () => {
  const { code, out } = await capture(() =>
    main(Demo, ["completions", "print", "bash"])
  );
  assertEquals(code, 0);
  assertStringIncludes(out.join("\n"), "complete -F _zuke_complete zuke");
});

Deno.test("main completions errors without a valid sub-action or shell", async () => {
  // No sub-action.
  const missing = await capture(() => main(Demo, ["completions"]));
  assertEquals(missing.code, 1);
  assertStringIncludes(missing.err.join("\n"), "Usage: zuke completions");

  // A bare shell with no sub-action is rejected (no implicit "print").
  const noAction = await capture(() => main(Demo, ["completions", "bash"]));
  assertEquals(noAction.code, 1);
  assertStringIncludes(noAction.err.join("\n"), "<install|print>");

  // Valid sub-action, unknown shell.
  const bad = await capture(() =>
    main(Demo, ["completions", "print", "powershell"])
  );
  assertEquals(bad.code, 1);
  assertStringIncludes(bad.err.join("\n"), "Usage: zuke completions");
});

Deno.test("main completions install wires up each shell and is idempotent", async () => {
  await withTemp(async (home) => {
    const install = (shell: string) =>
      capture(() =>
        main(Demo, ["completions", "install", shell], {
          // Ignore the runner's real XDG_CONFIG_HOME so paths are deterministic.
          installOptions: { home, env: () => undefined },
        })
      );

    const first = await install("bash");
    assertEquals(first.code, 0);
    assertStringIncludes(first.out.join("\n"), "Added a source line");

    // Re-running is a no-op on the rc file.
    const again = await install("bash");
    assertStringIncludes(again.out.join("\n"), "already sources it");

    // fish auto-loads from its completions dir, so no rc line is added.
    const fish = await install("fish");
    assertStringIncludes(fish.out.join("\n"), "Open a new shell");

    const script = await Deno.readTextFile(
      `${home}/.config/zuke/completions/zuke.bash`,
    );
    assertStringIncludes(script, "_zuke_complete");
  });
});

Deno.test("main completions install reports a failure as exit 1", async () => {
  // A regular file standing in for the home dir makes directory creation fail.
  const file = await Deno.makeTempFile();
  try {
    const { code, err } = await capture(() =>
      main(Demo, ["completions", "install", "zsh"], {
        installOptions: { home: file, env: () => undefined },
      })
    );
    assertEquals(code, 1);
    assertEquals(err.length > 0, true);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("main graph --output=html renders HTML via the injected host", async () => {
  const host = new FakeGraphHost("/repo", [`/repo/${CONFIG_FILE}`]);
  const { code } = await capture(() =>
    main(Demo, ["graph", "--output=html", "--no-open"], { graphHost: host })
  );
  assertEquals(code, 0);
  assertEquals(host.files.has("/repo/.zuke/graph.html"), true);
  assertEquals(host.opened, []);
});

Deno.test("main lists declared parameters under --help and --list", async () => {
  const help = await capture(() => main(Parameterised, ["--help"]));
  const text = help.out.join("\n");
  assertEquals(text.includes("Parameters:"), true);
  assertEquals(text.includes("--environment"), true);
  assertEquals(text.includes("required"), true);
  assertEquals(text.includes("one of: dev, prod"), true);
});

Deno.test("main resolves a parameter flag and runs the target", async () => {
  const { code, out } = await capture(() =>
    main(Parameterised, ["greet", "--environment", "dev", "--verbose"])
  );
  assertEquals(code, 0);
  assertEquals(out.join("\n").includes("env=dev verbose=true"), true);
});

Deno.test("main fails with exit 1 when a required parameter is missing", async () => {
  // Ensure the value can't leak in from the ambient environment.
  const saved = Deno.env.get("ENVIRONMENT");
  Deno.env.delete("ENVIRONMENT");
  try {
    const { code, err } = await capture(() => main(Parameterised, ["greet"]));
    assertEquals(code, 1);
    assertEquals(err.join("\n").includes("--environment is required"), true);
  } finally {
    if (saved !== undefined) Deno.env.set("ENVIRONMENT", saved);
  }
});

Deno.test("main runs a target and its dependencies, returning 0", async () => {
  const log: string[] = [];
  class Tracked extends Build {
    a = target().executes(() => void log.push("a"));
    b = target().dependsOn(this.a).executes(() => void log.push("b"));
  }
  const { code } = await capture(() => main(Tracked, ["b"]));
  assertEquals(code, 0);
  assertEquals(log, ["a", "b"]);
});

Deno.test("main runs targets in parallel and returns 0", async () => {
  const log: string[] = [];
  class Par extends Build {
    a = target().executes(() => void log.push("a"));
    b = target().executes(() => void log.push("b"));
    all = target().dependsOn(this.a, this.b).executes(() =>
      void log.push("all")
    );
  }
  const { code } = await capture(() => main(Par, ["all", "--parallel=2"]));
  assertEquals(code, 0);
  assertEquals(log[log.length - 1], "all"); // dependents still run last
  assertEquals(log.includes("a") && log.includes("b"), true);
});

Deno.test("main runs the default target when none is named", async () => {
  const log: string[] = [];
  class WithDefault extends Build {
    work = target().executes(() => void log.push("work"));
    default = target().dependsOn(this.work).executes(() => {});
  }
  const { code } = await capture(() => main(WithDefault, []));
  assertEquals(code, 0);
  assertEquals(log, ["work"]);
});

Deno.test("main with no target and no default lists targets, returns 0", async () => {
  const { code, out } = await capture(() => main(Demo, []));
  assertEquals(code, 0);
  assertEquals(out.join("\n").includes("Targets:"), true);
});

Deno.test("main reports an unknown target and returns 1", async () => {
  const { code, err } = await capture(() => main(Demo, ["nope"]));
  assertEquals(code, 1);
  assertEquals(err.join("\n").includes("Unknown target: nope"), true);
  assertEquals(err.join("\n").includes("Did you mean"), false);
});

Deno.test("main suggests the nearest target for a typo", async () => {
  // cspell:ignore biuld
  // Same courtesy an unknown flag gets.
  const { code, err } = await capture(() => main(Demo, ["biuld"]));
  assertEquals(code, 1);
  assertStringIncludes(err.join("\n"), "Unknown target: biuld.");
  assertStringIncludes(err.join("\n"), 'Did you mean "build"?');
});

Deno.test("main prints help when an unknown flag is on the line too", async () => {
  const { code, out } = await capture(() => main(Demo, ["--help", "--bogus"]));
  assertEquals(code, 0);
  assertStringIncludes(out.join("\n"), "Usage:");
});

Deno.test("main reports a dependency cycle and returns 1", async () => {
  class Cyclic extends Build {
    a = target().executes(() => {});
    b = target().executes(() => {});
    constructor() {
      super();
      this.a.dependsOn(this.b);
      this.b.dependsOn(this.a);
    }
  }
  const { code, err } = await capture(() => main(Cyclic, ["a"]));
  assertEquals(code, 1);
  assertEquals(err.join("\n").includes("cycle detected"), true);
});

Deno.test("main returns 1 when an executed target fails", async () => {
  class Failing extends Build {
    boom = target().executes(() => {
      throw new Error("explode");
    });
  }
  const { code, err } = await capture(() => main(Failing, ["boom"]));
  assertEquals(code, 1);
  assertEquals(err.join("\n").includes("explode"), true);
});

/** Sentinel thrown by the stubbed `Deno.exit` so control returns to the test. */
class ExitSignal extends Error {}

Deno.test("run() drives main and sets the process exit code", async () => {
  const origExit = Deno.exit;
  let captured: number | undefined;
  Deno.exit = (code?: number): never => {
    captured = code ?? 0;
    throw new ExitSignal();
  };
  const origLog = console.log;
  console.log = () => {};
  try {
    await run(Demo, { args: ["--list"] });
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e;
  } finally {
    Deno.exit = origExit;
    console.log = origLog;
  }
  assertEquals(captured, 0);
});

Deno.test("run() is a no-op when its module isn't the program entry", async () => {
  // Simulate the build file being imported (e.g. under test) rather than run
  // directly: point Deno.mainModule at a different module than this caller.
  const origExit = Deno.exit;
  const mainDesc = Object.getOwnPropertyDescriptor(Deno, "mainModule");
  let exited = false;
  let ran = false;
  Deno.exit = (_code?: number): never => {
    exited = true;
    throw new ExitSignal();
  };
  Object.defineProperty(Deno, "mainModule", {
    value: "file:///somewhere/else.ts",
    configurable: true,
  });
  class Demo2 extends Build {
    go = target().executes(() => void (ran = true));
  }
  try {
    await run(Demo2, { args: ["go"] });
  } finally {
    Deno.exit = origExit;
    if (mainDesc !== undefined) {
      Object.defineProperty(Deno, "mainModule", mainDesc);
    }
  }
  assertEquals(exited, false);
  assertEquals(ran, false);
});

Deno.test("main honours --skip", async () => {
  const log: string[] = [];
  class Tracked extends Build {
    setup = target().executes(() => void log.push("setup"));
    go = target().dependsOn(this.setup).executes(() => void log.push("go"));
  }
  const { code } = await capture(() =>
    main(Tracked, ["go", "--skip", "setup"])
  );
  assertEquals(code, 0);
  assertEquals(log, ["go"]);
});

// --- CI config generation (generate-ci command + on-run regeneration) ---

/** A build that declares a GitHub Actions workflow file. */
class CiBuild extends Build {
  ci = cicd({
    provider: "github",
    path: ".github/workflows/zuke.yml",
    pipeline: {
      name: "CI",
      triggers: { push: ["main"] },
      jobs: [{ id: "test", steps: [{ run: "deno task ci" }] }],
    },
  });
  build = target().executes(() => {});
}

/** Run `fn` with the process cwd set to a fresh temp dir, then clean up. */
async function inTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  const prev = Deno.cwd();
  Deno.chdir(dir);
  try {
    await fn(dir);
  } finally {
    Deno.chdir(prev);
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("parseArgs recognises the generate-ci command and --check", () => {
  const a = parseArgs(["generate-ci", "--check"]);
  assertEquals(a.generateCi, true);
  assertEquals(a.check, true);
  assertEquals(a.target, undefined);
});

Deno.test("main: generate-ci writes the declared CI file", async () => {
  await inTempDir(async (dir) => {
    const { code, out } = await capture(() => main(CiBuild, ["generate-ci"]));
    assertEquals(code, 0);
    const content = await Deno.readTextFile(
      `${dir}/.github/workflows/zuke.yml`,
    );
    assertStringIncludes(content, "name: CI");
    assertEquals(out.some((l) => l.includes("Generated")), true);
  });
});

Deno.test("main: generate-ci --check fails when the file is missing or stale", async () => {
  await inTempDir(async () => {
    const { code, err } = await capture(() =>
      main(CiBuild, ["generate-ci", "--check"])
    );
    assertEquals(code, 1);
    assertEquals(err.some((l) => l.includes("out of date")), true);
  });
});

Deno.test("main: generate-ci reports when no CI config is declared", async () => {
  const { code, out } = await capture(() => main(Demo, ["generate-ci"]));
  assertEquals(code, 0);
  assertEquals(out.some((l) => l.includes("No CI configuration")), true);
});

Deno.test("main: running a target keeps a current CI file in sync", async () => {
  await inTempDir(async (dir) => {
    // Pre-write the expected content so the on-run sync is a no-op regardless
    // of whether the tests themselves run on CI (check) or locally (write).
    const expected = new CiBuild().ci.render();
    await Deno.mkdir(`${dir}/.github/workflows`, { recursive: true });
    await Deno.writeTextFile(`${dir}/.github/workflows/zuke.yml`, expected);
    const { code } = await capture(() => main(CiBuild, ["build"]));
    assertEquals(code, 0);
    assertEquals(
      await Deno.readTextFile(`${dir}/.github/workflows/zuke.yml`),
      expected,
    );
  });
});

Deno.test("main: running a target fails on CI when the CI file has drifted", async () => {
  await inTempDir(async () => {
    const prev = Deno.env.get("GITHUB_ACTIONS");
    Deno.env.set("GITHUB_ACTIONS", "true"); // force isCI() → check mode
    try {
      const { code, err } = await capture(() => main(CiBuild, ["build"]));
      assertEquals(code, 1); // file is missing → stale → build fails
      assertEquals(err.some((l) => l.includes("out of date")), true);
    } finally {
      if (prev === undefined) Deno.env.delete("GITHUB_ACTIONS");
      else Deno.env.set("GITHUB_ACTIONS", prev);
    }
  });
});

Deno.test("main: --dry-run does not regenerate CI files", async () => {
  await inTempDir(async (dir) => {
    const { code } = await capture(() => main(CiBuild, ["build", "--dry-run"]));
    assertEquals(code, 0);
    // Nothing was written: the workflow file does not exist.
    await assertRejectsNotFound(`${dir}/.github/workflows/zuke.yml`);
  });
});

/** Assert that reading `path` rejects because the file is absent. */
async function assertRejectsNotFound(path: string): Promise<void> {
  let missing = false;
  try {
    await Deno.readTextFile(path);
  } catch (error) {
    missing = error instanceof Deno.errors.NotFound;
  }
  assertEquals(missing, true);
}

// --- Plugins via the CLI entry points ---

Deno.test("main forwards plugins to the build lifecycle", async () => {
  const seen: string[] = [];
  const plugin: Plugin = {
    onTargetEnd: (name, status) => void seen.push(`${name}:${status}`),
  };
  // Demo: `build` depends on `clean`, so both targets are observed.
  const { code } = await capture(() =>
    main(Demo, ["build"], { plugins: [plugin] })
  );
  assertEquals(code, 0);
  assertEquals(seen.includes("clean:passed"), true);
  assertEquals(seen.includes("build:passed"), true);
});

Deno.test("run forwards args and plugins to main", async () => {
  const seen: string[] = [];
  const plugin: Plugin = { onFinish: () => void seen.push("finished") };
  const origExit = Deno.exit;
  const origLog = console.log;
  let code: number | undefined;
  Deno.exit = (c?: number): never => {
    code = c;
    throw new ExitSignal();
  };
  console.log = () => {};
  try {
    await run(Demo, { args: ["build"], plugins: [plugin] });
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e;
  } finally {
    Deno.exit = origExit;
    console.log = origLog;
  }
  assertEquals(code, 0);
  assertEquals(seen, ["finished"]);
});

Deno.test("parseArgs reads the inline = forms of --signal and --data", () => {
  const p = parseArgs([
    "resume",
    "run-9",
    "--signal=approved",
    '--data={"by":"qa"}',
  ]);
  assertEquals(p.signal, "approved");
  assertEquals(p.data, '{"by":"qa"}');
});

Deno.test("parseArgs reads --allow-run globs and --protect lists", () => {
  // The comma list is trimmed and empties are dropped.
  const globbed = parseArgs(["mcp", "--allow-run=deploy-*, ,test"]);
  assertEquals(globbed.allowRun, true);
  assertEquals(globbed.allowRunPatterns, ["deploy-*", "test"]);
  // Bare --allow-run enables runs with no pattern restriction.
  const bare = parseArgs(["mcp", "--allow-run"]);
  assertEquals([bare.allowRun, bare.allowRunPatterns], [true, undefined]);

  const spaced = parseArgs(["mcp", "--protect", "prod-*"]);
  assertEquals(spaced.protectPatterns, ["prod-*"]);
  const inline = parseArgs(["mcp", "--protect=a,b"]);
  assertEquals(inline.protectPatterns, ["a", "b"]);
});

Deno.test("parseArgs treats an empty --parallel= value as plain --parallel", () => {
  assertEquals(parseArgs(["build", "--parallel="]).parallel, true);
});

Deno.test("main: resume without a run id prints usage and fails", async () => {
  const { code, err } = await capture(() => main(Demo, ["resume"]));
  assertEquals(code, 1);
  assertStringIncludes(err.join("\n"), "Usage: zuke resume <run-id>");
});

Deno.test("main: resume rejects invalid --data JSON without echoing it", async () => {
  const { code, err } = await capture(() =>
    main(Demo, ["resume", "run-x", "--data", "{oops"])
  );
  assertEquals(code, 1);
  const text = err.join("\n");
  assertStringIncludes(text, "--data is not valid JSON");
  // The payload could be large or sensitive; it must not be quoted back.
  assertEquals(text.includes("{oops"), false);
});

Deno.test("main: mcp --http refuses a non-loopback bind without a token", async () => {
  // The refusal happens before any socket is bound, so the test stays hermetic.
  const saved = Deno.env.get("ZUKE_MCP_TOKEN");
  Deno.env.delete("ZUKE_MCP_TOKEN");
  try {
    const { code, err } = await capture(() =>
      main(Demo, ["mcp", "--http", "0.0.0.0:8123"])
    );
    assertEquals(code, 1);
    assertStringIncludes(err.join("\n"), "refusing to bind");
  } finally {
    if (saved !== undefined) Deno.env.set("ZUKE_MCP_TOKEN", saved);
  }
});

Deno.test("main: cancel reports a missing run as a friendly error", async () => {
  await withTemp(async (dir) => {
    const store = new FileSystemStateStore(dir, defaultStateHost);
    class Stateful extends Build {
      override stateStore() {
        return store;
      }
      build = target().executes(() => {});
    }
    const { code, err } = await capture(() =>
      main(Stateful, ["cancel", "ghost"])
    );
    assertEquals(code, 1);
    assertStringIncludes(err.join("\n"), 'no run "ghost"');
  });
});

Deno.test("main: cancelling an already-finished run is a no-op exit 0", async () => {
  await withTemp(async (dir) => {
    const store = new FileSystemStateStore(dir, defaultStateHost);
    // A terminal (succeeded) run: cancel is documented as idempotent.
    await store.putRun(sampleRunRecord({ id: "done" }), null);
    class Stateful extends Build {
      override stateStore() {
        return store;
      }
      build = target().executes(() => {});
    }
    const { code } = await capture(() => main(Stateful, ["cancel", "done"]));
    assertEquals(code, 0);
    // The record stays succeeded — cancel did not rewrite history.
    const record = await store.getRun("done");
    assertEquals(record?.record.status, "succeeded");
  });
});

Deno.test("main: cancel exits 1 when a compensation fails", async () => {
  await withTemp(async (dir) => {
    const store = new FileSystemStateStore(dir, defaultStateHost);
    class Failing extends Build {
      override stateStore() {
        return store;
      }
      build = target().executes(() => {}).onCancel(() => this.rollback);
      rollback = target().executes(() => {
        throw new Error("rollback exploded");
      });
    }
    // A suspended run whose `build` target succeeded, so cancel compensates it.
    await store.putRun(
      sampleRunRecord({ id: "stuck", status: "suspended" }),
      null,
    );
    const { code } = await capture(() => main(Failing, ["cancel", "stuck"]));
    // The failed compensation surfaces non-zero so the operator notices…
    assertEquals(code, 1);
    // …but the run is still settled cancelled (cleanup is maximal).
    const record = await store.getRun("stuck");
    assertEquals(record?.record.status, "cancelled");
  });
});

Deno.test("run() defaults to Deno.args when no args option is given", async () => {
  const desc = Object.getOwnPropertyDescriptor(Deno, "args");
  const origExit = Deno.exit;
  const origLog = console.log;
  let captured: number | undefined;
  Object.defineProperty(Deno, "args", {
    value: ["--list"],
    configurable: true,
  });
  Deno.exit = (code?: number): never => {
    captured = code ?? 0;
    throw new ExitSignal();
  };
  console.log = () => {};
  try {
    await run(Demo); // no options at all: argv comes from Deno.args
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e;
  } finally {
    Deno.exit = origExit;
    console.log = origLog;
    if (desc !== undefined) Object.defineProperty(Deno, "args", desc);
  }
  assertEquals(captured, 0);
});

Deno.test("main: --no-remote-cache flows through and the run still passes", async () => {
  const log: string[] = [];
  class T extends Build {
    go = target().executes(() => void log.push("go"));
  }
  const { code } = await capture(() => main(T, ["go", "--no-remote-cache"]));
  assertEquals(code, 0);
  assertEquals(log, ["go"]);
});

Deno.test("formatGraph and formatList name an undiscovered dependency ?", () => {
  const anon = target().executes(() => {});
  class B extends Build {
    build = target().dependsOn(anon).executes(() => {});
  }
  const targets = discoverTargets(new B());
  assertStringIncludes(formatGraph(targets), "build → ?");
});

Deno.test("formatList renders a parameter declared without a description", () => {
  class B extends Build {
    quiet = parameter().boolean();
    go = target().executes(() => {});
  }
  const b = new B();
  const text = formatList(discoverTargets(b), discoverParameters(b));
  assertStringIncludes(text, "--quiet");
});

Deno.test("main: runs list applies --status, --target, and --since filters", async () => {
  await withTemp(async (dir) => {
    const store = new FileSystemStateStore(dir, defaultStateHost);
    await store.putRun(sampleRunRecord({ id: "ok-run" }), null);
    await store.putRun(
      sampleRunRecord({
        id: "old-fail",
        status: "failed",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
        rootTarget: "deploy",
        graph: [{ name: "deploy", dependsOn: [] }],
        targets: { deploy: { status: "failed", meta: {} } },
      }),
      null,
    );
    class Stateful extends Build {
      override stateStore() {
        return store;
      }
      build = target().executes(() => {});
    }
    const ids = async (...filters: string[]) => {
      const { code, out } = await capture(() =>
        main(Stateful, ["runs", "list", ...filters, "--json"])
      );
      assertEquals(code, 0);
      const rows: Array<{ id: string }> = JSON.parse(out.join("\n"));
      return rows.map((r) => r.id);
    };
    assertEquals(await ids("--status", "succeeded"), ["ok-run"]);
    assertEquals(await ids("--target", "deploy"), ["old-fail"]);
    assertEquals(await ids("--since", "2026-01-01T00:00:00.000Z"), ["ok-run"]);
    // --limit keeps the newest run only.
    assertEquals(await ids("--limit", "1"), ["ok-run"]);
  });
});

Deno.test("main: --affected rejects a git base that reads as a git option", async () => {
  // A base beginning with "-" would be read by git as an option (e.g.
  // `--output=…` writes to a file), so it is rejected before any git process
  // is spawned. The failure is not a configuration error main knows how to
  // present, so it propagates rather than being flattened into exit 1.
  const error = await assertRejects(() =>
    capture(() => main(Demo, ["build", "--affected=-o"]))
  );
  assertStringIncludes(error.message, "invalid git base revision");
});

Deno.test("main watchSignals: a signal cancels the run, a second force-exits", async () => {
  const handlers: Array<() => void> = [];
  const removed: Deno.Signal[] = [];
  const origAdd = Deno.addSignalListener;
  const origRemove = Deno.removeSignalListener;
  const origExit = Deno.exit;
  Deno.addSignalListener = (_sig: Deno.Signal, fn: () => void): void => {
    handlers.push(fn);
  };
  Deno.removeSignalListener = (sig: Deno.Signal, _fn: () => void): void => {
    removed.push(sig);
  };
  const ran: string[] = [];
  class Interrupted extends Build {
    first = target().executes(() => {
      ran.push("first");
      handlers[0](); // Ctrl-C arrives mid-build
    });
    second = target().dependsOn(this.first).executes(
      () => void ran.push("second"),
    );
  }
  try {
    const { code } = await capture(() =>
      main(Interrupted, ["second"], { watchSignals: true })
    );
    assertEquals(code, 1); // the run was cancelled, not completed
    assertEquals(ran, ["first"]); // `second` never started
    // Every installed handler was removed on the way out.
    assertEquals(removed.length, handlers.length);

    // A second signal while cancellation is in flight force-exits 130.
    let exitCode: number | undefined;
    Deno.exit = (code?: number): never => {
      exitCode = code;
      throw new ExitSignal();
    };
    try {
      handlers[0]();
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
    }
    assertEquals(exitCode, 130);
  } finally {
    Deno.addSignalListener = origAdd;
    Deno.removeSignalListener = origRemove;
    Deno.exit = origExit;
  }
});

Deno.test("main watchSignals: unsupported signals are skipped, teardown is best-effort", async () => {
  const origAdd = Deno.addSignalListener;
  const origRemove = Deno.removeSignalListener;
  let installed = 0;
  Deno.addSignalListener = (sig: Deno.Signal, _fn: () => void): void => {
    // A platform that rejects everything but SIGINT (e.g. SIGTERM on Windows).
    if (sig !== "SIGINT") throw new TypeError(`unsupported signal ${sig}`);
    installed++;
  };
  Deno.removeSignalListener = (): void => {
    throw new TypeError("teardown refused");
  };
  try {
    const { code } = await capture(() =>
      main(Demo, ["build"], { watchSignals: true })
    );
    // Neither the rejected install nor the failing teardown surfaces.
    assertEquals(code, 0);
    assertEquals(installed, 1);
  } finally {
    Deno.addSignalListener = origAdd;
    Deno.removeSignalListener = origRemove;
  }
});

Deno.test("main: resume rejects an oversized --data payload", async () => {
  const huge = JSON.stringify({ blob: "x".repeat(70_000) });
  const { code, err } = await capture(() =>
    main(Demo, ["resume", "run-x", "--data", huge])
  );
  assertEquals(code, 1);
  assertEquals(err.join("\n").includes("too large"), true);
});

Deno.test("main: resume rejects a multibyte --data payload over the byte budget", async () => {
  // 22k euro signs: ~22k UTF-16 code units (under the 64 KiB char length) but
  // ~66 KB of UTF-8 (over it). Measuring `.length` would wrongly let it through.
  const multibyte = JSON.stringify({ blob: "€".repeat(22_000) });
  assertEquals(multibyte.length < 64 * 1024, true); // under the cap by char count
  const { code, err } = await capture(() =>
    main(Demo, ["resume", "run-x", "--data", multibyte])
  );
  assertEquals(code, 1); // but over it in real bytes → rejected
  assertEquals(err.join("\n").includes("too large"), true);
});
