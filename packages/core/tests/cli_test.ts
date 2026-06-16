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
  assertEquals(parseArgs(["--graph"]).graph, true);
  assertEquals(parseArgs(["--help"]).help, true);
  assertEquals(parseArgs(["-h"]).help, true);
});

Deno.test("parseArgs recognises the graph command and its options", () => {
  const parsed = parseArgs(["graph", "--out", "g.html", "--no-open"]);
  assertEquals(parsed.graphHtml, true);
  assertEquals(parsed.target, undefined);
  assertEquals(parsed.out, "g.html");
  assertEquals(parsed.open, false);
});

Deno.test("parseArgs defaults open to true and graphHtml to false", () => {
  const parsed = parseArgs(["build"]);
  assertEquals(parsed.graphHtml, false);
  assertEquals(parsed.open, true);
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

Deno.test("main --list and --graph return 0", async () => {
  const list = await capture(() => main(Demo, ["--list"]));
  assertEquals(list.code, 0);
  assertEquals(list.out.join("\n").includes("Targets:"), true);

  const graph = await capture(() => main(Demo, ["--graph"]));
  assertEquals(graph.code, 0);
  assertEquals(graph.out.join("\n").includes("Dependency graph:"), true);
});

Deno.test("main graph command renders HTML via the injected host", async () => {
  const host = new FakeGraphHost("/repo", [`/repo/${CONFIG_FILE}`]);
  const { code } = await capture(() =>
    main(Demo, ["graph", "--no-open"], host)
  );
  assertEquals(code, 0);
  assertEquals(host.files.has("/repo/.zuke/graph.html"), true);
  assertEquals(host.opened, []);
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
