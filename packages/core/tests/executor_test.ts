import { assertEquals, messageOf } from "./_assert.ts";
import { Build, type BuildResult, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
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
