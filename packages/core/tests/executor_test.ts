import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  messageOf,
} from "./_assert.ts";
import { GraphError, type OrderingEdge } from "../src/graph.ts";
import {
  Build,
  type BuildResult,
  discoverTargets,
  type TargetStatus,
} from "../src/build.ts";
import { group, target, type TargetBuilder } from "../src/target.ts";
import type { BuildCache } from "../src/cache.ts";
import type { RemoteCacheStore } from "../src/remote_cache.ts";
import { parameter } from "../src/params.ts";

/** An in-memory {@link BuildCache} for executor caching tests. */
class FakeCache implements BuildCache {
  readonly fresh = new Set<string>();
  readonly recorded: string[] = [];
  saved = false;
  upToDate(t: { name_?: string }): Promise<boolean> {
    return Promise.resolve(this.fresh.has(t.name_ ?? ""));
  }
  record(t: { name_?: string }): Promise<void> {
    this.recorded.push(t.name_ ?? "");
    return Promise.resolve();
  }
  save(): Promise<void> {
    this.saved = true;
    return Promise.resolve();
  }
}
import {
  execute,
  type ExecuteOptions,
  type Reporter,
} from "../src/executor.ts";
import type { Plugin } from "../src/plugin.ts";
import { $ } from "../src/shell.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost } from "../src/state/store.ts";
import { LockConflictError } from "../src/state/lock.ts";
import { externalSignal, resumeWhen } from "../src/wait.ts";

const silent: ExecuteOptions = { silent: true };

/** `deno` — always present under the test runner, shell-free, cross-platform. */
const DENO = Deno.execPath();

/** A reporter that records every line, for asserting output. */
function recorder(): { lines: string[]; reporter: Reporter } {
  const lines: string[] = [];
  return {
    lines,
    reporter: {
      info: (line) => void lines.push(line),
      error: (line) => void lines.push(line),
    },
  };
}

/** Run `fn` with an environment variable temporarily set (or unset). */
async function withEnv(
  key: string,
  value: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = Deno.env.get(key);
  if (value === undefined) Deno.env.delete(key);
  else Deno.env.set(key, value);
  try {
    await fn();
  } finally {
    if (prev === undefined) Deno.env.delete(key);
    else Deno.env.set(key, prev);
  }
}

/**
 * Run `fn` with `console.log`/`console.error` silenced — for tests that drive
 * the default console reporter (so the job summary is written) but don't want
 * the banner output cluttering the test log.
 */
async function withSilencedConsole(fn: () => Promise<unknown>): Promise<void> {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

Deno.test("executes dependencies before dependents, in order", async () => {
  const log: string[] = [];
  class B extends Build {
    clean = target().executes(() => void log.push("clean"));
    restore = target().executes(() => void log.push("restore"));
    compile = target()
      .dependsOn(this.clean, this.restore)
      .executes(() => void log.push("compile"));
    test = target().dependsOn(this.compile).executes(() =>
      void log.push("test")
    );
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.test, silent);
  assertEquals(result.ok, true);
  assertEquals(log[log.length - 1], "test");
  assertEquals(log.indexOf("compile") < log.indexOf("test"), true);
  assertEquals(log.indexOf("clean") < log.indexOf("compile"), true);
});

Deno.test("diamond shared target runs exactly once", async () => {
  const log: string[] = [];
  class B extends Build {
    base = target().executes(() => void log.push("base"));
    left = target().dependsOn(this.base).executes(() => void log.push("left"));
    right = target().dependsOn(this.base).executes(() =>
      void log.push("right")
    );
    top = target()
      .dependsOn(this.left, this.right)
      .executes(() => void log.push("top"));
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.top, silent);
  assertEquals(log.filter((n) => n === "base").length, 1);
});

Deno.test("a failing target aborts the run", async () => {
  const log: string[] = [];
  class B extends Build {
    first = target().executes(() => void log.push("first"));
    boom = target()
      .dependsOn(this.first)
      .executes(() => {
        throw new Error("kaboom");
      });
    last = target().dependsOn(this.boom).executes(() => void log.push("last"));
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.last, silent);
  assertEquals(result.ok, false);
  assertEquals(messageOf(result.error), "kaboom");
  assertEquals(log.includes("first"), true);
  assertEquals(log.includes("last"), false); // aborted before reaching last
  assertEquals(result.executed, ["first"]);
});

Deno.test("lifecycle hooks run around the plan", async () => {
  const events: string[] = [];
  class B extends Build {
    override onStart() {
      events.push("start");
    }
    override onFinish(r: BuildResult) {
      events.push(`finish:${r.ok}`);
    }
    work = target().executes(() => void events.push("work"));
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.work, silent);
  assertEquals(events, ["start", "work", "finish:true"]);
});

Deno.test("skip removes a target from the plan", async () => {
  const log: string[] = [];
  class B extends Build {
    setup = target().executes(() => void log.push("setup"));
    main = target().dependsOn(this.setup).executes(() => void log.push("main"));
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.main, { silent: true, skip: ["setup"] });
  assertEquals(result.ok, true);
  assertEquals(log, ["main"]);
});

Deno.test("a target without a body fails fast", async () => {
  class B extends Build {
    incomplete = target().description("no body here");
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.incomplete, silent);
  assertEquals(result.ok, false);
  assertEquals(messageOf(result.error).includes("no body"), true);
});

Deno.test("plain mode prints a ruled header, success footer, and summary table", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    work = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.work, { reporter, github: false });
  // Stacked ═ rules frame the target name (top rule, name, bottom rule).
  assertEquals(lines[0].startsWith("═"), true);
  assertEquals(lines[1], "work");
  assertEquals(lines[2].startsWith("═"), true);
  // The success footer uses the "succeeded in" phrasing.
  assertEquals(lines.some((l) => l.startsWith("✔ work succeeded in ")), true);
  // The summary block is title + ruled table + Total + closing line.
  assertEquals(lines.some((l) => l === "Build Summary"), true);
  assertEquals(lines.some((l) => l.startsWith("Target")), true);
  assertEquals(lines.some((l) => l.startsWith("Total")), true);
  const closing = lines[lines.length - 1];
  assertEquals(closing.startsWith("✔ Build succeeded — 1/1 targets in "), true);
});

Deno.test("plain mode reports a failure footer and names the culprit at the end", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    boom = target().executes(() => {
      throw new Error("nope");
    });
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.boom, { reporter, github: false });
  assertEquals(lines.some((l) => l.startsWith("✘ boom failed in ")), true);
  // The error message is indented under the failure footer.
  assertEquals(lines.some((l) => l === "  nope"), true);
  const closing = lines[lines.length - 1];
  assertEquals(
    closing.startsWith("✘ Build failed — 'boom' failed after "),
    true,
  );
});

Deno.test("a non-Error throw is reported via String coercion", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    boom = target().executes(() => {
      throw "string failure";
    });
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.boom, { reporter, github: false });
  assertEquals(result.ok, false);
  assertEquals(result.error, "string failure");
  assertEquals(lines.includes("  string failure"), true);
});

Deno.test("github mode wraps each target in a collapsible group", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    work = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  await withEnv("GITHUB_STEP_SUMMARY", undefined, async () => {
    await execute(b, b.work, { reporter, github: true });
  });
  assertEquals(lines[0], "::group::work");
  assertEquals(lines.some((l) => l.startsWith("✔ work succeeded in ")), true);
  assertEquals(lines.includes("::endgroup::"), true);
});

Deno.test("github mode emits an ::error annotation on failure", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    boom = target().executes(() => {
      throw new Error("nope");
    });
  }
  const b = new B();
  discoverTargets(b);

  await withEnv("GITHUB_STEP_SUMMARY", undefined, async () => {
    await execute(b, b.boom, { reporter, github: true });
  });
  assertEquals(lines.includes("::endgroup::"), true);
  assertEquals(
    lines.some((l) => l.startsWith("::error title=boom::")),
    true,
  );
  assertEquals(lines.some((l) => l.includes("boom failed: nope")), true);
});

Deno.test("summary table lists skipped and succeeded rows with the count", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    setup = target().executes(() => {});
    main = target().dependsOn(this.setup).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.main, { reporter, github: false, skip: ["setup"] });
  // The table carries a Skipped row for setup and a Succeeded row for main.
  assertEquals(
    lines.some((l) => l.startsWith("setup") && l.includes("Skipped")),
    true,
  );
  assertEquals(
    lines.some((l) => l.startsWith("main") && l.includes("Succeeded")),
    true,
  );
  const closing = lines[lines.length - 1];
  assertEquals(closing.startsWith("✔ Build succeeded — 1/2 targets in "), true);
});

Deno.test("targets after a failure are marked skipped in the summary table", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    first = target().executes(() => {});
    boom = target().dependsOn(this.first).executes(() => {
      throw new Error("x");
    });
    last = target().dependsOn(this.boom).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.last, { reporter, github: false });
  assertEquals(
    lines.some((l) => l.startsWith("first") && l.includes("Succeeded")),
    true,
  );
  assertEquals(
    lines.some((l) => l.startsWith("boom") && l.includes("Failed")),
    true,
  );
  assertEquals(
    lines.some((l) => l.startsWith("last") && l.includes("Skipped")),
    true,
  );
  const closing = lines[lines.length - 1];
  assertEquals(
    closing.startsWith("✘ Build failed — 'boom' failed after "),
    true,
  );
});

