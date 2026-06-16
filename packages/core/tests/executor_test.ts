import { assertEquals, messageOf } from "./_assert.ts";
import { Build, type BuildResult, discoverTargets } from "../src/build.ts";
import { group, target } from "../src/target.ts";
import {
  execute,
  type ExecuteOptions,
  type Reporter,
} from "../src/executor.ts";

const silent: ExecuteOptions = { silent: true };

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

Deno.test("plain mode prints start/success banners and a summary", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    work = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.work, { reporter, github: false });
  assertEquals(lines[0], "▶ work");
  assertEquals(lines[1].startsWith("✔ work ("), true);
  const summary = lines[lines.length - 1];
  assertEquals(summary.includes("Build summary:"), true);
  assertEquals(summary.includes("SUCCESS"), true);
  assertEquals(summary.includes("1/1 targets"), true);
});

Deno.test("plain mode reports a failure banner and summary", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    boom = target().executes(() => {
      throw new Error("nope");
    });
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.boom, { reporter, github: false });
  assertEquals(lines.some((l) => l.startsWith("✘ boom (")), true);
  assertEquals(lines.includes("nope"), true);
  assertEquals(lines[lines.length - 1].includes("FAILED"), true);
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
  assertEquals(lines.includes("string failure"), true);
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
  assertEquals(lines.some((l) => l.startsWith("✔ work (")), true);
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

Deno.test("summary lists skipped targets and counts", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    setup = target().executes(() => {});
    main = target().dependsOn(this.setup).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.main, { reporter, github: false, skip: ["setup"] });
  const summary = lines[lines.length - 1];
  assertEquals(summary.includes("⊘ setup"), true);
  assertEquals(summary.includes("skipped"), true);
  assertEquals(summary.includes("✔ main"), true);
  assertEquals(summary.includes("1/2 targets"), true);
});

Deno.test("targets after a failure are marked skipped in the summary", async () => {
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
  const summary = lines[lines.length - 1];
  assertEquals(summary.includes("✔ first"), true);
  assertEquals(summary.includes("✘ boom"), true);
  assertEquals(summary.includes("⊘ last"), true);
  assertEquals(summary.includes("FAILED"), true);
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
    assertEquals(lines[0], "▶ work");
  });
});

Deno.test("github mode appends a Markdown job summary", async () => {
  const tmp = await Deno.makeTempFile();
  const { reporter } = recorder();
  class B extends Build {
    a = target().executes(() => {});
    b = target().dependsOn(this.a).executes(() => {});
  }
  const build = new B();
  discoverTargets(build);

  try {
    await withEnv("GITHUB_STEP_SUMMARY", tmp, async () => {
      await execute(build, build.b, { reporter, github: true });
    });
    const md = await Deno.readTextFile(tmp);
    assertEquals(md.includes("Zuke build"), true);
    assertEquals(md.includes("| Target | Result | Time |"), true);
    assertEquals(md.includes("| a | ✔ passed |"), true);
  } finally {
    await Deno.remove(tmp);
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
  assertEquals(captured.some((l) => l.includes("SUCCESS")), true);
  assertEquals(captured.some((l) => l.includes("FAILED")), true);
});

Deno.test("colour mode wraps output in ANSI codes", async () => {
  const { lines, reporter } = recorder();
  class B extends Build {
    work = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.work, { reporter, github: false, color: true });
  assertEquals(lines[0].includes("\x1b["), true);
  assertEquals(lines[0].includes("▶ work"), true);
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
  assertEquals(lines[0], "▶ a"); // no leading blank before the first target
  assertEquals(lines[lines.indexOf("▶ b") - 1], ""); // blank before the second
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
  assertEquals(plain.lines.some((l) => l.startsWith("▶ a")), true);
  assertEquals(plain.lines.includes("nope"), true);
  assertEquals(plain.lines.includes(""), true); // blank separator between blocks
  assertEquals(plain.lines[plain.lines.length - 1].includes("FAILED"), true);

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
  assertEquals(gh.lines[open + 1].startsWith("✔ a ("), true);
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

Deno.test("an unwritable job-summary file never fails the build", async () => {
  const dir = await Deno.makeTempDir(); // a directory is not writable as a file
  const { reporter } = recorder();
  class B extends Build {
    work = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  try {
    let result: BuildResult | undefined;
    await withEnv("GITHUB_STEP_SUMMARY", dir, async () => {
      result = await execute(b, b.work, { reporter, github: true });
    });
    assertEquals(result?.ok, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
