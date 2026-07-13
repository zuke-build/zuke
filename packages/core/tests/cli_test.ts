import { assertEquals, assertStringIncludes } from "./_assert.ts";
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
import { parameter } from "../src/params.ts";
import { BUILTIN_FLAGS, RESERVED_COMMANDS } from "../src/cli_spec.ts";

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
async function capture(
  fn: () => Promise<number> | number,
): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => void out.push(args.join(" "));
  console.error = (...args: unknown[]) => void err.push(args.join(" "));
  try {
    const code = await fn();
    return { code, out, err };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

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

Deno.test("parseArgs collects declared parameter flags", () => {
  const valued = parseArgs(
    ["greet", "--environment", "prod", "--verbose"],
    greetFlags,
  );
  assertEquals(valued.target, "greet");
  assertEquals(valued.values, { environment: "prod", verbose: "true" });

  const inline = parseArgs(["--environment=dev"], greetFlags);
  assertEquals(inline.values, { environment: "dev" });

  // Unknown flags are ignored, not treated as parameters.
  assertEquals(parseArgs(["--nope", "x"], greetFlags).values, {});
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
  const home = await Deno.makeTempDir();
  try {
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
  } finally {
    await Deno.remove(home, { recursive: true });
  }
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