Deno.test("auto-detects GitHub Actions from the environment", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    work = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  await withEnv("GITHUB_STEP_SUMMARY", undefined, async () => {
    await withEnv("GITHUB_ACTIONS", "true", async () => {
      await execute(b, b.work, { reporter }); // no github option
    });
    assertEquals(lines[0], "::group::work");

    lines.length = 0;
    await withEnv("GITHUB_ACTIONS", undefined, async () => {
      await execute(b, b.work, { reporter });
    });
    // Outside GitHub Actions, the plain-mode ruled header opens the section.
    assertEquals(lines[0].startsWith("═"), true);
    assertEquals(lines[1], "work");
  });
});

Deno.test("github mode appends a Markdown job summary (default console)", async () => {
  const tmp = await Deno.makeTempFile();
  class B extends Build {
    a = target().executes(() => {});
    b = target().dependsOn(this.a).executes(() => {});
  }
  const build = new B();
  discoverTargets(build);

  try {
    // The summary is only written on a default-console run (no custom reporter,
    // not silent); silence the console to keep the banner out of the test log.
    await withEnv("GITHUB_STEP_SUMMARY", tmp, async () => {
      await withSilencedConsole(() =>
        execute(build, build.b, { github: true })
      );
    });
    const md = await Deno.readTextFile(tmp);
    assertEquals(md.includes("Zuke build"), true);
    assertEquals(md.includes("| Target | Result | Time |"), true);
    assertEquals(md.includes("| a | ✔ Succeeded |"), true);
    assertEquals(md.includes("| **Total** |"), true);
  } finally {
    await Deno.remove(tmp);
  }
});

Deno.test("the job summary is appended, preserving content written during the run", async () => {
  class B extends Build {
    // A validation writes its own summary section before the body, the way the
    // AI reviewers/fixer do; the build table must not overwrite it.
    work = target()
      .validateBefore({
        validate: () => {
          const path = Deno.env.get("GITHUB_STEP_SUMMARY");
          if (path !== undefined) {
            Deno.writeTextFileSync(path, "## AI section\n", { append: true });
          }
        },
      })
      .executes(() => {});
  }
  const build = new B();
  discoverTargets(build);
  const tmp = await Deno.makeTempFile();
  try {
    await withEnv("GITHUB_STEP_SUMMARY", tmp, async () => {
      await withSilencedConsole(() =>
        execute(build, build.work, { github: true })
      );
    });
    const md = await Deno.readTextFile(tmp);
    assertEquals(md.includes("## AI section"), true); // not wiped
    assertEquals(md.includes("Zuke build"), true); // table appended after
  } finally {
    await Deno.remove(tmp);
  }
});

Deno.test("the job summary is NOT written when output is redirected or silent", async () => {
  const { reporter } = recorder();
  class B extends Build {
    work = target().executes(() => {});
  }
  const build = new B();
  discoverTargets(build);

  for (const options of [{ reporter }, { silent: true }] as const) {
    const tmp = await Deno.makeTempFile();
    try {
      await withEnv("GITHUB_STEP_SUMMARY", tmp, async () => {
        await execute(build, build.work, { ...options, github: true });
      });
      // A redirected/silent run must not touch the shared summary file.
      assertEquals(await Deno.readTextFile(tmp), "");
    } finally {
      await Deno.remove(tmp);
    }
  }
});

Deno.test("falls back to the console reporter when none is given", async () => {
  const realLog = console.log;
  const realError = console.error;
  const captured: string[] = [];
  const sink = (...args: unknown[]) =>
    void captured.push(args.map(String).join(" "));
  class Ok extends Build {
    work = target().executes(() => {});
  }
  class Bad extends Build {
    boom = target().executes(() => {
      throw new Error("x");
    });
  }
  const ok = new Ok();
  discoverTargets(ok);
  const bad = new Bad();
  discoverTargets(bad);

  try {
    console.log = sink;
    console.error = sink;
    await execute(ok, ok.work, { github: false });
    await execute(bad, bad.boom, { github: false });
  } finally {
    console.log = realLog;
    console.error = realError;
  }
  assertEquals(captured.some((l) => l.includes("Build succeeded")), true);
  assertEquals(captured.some((l) => l.includes("Build failed")), true);
});

Deno.test("colour mode wraps output in ANSI codes", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    work = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.work, { reporter, github: false, color: true });
  // The top rule is painted (dim), as is the bold cyan target name.
  assertEquals(lines[0].includes("\x1b["), true);
  assertEquals(lines[1].includes("\x1b["), true);
  assertEquals(lines[1].includes("work"), true);
  assertEquals(lines[lines.length - 1].includes("\x1b["), true);
});

Deno.test("plain mode separates consecutive targets with a blank line", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    a = target().executes(() => {});
    b = target().dependsOn(this.a).executes(() => {});
  }
  const build = new B();
  discoverTargets(build);

  await execute(build, build.b, { reporter, github: false, color: false });
  // No leading blank before the first target's top rule.
  assertEquals(lines[0].startsWith("═"), true);
  assertEquals(lines[1], "a");
  // A blank separates the two target blocks.
  const bNameAt = lines.indexOf("b");
  assertEquals(bNameAt > 0, true);
  // The "b" line is the second of three header lines; its preceding "═"
  // separator opens the second block, and the blank sits before that.
  assertEquals(lines[bNameAt - 2], ""); // blank → top rule → "b"
});

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.test("parallel runs independent targets concurrently", async () => {
  let active = 0;
  let peak = 0;
  const track = async () => {
    active++;
    peak = Math.max(peak, active);
    await delay(20);
    active--;
  };
  class B extends Build {
    a = target().executes(track);
    b = target().executes(track);
    c = target().executes(track);
    all = target().dependsOn(this.a, this.b, this.c).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.all, { silent: true, parallel: 3 });
  assertEquals(result.ok, true);
  assertEquals(peak, 3); // a, b, c all overlapped

  peak = 0;
  await execute(b, b.all, { silent: true }); // sequential: no overlap
  assertEquals(peak, 1);
});

Deno.test("parallel still runs dependencies before dependents", async () => {
  const order: string[] = [];
  const rec = (name: string) => async () => {
    await delay(5);
    order.push(name);
  };
  class B extends Build {
    base = target().executes(rec("base"));
    mid = target().dependsOn(this.base).executes(rec("mid"));
    top = target().dependsOn(this.mid).executes(rec("top"));
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.top, { silent: true, parallel: 4 });
  assertEquals(result.ok, true);
  assertEquals(order, ["base", "mid", "top"]);
});

Deno.test("parallel diamond runs the shared dep once and overlaps the middle", async () => {
  let active = 0;
  let peak = 0;
  const counts = new Map<string, number>();
  const run = (name: string) => async () => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    active++;
    peak = Math.max(peak, active);
    await delay(20);
    active--;
  };
  class B extends Build {
    base = target().executes(run("base"));
    left = target().dependsOn(this.base).executes(run("left"));
    right = target().dependsOn(this.base).executes(run("right"));
    top = target().dependsOn(this.left, this.right).executes(run("top"));
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.top, { silent: true, parallel: 4 });
  assertEquals(counts.get("base"), 1);
  assertEquals(peak, 2); // left and right overlap; base and top run alone
});

Deno.test("parallel skips dependents of a failed target but finishes peers", async () => {
  const ran: string[] = [];
  class B extends Build {
    boom = target().executes(() => {
      throw new Error("boom");
    });
    afterBoom = target().dependsOn(this.boom).executes(() =>
      void ran.push("afterBoom")
    );
    independent = target().executes(() => void ran.push("independent"));
    all = target()
      .dependsOn(this.afterBoom, this.independent)
      .executes(() => void ran.push("all"));
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.all, { silent: true, parallel: 4 });
  assertEquals(result.ok, false);
  assertEquals(messageOf(result.error), "boom");
  assertEquals(ran.includes("independent"), true); // launched alongside boom
  assertEquals(ran.includes("afterBoom"), false); // dependency failed
  assertEquals(ran.includes("all"), false); // transitively blocked
});

Deno.test("parallel treats --skip targets as satisfied dependencies", async () => {
  const ran: string[] = [];
  class B extends Build {
    setup = target().executes(() => void ran.push("setup"));
    main = target().dependsOn(this.setup).executes(() => void ran.push("main"));
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.main, {
    silent: true,
    parallel: 4,
    skip: ["setup"],
  });
  assertEquals(result.ok, true);
  assertEquals(ran, ["main"]);
});

Deno.test("parallel=true uses the host CPU count and succeeds", async () => {
  class B extends Build {
    a = target().executes(() => {});
    b = target().executes(() => {});
  }
  const build = new B();
  discoverTargets(build);
  // `b` has no deps on `a`; running `b` alone exercises the auto-limit path.
  const result = await execute(build, build.b, {
    silent: true,
    parallel: true,
  });
  assertEquals(result.ok, true);
});

