import { assertEquals } from "./_assert.ts";
import { Build, target } from "../mod.ts";
import {
  formatGraph,
  formatHelp,
  formatList,
  main,
  parseArgs,
  run,
} from "../src/cli.ts";
import { discoverTargets } from "../src/build.ts";
import { FakeGraphHost } from "./_fakes.ts";
import { CONFIG_FILE } from "../src/config.ts";
import { parameter } from "../src/params.ts";

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
  { name: "environment", flag: "environment", boolean: false },
  { name: "verbose", flag: "verbose", boolean: true },
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

Deno.test("main graph --output=html renders HTML via the injected host", async () => {
  const host = new FakeGraphHost("/repo", [`/repo/${CONFIG_FILE}`]);
  const { code } = await capture(() =>
    main(Demo, ["graph", "--output=html", "--no-open"], host)
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
    await run(Demo, ["--list"]);
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e;
  } finally {
    Deno.exit = origExit;
    console.log = origLog;
  }
  assertEquals(captured, 0);
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