Deno.test("parallel buffers each target's block (plain and github)", async () => {
  class B extends Build {
    a = target().executes(() => {});
    boom = target().executes(() => {
      throw new Error("nope");
    });
    all = target().dependsOn(this.a, this.boom).executes(() => {});
  }
  const build = new B();
  discoverTargets(build);

  // Plain: each target's banner block flushes contiguously; blocks are
  // separated by a blank line; the failure surfaces and the run fails.
  const plain = recorder();
  const result = await execute(build, build.all, {
    reporter: plain.reporter,
    github: false,
    parallel: 4,
  });
  assertEquals(result.ok, false);
  // Each target's three-line ruled header sits adjacent to its footer.
  assertEquals(plain.lines.includes("a"), true);
  assertEquals(plain.lines.includes("  nope"), true);
  assertEquals(plain.lines.includes(""), true); // blank separator between blocks
  assertEquals(
    plain.lines[plain.lines.length - 1].includes("Build failed"),
    true,
  );

  // GitHub: buffering keeps each ::group:: contiguous with its body/endgroup.
  const gh = recorder();
  await withEnv("GITHUB_STEP_SUMMARY", undefined, async () => {
    await execute(build, build.a, {
      reporter: gh.reporter,
      github: true,
      parallel: 4,
    });
  });
  const open = gh.lines.indexOf("::group::a");
  assertEquals(open >= 0, true);
  assertEquals(gh.lines[open + 1].startsWith("✔ a succeeded in "), true);
  assertEquals(gh.lines[open + 2], "::endgroup::");
});

Deno.test("a group runs its members in parallel without the --parallel flag", async () => {
  const order: string[] = [];
  let active = 0;
  let peak = 0;
  const track = (name: string) => async () => {
    order.push(name);
    active++;
    peak = Math.max(peak, active);
    await delay(20);
    active--;
  };
  class B extends Build {
    checks = group();
    clean = target().executes(track("clean"));
    lint = target().dependsOn(this.clean).partOf(this.checks).executes(
      track("lint"),
    );
    format = target().dependsOn(this.clean).partOf(this.checks).executes(
      track("format"),
    );
    typecheck = target().dependsOn(this.clean).partOf(this.checks).executes(
      track("typecheck"),
    );
    deploy = target().dependsOn(this.checks).executes(track("deploy"));
  }
  const b = new B();
  discoverTargets(b);

  // No `parallel` option: only the group's members run concurrently.
  const result = await execute(b, b.deploy, { silent: true });
  assertEquals(result.ok, true);
  assertEquals(peak, 3); // lint, format, typecheck overlapped
  assertEquals(order[0], "clean"); // clean ran first (all depend on it)
  assertEquals(order[order.length - 1], "deploy"); // deploy ran after the group
});

Deno.test("ungrouped targets stay sequential while a group runs in parallel", async () => {
  let active = 0;
  let peak = 0;
  const track = async () => {
    active++;
    peak = Math.max(peak, active);
    await delay(20);
    active--;
  };
  class B extends Build {
    batch = group();
    // Two independent ungrouped targets — must NOT overlap each other.
    first = target().executes(track);
    second = target().executes(track);
    // A group whose members may overlap.
    a = target().partOf(this.batch).executes(track);
    bb = target().partOf(this.batch).executes(track);
    all = target()
      .dependsOn(this.first, this.second, this.batch)
      .executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.all, { silent: true });
  // Peak 2 comes only from the group; first/second never overlap anything.
  assertEquals(peak, 2);
});

Deno.test("a failing group member skips the group's dependents", async () => {
  const ran: string[] = [];
  class B extends Build {
    checks = group();
    ok = target().partOf(this.checks).executes(() => void ran.push("ok"));
    boom = target().partOf(this.checks).executes(() => {
      throw new Error("boom");
    });
    deploy = target().dependsOn(this.checks).executes(() =>
      void ran.push("deploy")
    );
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.deploy, { silent: true });
  assertEquals(result.ok, false);
  assertEquals(ran.includes("deploy"), false); // group member failed
});

Deno.test("onlyWhen=false skips the target but its dependents still run", async () => {
  const ran: string[] = [];
  class B extends Build {
    gated = target().onlyWhen(() => false).executes(() =>
      void ran.push("gated")
    );
    after = target().dependsOn(this.gated).executes(() =>
      void ran.push("after")
    );
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.after, { silent: true });
  assertEquals(result.ok, true);
  assertEquals(ran, ["after"]); // gated skipped, dependent still ran
});

Deno.test("onlyWhen can gate on a resolved parameter", async () => {
  const ran: string[] = [];
  class B extends Build {
    env = parameter("env").default("dev");
    deploy = target()
      .onlyWhen(() => this.env.value === "prod")
      .executes(() => void ran.push("deploy"));
  }
  const dev = new B();
  discoverTargets(dev);
  await execute(dev, dev.deploy, { silent: true, params: { env: "dev" } });
  assertEquals(ran, []); // dev → skipped

  const prod = new B();
  discoverTargets(prod);
  await execute(prod, prod.deploy, { silent: true, params: { env: "prod" } });
  assertEquals(ran, ["deploy"]);
});

Deno.test("a cached target is skipped and counted as succeeded", async () => {
  const { lines, reporter } = recorder();
  const ran: string[] = [];
  class B extends Build {
    build = target().inputs("x").executes(() => void ran.push("build"));
  }
  const b = new B();
  discoverTargets(b);
  const cache = new FakeCache();
  cache.fresh.add("build");

  const result = await execute(b, b.build, {
    reporter,
    github: false,
    cache,
  });
  assertEquals(result.ok, true);
  assertEquals(ran, []); // body not run
  assertEquals(cache.saved, true);
  // The table carries a Cached row, and the cached target counts toward the total.
  assertEquals(
    lines.some((l) => l.startsWith("build") && l.includes("Cached")),
    true,
  );
  const closing = lines[lines.length - 1];
  assertEquals(closing.startsWith("✔ Build succeeded — 1/1 targets in "), true);
});

Deno.test("a stale target runs and records its fingerprint", async () => {
  const ran: string[] = [];
  class B extends Build {
    build = target().inputs("x").executes(() => void ran.push("build"));
  }
  const b = new B();
  discoverTargets(b);
  const cache = new FakeCache(); // nothing fresh → must run

  await execute(b, b.build, { silent: true, cache });
  assertEquals(ran, ["build"]);
  assertEquals(cache.recorded, ["build"]);
});

Deno.test("cache:false runs cacheable targets without touching the cache", async () => {
  const ran: string[] = [];
  class B extends Build {
    build = target().inputs("x").executes(() => void ran.push("build"));
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.build, { silent: true, cache: false });
  assertEquals(result.ok, true);
  assertEquals(ran, ["build"]);
});

Deno.test("execute caches incrementally via the default .zuke store", async () => {
  const dir = await Deno.makeTempDir();
  const original = Deno.cwd();
  try {
    await Deno.writeTextFile(`${dir}/zuke.json`, "{}\n");
    await Deno.writeTextFile(`${dir}/input.txt`, "v1");
    Deno.chdir(dir);
    let runs = 0;
    class B extends Build {
      build = target().inputs("input.txt").executes(() => void runs++);
    }
    const first = new B();
    discoverTargets(first);
    await execute(first, first.build, { silent: true });
    assertEquals(runs, 1);

    const second = new B(); // unchanged input → cached
    discoverTargets(second);
    await execute(second, second.build, { silent: true });
    assertEquals(runs, 1);

    await Deno.writeTextFile(`${dir}/input.txt`, "v2"); // changed → rebuild
    const third = new B();
    discoverTargets(third);
    await execute(third, third.build, { silent: true });
    assertEquals(runs, 2);
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("triggers run the triggered target after this one", async () => {
  const order: string[] = [];
  class B extends Build {
    notify = target().executes(() => void order.push("notify"));
    build = target().triggers(this.notify).executes(() =>
      void order.push("build")
    );
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.build, { silent: true });
  assertEquals(result.ok, true);
  assertEquals(order, ["build", "notify"]);
});

Deno.test("proceedAfterFailure keeps the build going but still fails", async () => {
  const ran: string[] = [];
  class B extends Build {
    flaky = target().proceedAfterFailure().executes(() => {
      throw new Error("flaked");
    });
    afterFlaky = target().dependsOn(this.flaky).executes(() =>
      void ran.push("afterFlaky")
    );
    independent = target().executes(() => void ran.push("independent"));
    all = target()
      .dependsOn(this.afterFlaky, this.independent)
      .executes(() => void ran.push("all"));
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.all, { silent: true });
  assertEquals(result.ok, false); // a failure still fails the build
  assertEquals(ran.includes("independent"), true); // kept going
  assertEquals(ran.includes("afterFlaky"), false); // dependent of the failure
  assertEquals(ran.includes("all"), false); // transitively blocked
});

Deno.test("requires fails a target whose parameter is unset", async () => {
  class B extends Build {
    token = parameter("API token");
    publish = target().requires(this.token).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.publish, {
    silent: true,
    readEnv: () => undefined,
  });
  assertEquals(result.ok, false);
  assertEquals(messageOf(result.error).includes("requires parameter"), true);
});

Deno.test("requires passes once the parameter is set", async () => {
  const ran: string[] = [];
  class B extends Build {
    token = parameter("API token");
    publish = target().requires(this.token).executes(() =>
      void ran.push("publish")
    );
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.publish, {
    silent: true,
    params: { token: "secret" },
  });
  assertEquals(result.ok, true);
  assertEquals(ran, ["publish"]);
});

Deno.test("always targets run for cleanup even after a failure", async () => {
  const ran: string[] = [];
  class B extends Build {
    boom = target().executes(() => {
      throw new Error("boom");
    });
    cleanup = target().always().executes(() => void ran.push("cleanup"));
    all = target()
      .dependsOn(this.boom, this.cleanup)
      .executes(() => void ran.push("all"));
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.all, { silent: true });
  assertEquals(result.ok, false);
  assertEquals(ran.includes("cleanup"), true); // ran despite the failure
  assertEquals(ran.includes("all"), false); // blocked by the failed dep
});

Deno.test("whenSkipped(skip-dependencies) skips the target and its exclusive deps", async () => {
  const ran: string[] = [];
  class B extends Build {
    onlyForDocs = target().executes(() => void ran.push("onlyForDocs"));
    docs = target()
      .dependsOn(this.onlyForDocs)
      .onlyWhen(() => false)
      .whenSkipped("skip-dependencies")
      .executes(() => void ran.push("docs"));
    site = target().dependsOn(this.docs).executes(() => void ran.push("site"));
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.site, { silent: true });
  assertEquals(result.ok, true);
  assertEquals(ran.includes("docs"), false); // condition false → skipped
  assertEquals(ran.includes("onlyForDocs"), false); // exclusive dep skipped too
  assertEquals(ran.includes("site"), true); // dependent still runs
});

Deno.test("onTargetStart and onTargetEnd fire around each target", async () => {
  const events: string[] = [];
  class B extends Build {
    override onTargetStart(name: string) {
      events.push(`start:${name}`);
    }
    override onTargetEnd(name: string, status: TargetStatus) {
      events.push(`end:${name}:${status}`);
    }
    a = target().executes(() => {});
    b = target().dependsOn(this.a).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  await execute(b, b.b, { silent: true });
  assertEquals(events, [
    "start:a",
    "end:a:passed",
    "start:b",
    "end:b:passed",
  ]);
});

Deno.test("secret parameter values are masked to the real console under GitHub Actions", async () => {
  class B extends Build {
    token = parameter("token").secret();
    go = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  const printed: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => void printed.push(args.join(" "));
  try {
    await withEnv("GITHUB_STEP_SUMMARY", undefined, async () => {
      // No custom reporter and not silent → output goes to the real console
      // (the GitHub runner's stdout), which is where ::add-mask:: belongs.
      await execute(b, b.go, { github: true, params: { token: "s3cr3t" } });
    });
  } finally {
    console.log = origLog;
  }
  assertEquals(printed.includes("::add-mask::s3cr3t"), true);
});

Deno.test("a custom reporter never receives a raw ::add-mask:: secret", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    token = parameter("token").secret();
    go = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  await withEnv("GITHUB_STEP_SUMMARY", undefined, async () => {
    // A custom reporter *is* the base reporter (not redacted), so the add-mask
    // directive — which bypasses redaction — must not be emitted to it: an
    // embedded execute() would otherwise be handed the plaintext secret.
    await execute(b, b.go, {
      reporter,
      github: true,
      params: { token: "s3cr3t" },
    });
  });
  assertEquals(lines.some((l) => l.includes("s3cr3t")), false); // no leak at all
  assertEquals(lines.some((l) => l.startsWith("::add-mask::")), false);
});

Deno.test("execute prompts for a missing required parameter", async () => {
  const seen: string[] = [];
  class B extends Build {
    token = parameter("token").required();
    go = target().executes(() => void seen.push(this.token.value));
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.go, {
    silent: true,
    readEnv: () => undefined,
    prompt: () => "prompted",
  });
  assertEquals(result.ok, true);
  assertEquals(seen, ["prompted"]);
});

Deno.test("targets from a reusable component run in dependency order", async () => {
  const ran: string[] = [];
  const releasable = () => {
    const pack = target().executes(() => void ran.push("pack"));
    const publish = target().dependsOn(pack).executes(() =>
      void ran.push("publish")
    );
    return { pack, publish };
  };
  class B extends Build {
    release = releasable();
    deploy = target().dependsOn(this.release.publish).executes(() =>
      void ran.push("deploy")
    );
  }
  const b = new B();
  const root = discoverTargets(b).get("deploy");
  if (!root) throw new Error("no deploy target");
  const result = await execute(b, root, { silent: true });
  assertEquals(result.ok, true);
  assertEquals(ran, ["pack", "publish", "deploy"]);
});

Deno.test("an unwritable job-summary file never fails the build", async () => {
  const dir = await Deno.makeTempDir(); // a directory is not writable as a file
  class B extends Build {
    work = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  try {
    let result: BuildResult | undefined;
    // Default-console run so the summary write is attempted (and fails on the
    // directory path); console silenced to keep the banner quiet.
    await withEnv("GITHUB_STEP_SUMMARY", dir, async () => {
      await withSilencedConsole(async () => {
        result = await execute(b, b.work, { github: true });
      });
    });
    assertEquals(result?.ok, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dry run reports the plan without executing bodies or cache", async () => {
  const log: string[] = [];
  const cache = new FakeCache();
  class B extends Build {
    clean = target().executes(() => void log.push("clean"));
    build = target()
      .dependsOn(this.clean)
      .inputs("src")
      .executes(() => void log.push("build"));
  }
  const b = new B();
  discoverTargets(b);

  const { lines, reporter } = recorder();
  const result = await execute(b, b.build, {
    reporter,
    dryRun: true,
    cache,
  });
  assertEquals(result.ok, true);
  assertEquals(log, []); // no body ran
  assertEquals(cache.recorded, []); // cache untouched
  assertEquals(cache.saved, false);
  assertEquals(result.executed, ["clean", "build"]); // both planned
  assertEquals(lines.some((l) => l.includes("dry run")), true);
});

Deno.test("dry run still skips targets whose condition is false", async () => {
  class B extends Build {
    deploy = target()
      .onlyWhen(() => false)
      .executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.deploy, { silent: true, dryRun: true });
  assertEquals(result.ok, true);
  assertEquals(result.executed, []); // skipped, not "executed"
});

Deno.test("timeout fails a body that runs too long", async () => {
  class B extends Build {
    slow = target()
      .timeout(20)
      .executes(() =>
        new Promise<void>((resolve) => setTimeout(resolve, 1000))
      );
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.slow, silent);
  assertEquals(result.ok, false);
  assertEquals(messageOf(result.error).includes("timed out"), true);
});

Deno.test("a fast body within the timeout passes", async () => {
  let ran = false;
  class B extends Build {
    quick = target().timeout(1000).executes(() => void (ran = true));
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.quick, silent);
  assertEquals(result.ok, true);
  assertEquals(ran, true);
});

Deno.test("a body with a timeout that fails fast surfaces its own error", async () => {
  class B extends Build {
    boom = target()
      .timeout(1000)
      .executes(() => {
        throw new Error("real error");
      });
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.boom, silent);
  assertEquals(result.ok, false);
  assertEquals(messageOf(result.error), "real error"); // not a timeout
});

Deno.test("dry run closes the log group under GitHub Actions", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    work = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.work, {
    reporter,
    github: true,
    dryRun: true,
  });
  assertEquals(result.ok, true);
  assertEquals(lines.includes("::group::work"), true);
  assertEquals(lines.includes("::endgroup::"), true);
});

Deno.test("retry re-runs a flaky body until it succeeds", async () => {
  let attempts = 0;
  class B extends Build {
    flaky = target()
      .retry(3)
      .executes(() => {
        attempts++;
        if (attempts < 3) throw new Error("flaky");
      });
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.flaky, silent);
  assertEquals(result.ok, true);
  assertEquals(attempts, 3);
});

Deno.test("retry gives up after the configured attempts (with delay)", async () => {
  let attempts = 0;
  class B extends Build {
    doomed = target()
      .retry(2, 1)
      .executes(() => {
        attempts++;
        throw new Error("always fails");
      });
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.doomed, silent);
  assertEquals(result.ok, false);
  assertEquals(attempts, 3); // 1 initial + 2 retries
  assertEquals(messageOf(result.error), "always fails");
});

// --- Plugins (lifecycle observers) ---

Deno.test("execute runs plugin hooks alongside the build hooks, in order", async () => {
  const events: string[] = [];
  class B extends Build {
    override onStart() {
      events.push("build:start");
    }
    override onTargetStart(n: string) {
      events.push(`build:ts:${n}`);
    }
    override onTargetEnd(n: string, s: TargetStatus) {
      events.push(`build:te:${n}:${s}`);
    }
    override onFinish(r: BuildResult) {
      events.push(`build:finish:${r.ok}`);
    }
    a = target().executes(() => {});
  }
  const plugin: Plugin = {
    name: "spy",
    onStart: () => void events.push("plugin:start"),
    onTargetStart: (n) => void events.push(`plugin:ts:${n}`),
    onTargetEnd: (n, s) => void events.push(`plugin:te:${n}:${s}`),
    onFinish: (r) => void events.push(`plugin:finish:${r.ok}`),
  };
  const b = new B();
  discoverTargets(b);
  await execute(b, b.a, { silent: true, plugins: [plugin] });
  assertEquals(events, [
    "build:start",
    "plugin:start",
    "build:ts:a",
    "plugin:ts:a",
    "build:te:a:passed",
    "plugin:te:a:passed",
    "build:finish:true",
    "plugin:finish:true",
  ]);
});

Deno.test("execute supports multiple plugins and partial hook sets", async () => {
  const calls: string[] = [];
  class B extends Build {
    a = target().executes(() => {});
  }
  // p1 implements only onTargetEnd; p2 only onFinish — the unimplemented hooks
  // must be skipped without error.
  const p1: Plugin = { onTargetEnd: (n, s) => void calls.push(`p1:${n}:${s}`) };
  const p2: Plugin = { onFinish: () => void calls.push("p2:finish") };
  const b = new B();
  discoverTargets(b);
  await execute(b, b.a, { silent: true, plugins: [p1, p2] });
  assertEquals(calls, ["p1:a:passed", "p2:finish"]);
});

Deno.test("plugin hooks carry the run id, dry-run flag, and target timing (M7)", async () => {
  const seen: {
    startRunId?: string;
    tsRunId?: string;
    teRunId?: string;
    teDuration?: number;
    finishRunId?: string;
    dryRun?: boolean;
  } = {};
  class B extends Build {
    a = target().executes(() => {});
  }
  const plugin: Plugin = {
    onStart: (run) => {
      seen.startRunId = run.runId;
      seen.dryRun = run.dryRun;
    },
    onTargetStart: (_n, run) => void (seen.tsRunId = run.runId),
    onTargetEnd: (_n, _s, timing) => {
      seen.teRunId = timing.runId;
      seen.teDuration = timing.durationMs;
    },
    onFinish: (_r, run) => void (seen.finishRunId = run.runId),
  };
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.a, { silent: true, plugins: [plugin] });
  // Every hook sees the same, non-empty run id — the run's identity.
  assertEquals(seen.startRunId, result.runId);
  assertEquals(seen.startRunId !== undefined && seen.startRunId !== "", true);
  assertEquals(seen.tsRunId, seen.startRunId);
  assertEquals(seen.teRunId, seen.startRunId);
  assertEquals(seen.finishRunId, seen.startRunId);
  assertEquals(seen.dryRun, false);
  assertEquals(typeof seen.teDuration, "number");

  // A dry run reports dryRun: true through the same RunInfo.
  const dry: boolean[] = [];
  const b2 = new B();
  discoverTargets(b2);
  await execute(b2, b2.a, {
    silent: true,
    dryRun: true,
    plugins: [{ onStart: (run) => void dry.push(run.dryRun) }],
  });
  assertEquals(dry, [true]);
});

Deno.test("old-style plugin hooks (fewer args) still compile and run (M7)", async () => {
  const calls: string[] = [];
  class B extends Build {
    a = target().executes(() => {});
  }
  // The pre-M7 signatures — no run/timing arguments — remain valid.
  const legacy: Plugin = {
    onStart: () => void calls.push("start"),
    onTargetStart: (n) => void calls.push(`ts:${n}`),
    onTargetEnd: (n, s) => void calls.push(`te:${n}:${s}`),
    onFinish: (r) => void calls.push(`finish:${r.ok}`),
  };
  const b = new B();
  discoverTargets(b);
  await execute(b, b.a, { silent: true, plugins: [legacy] });
  assertEquals(calls, ["start", "ts:a", "te:a:passed", "finish:true"]);
});

Deno.test("onRunStateChange fires with the record on run-level transitions (M7)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const statuses: string[] = [];
    const runIds = new Set<string>();
    class B extends Build {
      a = target().executes(() => {});
    }
    const plugin: Plugin = {
      onRunStateChange: (record) => {
        statuses.push(record.status);
        runIds.add(record.id);
      },
    };
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.a, {
      silent: true,
      stateStore: store,
      plugins: [plugin],
    });
    // Fires at start (running) and at the terminal transition (succeeded), both
    // carrying the same run record.
    assertEquals(statuses, ["running", "succeeded"]);
    assertEquals(runIds.size, 1);
    assertEquals([...runIds][0], result.runId);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("onRunStateChange stays silent without a state store (M7)", async () => {
  const calls: string[] = [];
  class B extends Build {
    a = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  await execute(b, b.a, {
    silent: true,
    stateStore: false,
    plugins: [{ onRunStateChange: (r) => void calls.push(r.status) }],
  });
  assertEquals(calls, []); // no store → no record → no run-state events
});

Deno.test("onRunStateChange delivers running → cancelling → cancelled on self-cancel (M7)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const statuses: string[] = [];
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => (started = resolve));
    const controller = new AbortController();
    class B extends Build {
      hang = target().executes((ctx) =>
        new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => resolve(), { once: true });
          started();
        })
      );
    }
    const b = new B();
    discoverTargets(b);
    const runPromise = execute(b, b.hang, {
      silent: true,
      stateStore: store,
      signal: controller.signal,
      plugins: [{ onRunStateChange: (r) => void statuses.push(r.status) }],
    });
    await ready;
    controller.abort();
    const result = await runPromise;
    assertEquals(result.cancelled, true);
    // The full cancellation sequence is delivered, not just the terminal state.
    assertEquals(statuses, ["running", "cancelling", "cancelled"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a throwing plugin hook is isolated and never breaks the run (M7)", async () => {
  const events: string[] = [];
  class B extends Build {
    a = target().executes(() => void events.push("body"));
  }
  // A buggy observer that throws in every hook must not break the build, and
  // must not stop a well-behaved plugin registered after it.
  const bad: Plugin = {
    name: "bad",
    onStart: () => {
      throw new Error("boom-start");
    },
    onTargetEnd: () => {
      throw new Error("boom-te");
    },
    onFinish: () => {
      throw new Error("boom-finish");
    },
  };
  const good: Plugin = { onFinish: () => void events.push("good:finish") };
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.a, { silent: true, plugins: [bad, good] });
  assertEquals(result.ok, true); // the run completes despite the throwing observer
  assertEquals(events, ["body", "good:finish"]); // the good plugin still ran
});

Deno.test("validateBefore runs before the body; validateAfter runs after", async () => {
  const log: string[] = [];
  class B extends Build {
    work = target()
      .validateBefore({ validate: () => void log.push("before") })
      .validateAfter({ validate: () => void log.push("after") })
      .executes(() => void log.push("body"));
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.work, silent);
  assertEquals(result.ok, true);
  assertEquals(log, ["before", "body", "after"]);
});

Deno.test("a throwing validateBefore fails the target and skips the body", async () => {
  let bodyRan = false;
  class B extends Build {
    work = target()
      .validateBefore({
        validate: (ctx) => {
          throw new Error(`gate on ${ctx.target}`);
        },
      })
      .executes(() => void (bodyRan = true));
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.work, silent);
  assertEquals(result.ok, false);
  assertEquals(bodyRan, false);
  assertEquals(messageOf(result.error).includes("gate on work"), true);
});

Deno.test("a throwing validateAfter fails the target after the body ran", async () => {
  let bodyRan = false;
  class B extends Build {
    work = target()
      .executes(() => void (bodyRan = true))
      .validateAfter({
        validate: () => {
          throw new Error("post-check failed");
        },
      });
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.work, silent);
  assertEquals(result.ok, false);
  assertEquals(bodyRan, true);
  assertEquals(messageOf(result.error).includes("post-check failed"), true);
});

Deno.test("a cached target runs no validations", async () => {
  let validated = false;
  class B extends Build {
    work = target()
      .validateBefore({ validate: () => void (validated = true) })
      .executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  const cache = new FakeCache();
  cache.fresh.add("work");
  const result = await execute(b, b.work, { silent: true, cache });
  assertEquals(result.ok, true);
  assertEquals(validated, false);
});

Deno.test("recoverWith heals a failing body on the first attempt", async () => {
  const log: string[] = [];
  let pass = false;
  class B extends Build {
    work = target()
      .recoverWith({
        remediate: (ctx) => {
          log.push(`fix ${ctx.target} attempt ${ctx.attempt}`);
          pass = true;
          return { retry: true };
        },
      })
      .executes(() => {
        log.push("body");
        if (!pass) throw new Error("boom");
      });
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.work, silent);
  assertEquals(result.ok, true);
  assertEquals(log, ["body", "fix work attempt 1", "body"]);
});

Deno.test("a remediation that declines to retry leaves the failure standing", async () => {
  let attempts = 0;
  class B extends Build {
    work = target()
      .recoverWith({
        remediate: () => ({ retry: false, summary: "explained" }),
      })
      .executes(() => {
        attempts++;
        throw new Error("still broken");
      });
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.work, silent);
  assertEquals(result.ok, false);
  assertEquals(attempts, 1); // body never re-run
  assertEquals(messageOf(result.error).includes("still broken"), true);
});

Deno.test("recoverAttempts bounds the fix-then-rerun cycles", async () => {
  let bodyRuns = 0;
  let fixes = 0;
  class B extends Build {
    work = target()
      .recoverWith({
        remediate: () => {
          fixes++;
          return { retry: true };
        },
      })
      .recoverAttempts(3)
      .executes(() => {
        bodyRuns++;
        throw new Error("never fixed");
      });
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.work, silent);
  assertEquals(result.ok, false);
  assertEquals(fixes, 3); // one remediation per attempt
  assertEquals(bodyRuns, 4); // initial run + one re-run per attempt
});

Deno.test("recovery heals on a later attempt", async () => {
  let bodyRuns = 0;
  class B extends Build {
    work = target()
      .recoverWith({ remediate: () => ({ retry: true }) })
      .recoverAttempts(3)
      .executes(() => {
        bodyRuns++;
        if (bodyRuns < 3) throw new Error("not yet");
      });
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.work, silent);
  assertEquals(result.ok, true);
  assertEquals(bodyRuns, 3);
});

Deno.test("a throwing remediation never masks the build failure", async () => {
  class B extends Build {
    work = target()
      .recoverWith({
        remediate: () => {
          throw new Error("fixer crashed");
        },
      })
      .executes(() => {
        throw new Error("original failure");
      });
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.work, silent);
  assertEquals(result.ok, false);
  assertEquals(messageOf(result.error).includes("original failure"), true);
});

Deno.test("a build-level recoverWith heals a target with no per-target one", async () => {
  let pass = false;
  const fixer = {
    remediate: () => {
      pass = true;
      return { retry: true };
    },
  };
  class B extends Build {
    override recoverWith() {
      return [fixer];
    }
    work = target().executes(() => {
      if (!pass) throw new Error("boom");
    });
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.work, silent);
  assertEquals(result.ok, true);
});

Deno.test("per-target recoverWith runs before the build-level one", async () => {
  const order: string[] = [];
  let healed = false;
  class B extends Build {
    override recoverWith() {
      return [{
        remediate: () => {
          order.push("global");
          healed = true;
          return { retry: true };
        },
      }];
    }
    work = target()
      .recoverWith({
        remediate: () => {
          order.push("target");
          return { retry: false };
        },
      })
      .executes(() => {
        if (!healed) throw new Error("boom");
      });
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.work, silent);
  assertEquals(result.ok, true);
  assertEquals(order, ["target", "global"]); // target's own first, then global
});

Deno.test("recoverWith only runs after a body failure, not on success", async () => {
  let fixed = false;
  class B extends Build {
    work = target()
      .recoverWith({ remediate: () => ({ retry: fixed = true }) })
      .executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.work, silent);
  assertEquals(result.ok, true);
  assertEquals(fixed, false);
});

/** A recording in-memory {@link RemoteCacheStore} for executor tests. */
class MemStore implements RemoteCacheStore {
  readonly map = new Map<string, Uint8Array>();
  readonly puts: string[] = [];
  get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.map.get(key) ?? null);
  }
  put(key: string, artifact: Uint8Array): Promise<void> {
    this.puts.push(key);
    this.map.set(key, artifact);
    return Promise.resolve();
  }
}

Deno.test("execute uploads to and restores from a remote cache store", async () => {
  const dir = await Deno.makeTempDir();
  const original = Deno.cwd();
  try {
    await Deno.writeTextFile(`${dir}/zuke.json`, "{}\n");
    await Deno.writeTextFile(`${dir}/input.txt`, "v1");
    await Deno.mkdir(`${dir}/out`);
    await Deno.writeTextFile(`${dir}/out/app.js`, "built");
    Deno.chdir(dir);
    const store = new MemStore();

    class B extends Build {
      build = target().inputs("input.txt").outputs("out").executes(() => {});
    }
    const first = new B();
    discoverTargets(first);
    await execute(first, first.build, { silent: true, remoteCache: store });
    assertEquals(store.puts.length, 1); // outputs uploaded after the run

    // Simulate a fresh checkout: drop the local cache and outputs, keep the store.
    await Deno.remove(`${dir}/.zuke`, { recursive: true });
    await Deno.remove(`${dir}/out`, { recursive: true });
    let ran = false;
    class B2 extends Build {
      build = target().inputs("input.txt").outputs("out").executes(() => {
        ran = true;
      });
    }
    const second = new B2();
    discoverTargets(second);
    const result = await execute(second, second.build, {
      silent: true,
      remoteCache: store,
    });
    assertEquals(ran, false); // restored from the store, body skipped
    assertEquals(await Deno.readTextFile(`${dir}/out/app.js`), "built");
    assertEquals(result.ok, true);
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("target body receives a context with a stable runId and its name", async () => {
  const runIds: string[] = [];
  const names: string[] = [];
  let signalPresent = false;
  let dryRunSeen = true;
  class B extends Build {
    a = target().executes((ctx) => {
      runIds.push(ctx.runId);
      names.push(ctx.target);
    });
    b = target().dependsOn(this.a).executes((ctx) => {
      runIds.push(ctx.runId);
      names.push(ctx.target);
      signalPresent = ctx.signal instanceof AbortSignal && !ctx.signal.aborted;
      dryRunSeen = ctx.dryRun;
    });
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.b, silent);
  assertEquals(result.ok, true);
  assertEquals(names, ["a", "b"]);
  assertEquals(runIds.length, 2);
  assertEquals(runIds[0], runIds[1]); // one identity for the whole run
  assertEquals(runIds[0].length > 0, true);
  assertEquals(signalPresent, true); // live, un-aborted signal
  assertEquals(dryRunSeen, false);
});

Deno.test("options.signal aborts the context signal of an in-flight target", async () => {
  // Deterministic: no subprocess, no timing — proves the run's cancellation
  // reaches a running body through ctx.signal.
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => (started = resolve));
  const controller = new AbortController();
  let observedAbort = false;
  class B extends Build {
    waits = target().executes((ctx) =>
      new Promise<void>((resolve) => {
        ctx.signal.addEventListener("abort", () => {
          observedAbort = true;
          resolve();
        }, { once: true });
        started();
      })
    );
  }
  const b = new B();
  discoverTargets(b);

  const runPromise = execute(b, b.waits, {
    silent: true,
    signal: controller.signal,
  });
  await ready;
  controller.abort();
  const result = await runPromise;
  assertEquals(observedAbort, true);
  // Cancelling the run is now a first-class outcome (M6): even though the body
  // resolved cleanly once its signal fired, the run is reported cancelled.
  assertEquals(result.ok, false);
  assertEquals(result.cancelled, true);
});

Deno.test("cancelling a run terminates an in-flight shell command", async () => {
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => (started = resolve));
  const controller = new AbortController();
  class B extends Build {
    slow = target().executes(async () => {
      started();
      // A plain `$` — no explicit .signal() — is terminated via the executor's
      // ambient run signal when the run is cancelled.
      await $`${DENO} eval ${"await new Promise((r) => setTimeout(r, 30000))"}`
        .quiet();
    });
  }
  const b = new B();
  discoverTargets(b);

  const runPromise = execute(b, b.slow, {
    silent: true,
    signal: controller.signal,
  });
  await ready;
  // Let the child fully spawn before cancelling (Deno wires its abort→SIGTERM
  // listener a tick after spawn); the same 30s sleep proves it was killed, not
  // waited out.
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort();
  const result = await runPromise;
  assertEquals(result.ok, false); // the killed command failed the target
});

Deno.test("cancelling a parallel run terminates in-flight commands in every branch", async () => {
  // Proves the ambient signal propagates through the scheduled (parallel)
  // runner's callback-based pump, not just the sequential path.
  let up = 0;
  let ready: () => void = () => {};
  const bothUp = new Promise<void>((resolve) => (ready = resolve));
  const controller = new AbortController();
  const sleep = "await new Promise((r) => setTimeout(r, 30000))";
  class B extends Build {
    a = target().executes(async () => {
      if (++up === 2) ready();
      await $`${DENO} eval ${sleep}`.quiet();
    });
    b = target().executes(async () => {
      if (++up === 2) ready();
      await $`${DENO} eval ${sleep}`.quiet();
    });
    all = target().dependsOn(this.a, this.b).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  const runPromise = execute(b, b.all, {
    silent: true,
    signal: controller.signal,
    parallel: true,
  });
  await bothUp;
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort();
  const result = await runPromise;
  assertEquals(result.ok, false); // both branches' commands were killed
});

Deno.test("a pre-aborted options.signal aborts the context signal", async () => {
  const controller = new AbortController();
  controller.abort();
  let sawAborted = false;
  class B extends Build {
    a = target().executes((ctx) => {
      sawAborted = ctx.signal.aborted;
    });
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.a, {
    silent: true,
    signal: controller.signal,
  });
  assertEquals(sawAborted, true);
  // A pre-aborted signal cancels the run: no body ran to completion, and the
  // result is a non-ok cancellation (M6).
  assertEquals(result.ok, false);
  assertEquals(result.cancelled, true);
});

Deno.test("a run with a state store reconstructs full status from disk", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const log: string[] = [];
    class B extends Build {
      token = parameter("api token").secret();
      env = parameter("environment");
      prep = target().executes(() => void log.push("prep"));
      deploy = target().dependsOn(this.prep).executes(async (ctx) => {
        await ctx.state.set({ where: "sit-7" });
      });
    }
    const b = new B();
    discoverTargets(b);

    const result = await execute(b, b.deploy, {
      silent: true,
      stateStore: store,
      params: { token: "swordfish", env: "sit" },
    });
    assertEquals(result.ok, true);

    // A fresh store over the same directory reconstructs the run from disk alone.
    const fresh = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const summaries = await fresh.listRuns({});
    assertEquals(summaries.length, 1);
    const loaded = await fresh.getRun(summaries[0].id);
    assertEquals(loaded?.record.status, "succeeded");
    assertEquals(loaded?.record.build, "B");
    assertEquals(loaded?.record.rootTarget, "deploy");
    assertEquals(loaded?.record.targets.prep.status, "succeeded");
    assertEquals(loaded?.record.targets.deploy.status, "succeeded");
    // The running transition landed (startedAt stamped) ...
    assertEquals(typeof loaded?.record.targets.deploy.startedAt, "string");
    // ... ctx.state was persisted ...
    assertEquals(loaded?.record.targets.deploy.meta.where, "sit-7");
    // ... and the secret parameter was excluded from the record.
    assertEquals(loaded?.record.params, { env: "sit" });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("with no state store, ctx.state is an in-memory no-op", async () => {
  let readBack: unknown;
  class B extends Build {
    a = target().executes(async (ctx) => {
      await ctx.state.set({ k: "v" });
      readBack = ctx.state.get().k;
    });
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.a, silent); // no stateStore
  assertEquals(result.ok, true);
  assertEquals(readBack, "v"); // visible within the run, persisted nowhere
});

Deno.test("a second run of a locked target fails with a typed conflict", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    let acquired: () => void = () => {};
    const ready = new Promise<void>((resolve) => (acquired = resolve));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const conflict = (h: { actor: string; runId: string }) =>
      `busy: held by ${h.actor} run ${h.runId}`;
    class Holder extends Build {
      promote = target()
        .lock((s) => s.key("deploy-x").withTtl("1h").onConflict(conflict))
        .executes(async () => {
          acquired();
          await gate;
        });
    }
    class Contender extends Build {
      promote = target()
        .lock((s) => s.key("deploy-x").withTtl("1h").onConflict(conflict))
        .executes(() => {});
    }
    const h = new Holder();
    discoverTargets(h);
    const c = new Contender();
    discoverTargets(c);

    const run1 = execute(h, h.promote, {
      silent: true,
      stateStore: store,
      actor: "alice",
    });
    await ready; // run1 holds the lock

    const result2 = await execute(c, c.promote, {
      silent: true,
      stateStore: store,
      actor: "bob",
    });
    assertEquals(result2.ok, false);
    assertEquals(result2.error instanceof LockConflictError, true);
    assertStringIncludes(messageOf(result2.error), "busy: held by alice");

    release();
    assertEquals((await run1).ok, true); // releases the lock

    // Free again — a later run acquires cleanly.
    const result3 = await execute(c, c.promote, {
      silent: true,
      stateStore: store,
      actor: "carol",
    });
    assertEquals(result3.ok, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a locked target with no store fails with a friendly error", async () => {
  class B extends Build {
    promote = target().lock((s) => s.key("k").withTtl("1h")).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.promote, {
    silent: true,
    stateStore: false,
  });
  assertEquals(result.ok, false);
  assertStringIncludes(messageOf(result.error), "no state store");
});

Deno.test("a lock with no key or no TTL fails with a friendly error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    class NoKey extends Build {
      go = target().lock((s) => s.withTtl("1h")).executes(() => {});
    }
    class NoTtl extends Build {
      go = target().lock((s) => s.lockKey("deploy")).executes(() => {});
    }
    const noKey = new NoKey();
    discoverTargets(noKey);
    const r1 = await execute(noKey, noKey.go, {
      silent: true,
      stateStore: store,
    });
    assertEquals(r1.ok, false);
    assertStringIncludes(messageOf(r1.error), "set no key");

    const noTtl = new NoTtl();
    discoverTargets(noTtl);
    const r2 = await execute(noTtl, noTtl.go, {
      silent: true,
      stateStore: store,
    });
    assertEquals(r2.ok, false);
    assertStringIncludes(messageOf(r2.error), "set no TTL");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cancelling a locked run releases the lock", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const controller = new AbortController();
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => (started = resolve));
    class B extends Build {
      hold = target().lock((s) => s.key("k").withTtl("1h")).executes((ctx) =>
        new Promise<void>((_, reject) => {
          started();
          ctx.signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        })
      );
    }
    const b = new B();
    discoverTargets(b);
    const run = execute(b, b.hold, {
      silent: true,
      stateStore: store,
      signal: controller.signal,
    });
    await ready;
    controller.abort();
    await run; // body rejects on abort → target fails → finally releases the lock

    const acq = await store.acquireLock("k", {
      actor: "x",
      runId: "r",
      since: "t",
    }, 1000);
    assertEquals(acq.ok, true); // lock was freed on cancellation
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an unsatisfied waitsFor suspends the run and records it", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const log: string[] = [];
    class B extends Build {
      deploy = target().executes(() => void log.push("deploy"));
      independent = target().executes(() => void log.push("independent"));
      rollback = target().executes(() => void log.push("rollback"));
      gate = target()
        .dependsOn(this.deploy)
        .waitsFor((s) =>
          s.on(externalSignal("approved")).timeout("72h").onTimeout(() =>
            this.rollback
          )
        );
      promote = target().dependsOn(this.gate).executes(() =>
        void log.push("promote")
      );
      all = target().dependsOn(this.promote, this.independent).executes(
        () => {},
      );
    }
    const b = new B();
    discoverTargets(b);

    const result = await execute(b, b.all, {
      silent: true,
      stateStore: store,
      parallel: true,
      actor: "alice",
    });
    assertEquals(result.ok, true); // suspended, not failed
    assertEquals(result.suspended, true);
    assertEquals(log.includes("deploy"), true);
    assertEquals(log.includes("independent"), true); // independent branch finished
    assertEquals(log.includes("promote"), false); // blocked behind the gate

    const summaries = await store.listRuns({});
    const loaded = await store.getRun(summaries[0].id);
    assertEquals(loaded?.record.status, "suspended");
    assertEquals(loaded?.record.targets.deploy.status, "succeeded");
    assertEquals(loaded?.record.targets.gate.status, "waiting");
    assertEquals(
      loaded?.record.targets.gate.waitingFor?.trigger,
      "signal:approved",
    );
    assertEquals(
      typeof loaded?.record.targets.gate.waitingFor?.deadline,
      "string",
    );
    assertEquals(loaded?.record.targets.gate.waitingFor?.onTimeout, {
      target: "rollback",
    });
    // promote is left pending (a resume runs it), not skipped.
    assertEquals(loaded?.record.targets.promote.status, "pending");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a satisfied waitsFor passes through and dependents run", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const log: string[] = [];
    class B extends Build {
      gate = target().waitsFor((s) => s.on(resumeWhen(() => true)));
      promote = target().dependsOn(this.gate).executes(() =>
        void log.push("promote")
      );
    }
    const b = new B();
    discoverTargets(b);

    const result = await execute(b, b.promote, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, true);
    assertEquals(result.suspended, undefined);
    assertEquals(log, ["promote"]);
    const loaded = await store.getRun((await store.listRuns({}))[0].id);
    assertEquals(loaded?.record.status, "succeeded");
    assertEquals(loaded?.record.targets.gate.status, "succeeded");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("waitsFor with no store fails with a friendly error", async () => {
  class B extends Build {
    gate = target().waitsFor((s) => s.on(externalSignal("x")));
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.gate, { silent: true, stateStore: false });
  assertEquals(result.ok, false);
  assertStringIncludes(messageOf(result.error), "needs a state store");
});

Deno.test("waitsFor with no trigger fails with a friendly error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    class B extends Build {
      gate = target().waitsFor((s) => s); // never called .on(...)
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.gate, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, false);
    assertStringIncludes(messageOf(result.error), "set no trigger");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a throwing onlyWhen predicate fails the target, not the process (sequential)", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    setup = target().executes(() => {});
    boom = target()
      .dependsOn(this.setup)
      .onlyWhen(() => {
        throw new Error("predicate boom");
      })
      .executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  // The predicate rejects outside runTarget's own try/catch; the run must still
  // finalize as failed (no unhandled rejection crashes the test process).
  const result = await execute(b, b.boom, { reporter, github: false });
  assertEquals(result.ok, false);
  assertEquals(lines.some((l) => l.includes("predicate boom")), true);
});

Deno.test("a throwing predicate settles the parallel scheduler without hanging", async () => {
  const { reporter } = recorder();
  class B extends Build {
    good = target().executes(() => {});
    bad = target()
      .onlyWhen(() => {
        throw new Error("predicate boom");
      })
      .executes(() => {});
    all = target().dependsOn(this.good, this.bad).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  // If the scheduler's `.then` had no `.catch`, `bad` would reject unobserved:
  // its slot never frees and the run would hang (or die). It must instead settle
  // as failed while the independent `good` still completes.
  const result = await execute(b, b.all, {
    reporter,
    parallel: true,
    github: false,
  });
  assertEquals(result.ok, false);
  assertEquals(result.executed.includes("good"), true);
});

Deno.test("a throwing cacheKey thunk fails the target, not the process (sequential)", async () => {
  const dir = await Deno.makeTempDir();
  const original = Deno.cwd();
  try {
    // Run from a temp dir so the default `.zuke` cache store never touches the
    // repo (the real cache is exercised: a cacheKey target is cacheable).
    await Deno.writeTextFile(`${dir}/zuke.json`, "{}\n");
    Deno.chdir(dir);
    const { lines, reporter } = recorder();
    class B extends Build {
      boom = target()
        // A cache-key contributor is evaluated by cache.upToDate, outside
        // runTarget's own try/catch (like onlyWhen). A throw here must finalize
        // the run as failed — never reject out of execute() (stranding the
        // record `running`) nor crash on an unhandled rejection.
        .cacheKey(() => {
          throw new Error("key boom");
        })
        .executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.boom, { reporter, github: false });
    assertEquals(result.ok, false);
    assertEquals(lines.some((l) => l.includes("key boom")), true);
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a throwing cacheKey settles the parallel scheduler without hanging", async () => {
  const dir = await Deno.makeTempDir();
  const original = Deno.cwd();
  try {
    await Deno.writeTextFile(`${dir}/zuke.json`, "{}\n");
    Deno.chdir(dir);
    const { reporter } = recorder();
    class B extends Build {
      good = target().executes(() => {});
      bad = target()
        .cacheKey(() => {
          throw new Error("key boom");
        })
        .executes(() => {});
      all = target().dependsOn(this.good, this.bad).executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    // The parallel scheduler's `.then(...).catch(...)` must route the rejecting
    // cacheKey into the failure path so the slot frees and the run settles,
    // instead of leaving `bad` stuck in the running set and hanging.
    const result = await execute(b, b.all, {
      reporter,
      parallel: true,
      github: false,
    });
    assertEquals(result.ok, false);
    assertEquals(result.executed.includes("good"), true);
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a rejected lock renewal never crashes the build", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // A store whose lock renewal always rejects, counting the heartbeat's calls.
    class RenewFails extends FileSystemStateStore {
      renewCalls = 0;
      override renewLock(
        _key: string,
        _token: string,
        _ttlMs: number,
      ): Promise<boolean> {
        this.renewCalls++;
        return Promise.reject(new Error("renew boom"));
      }
    }
    const store = new RenewFails(`${dir}/runs`, defaultStateHost);
    class B extends Build {
      work = target()
        .lock((s) => s.key("build-lock").withTtl("2s"))
        // Outlive the 1s renewal heartbeat so it fires (and rejects) mid-body.
        .executes(() => new Promise<void>((r) => setTimeout(r, 1200)));
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.work, {
      silent: true,
      stateStore: store,
    });
    // The heartbeat fired and its rejection was swallowed: the build still won.
    assertEquals(result.ok, true);
    assertEquals(store.renewCalls >= 1, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** A reporter whose every write throws — a buggy sink, or EPIPE on piped stdout. */
const throwingReporter: Reporter = {
  info: () => {
    throw new Error("EPIPE");
  },
  error: () => {
    throw new Error("EPIPE");
  },
};

Deno.test("a throwing reporter never strands the run record (sequential)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    class B extends Build {
      // A reject from outside runTarget's own try/catch, so failTarget prints
      // through the (throwing) reporter on the settle path.
      boom = target()
        .onlyWhen(() => {
          throw new Error("predicate boom");
        })
        .executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.boom, {
      reporter: throwingReporter,
      stateStore: store,
    });
    assertEquals(result.ok, false);
    const runs = await store.listRuns({});
    // The record is finalized, not left stranded `running` (un-resumable).
    assertEquals((await store.getRun(runs[0].id))?.record.status, "failed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a throwing reporter never hangs the parallel scheduler or strands the record", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    class B extends Build {
      good = target().executes(() => {});
      bad = target()
        .onlyWhen(() => {
          throw new Error("predicate boom");
        })
        .executes(() => {});
      all = target().dependsOn(this.good, this.bad).executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    // The `.catch` prints the failure through the throwing reporter; it must
    // still free the slot, pump, and finalize — never hang or leak a rejection.
    const result = await execute(b, b.all, {
      reporter: throwingReporter,
      parallel: true,
      stateStore: store,
    });
    assertEquals(result.ok, false);
    const runs = await store.listRuns({});
    assertEquals((await store.getRun(runs[0].id))?.record.status, "failed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a throwing predicate on a lenient target does not halt its siblings", async () => {
  const { reporter } = recorder();
  class B extends Build {
    bad = target()
      .proceedAfterFailure()
      .onlyWhen(() => {
        throw new Error("predicate boom");
      })
      .executes(() => {});
    sib = target().executes(() => {});
    root = target().dependsOn(this.bad, this.sib).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.root, {
    reporter,
    parallel: true,
    github: false,
  });
  // `bad` fails via the `.catch`, but being lenient it does not set `halted`, so
  // the independent `sib` still runs (root stays blocked behind bad).
  assertEquals(result.ok, false);
  assertEquals(result.executed.includes("sib"), true);
});

// --- Cancellation stops retries and remediations (F6) ---

Deno.test("a cancelled run stops retrying immediately", async () => {
  let attempts = 0;
  const controller = new AbortController();
  class B extends Build {
    doomed = target()
      .retry(5, 1)
      .executes(() => {
        attempts++;
        controller.abort(); // cancel synchronously mid-run
        throw new Error("boom");
      });
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.doomed, {
    silent: true,
    signal: controller.signal,
  });
  assertEquals(result.ok, false);
  assertEquals(attempts, 1); // no further retries after the cancel (pre-fix: 6)
});

Deno.test("a cancelled run does not invoke recoverWith remediations", async () => {
  let fixes = 0;
  const controller = new AbortController();
  class B extends Build {
    doomed = target()
      .recoverWith({
        remediate: () => {
          fixes++;
          return { retry: true };
        },
      })
      .recoverAttempts(3)
      .executes(() => {
        controller.abort();
        throw new Error("boom");
      });
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.doomed, {
    silent: true,
    signal: controller.signal,
  });
  assertEquals(result.ok, false);
  assertEquals(fixes, 0); // remediations skipped on cancel (pre-fix: 3)
});

// --- Public API validates the graph, emitting GraphError not TypeError (F10) ---

Deno.test("execute rejects a forward-referenced dependency with GraphError", async () => {
  class B extends Build {
    // @ts-expect-error -- deliberately forward-references a later field
    early = target().dependsOn(this.later).executes(() => {});
    later = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  await assertRejects(
    () => execute(b, b.early, silent),
    GraphError,
    "undefined target",
  );
});

// --- A failed run strands no `waiting` target row (F8) ---

Deno.test("a failed run leaves no waiting target stranded in the record", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    class B extends Build {
      // Independent branches: one parks at a wait gate, the other fails.
      gate = target().waitsFor((s) => s.on(externalSignal("go")));
      boom = target().executes(() => {
        throw new Error("boom");
      });
      all = target().dependsOn(this.gate, this.boom).executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.all, { silent: true, stateStore: store });
    assertEquals(result.ok, false); // failed, not suspended
    const runId = (await store.listRuns({}))[0].id;
    const loaded = await store.getRun(runId);
    assertEquals(loaded?.record.status, "failed");
    // No target row is left `waiting` in the terminal `failed` record (F8).
    const statuses = Object.values(loaded?.record.targets ?? {}).map(
      (t) => t.status,
    );
    assertEquals(statuses.includes("waiting"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("execute flags an ordering edge to a target not in the build", async () => {
  const { lines, reporter } = recorder();
  class Mono extends Build {
    a = target().executes(() => {});
    other = target().executes(() => {}); // declared, but not reached by `all`
    all = target().dependsOn(this.a).executes(() => {});
    override orderWith(t: Map<string, TargetBuilder>): OrderingEdge[] {
      const a = t.get("a"), other = t.get("other");
      // `ghost` is not a class field → never in the run nor the declared set, so
      // its edge is dead (mirrors a fan-out per-item name). `other` is declared
      // but not in this run → legitimately ignored, must NOT be flagged.
      const ghost = target();
      return a && other ? [[a, ghost], [a, other]] : [];
    }
  }
  const b = new Mono();
  discoverTargets(b);
  const result = await execute(b, b.all, { reporter, github: false });
  assertEquals(result.ok, true); // the dead edge is ignored; the run succeeds
  const out = lines.join("\n");
  assertStringIncludes(out, "not a target in this build"); // ghost flagged
  assertEquals(out.includes('"other"'), false); // conditional target not flagged
});
