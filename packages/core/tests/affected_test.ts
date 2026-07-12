import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "./_assert.ts";
import { target } from "../src/target.ts";
import { plan } from "../src/graph.ts";
import {
  affectedTargets,
  gitChangedFiles,
  runGitProcess,
} from "../src/affected.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { execute, type Reporter } from "../src/executor.ts";

/** Whether the affected set (by identity) contains `t`. */
const has = (set: Set<unknown>, t: unknown) => set.has(t);

Deno.test("affectedTargets: a target's own inputs gate it", () => {
  const a = target().inputs("packages/a");
  const b = target().inputs("packages/b").dependsOn(a);
  const order = plan(b); // [a, b]

  const forB = affectedTargets(order, ["packages/b/y.ts"]);
  assertEquals(has(forB, a), false); // a's inputs unchanged
  assertEquals(has(forB, b), true); // b's own inputs changed

  const none = affectedTargets(order, ["unrelated/z.ts"]);
  assertEquals(none.size, 0);
});

Deno.test("affectedTargets: affectedness propagates along dependencies", () => {
  const a = target().inputs("packages/a");
  const b = target().inputs("packages/b").dependsOn(a);
  const order = plan(b);

  const set = affectedTargets(order, ["packages/a/x.ts"]);
  assertEquals(has(set, a), true); // changed directly
  assertEquals(has(set, b), true); // dirtied by its dependency
});

Deno.test("affectedTargets: a target with no inputs is always affected", () => {
  const c = target();
  const set = affectedTargets(plan(c), []);
  assertEquals(has(set, c), true);
});

Deno.test("affectedTargets: an affected target pulls its triggers along", () => {
  const t2 = target().inputs("y");
  const t1 = target().inputs("x").triggers(t2);
  const order = plan(t1); // t1 before its trigger t2

  const viaTrigger = affectedTargets(order, ["x/f.ts"]);
  assertEquals(has(viaTrigger, t1), true); // own inputs changed
  assertEquals(has(viaTrigger, t2), true); // pulled in by the trigger, though y is unchanged

  const neither = affectedTargets(order, ["z/f.ts"]);
  assertEquals(neither.size, 0);
});

Deno.test("affectedTargets: input matching covers files, directories, and the repo root", () => {
  const dir = target().inputs("src");
  assertEquals(has(affectedTargets([dir], ["src/a.ts"]), dir), true);
  assertEquals(has(affectedTargets([dir], ["./src/a.ts"]), dir), true); // leading ./
  assertEquals(has(affectedTargets([dir], ["src\\a.ts"]), dir), true); // backslashes
  assertEquals(has(affectedTargets([dir], ["src-lib/a.ts"]), dir), false); // prefix isn't a path segment

  const file = target().inputs("config.json");
  assertEquals(has(affectedTargets([file], ["config.json"]), file), true);
  assertEquals(has(affectedTargets([file], ["config.json.map"]), file), false);

  const wholeRepo = target().inputs(".");
  assertEquals(
    has(affectedTargets([wholeRepo], ["anywhere/x"]), wholeRepo),
    true,
  );

  const trailingSlash = target().inputs("src/");
  assertEquals(
    has(affectedTargets([trailingSlash], ["src/a.ts"]), trailingSlash),
    true,
  );

  // Empty changed entries are ignored rather than matching everything.
  const empty = target().inputs("src");
  assertEquals(has(affectedTargets([empty], [""]), empty), false);
});

Deno.test("gitChangedFiles queries git and merges tracked + untracked, deduped", async () => {
  const calls: string[][] = [];
  const run = (args: string[]): Promise<string> => {
    calls.push(args);
    return Promise.resolve(
      args[0] === "diff" ? "a.ts\n b.ts \n\n" : "a.ts\nc.ts\n",
    );
  };
  const files = await gitChangedFiles("main", run);
  assertEquals(files, ["a.ts", "b.ts", "c.ts"]); // trimmed, blank dropped, a.ts deduped
  assertEquals(calls[0], ["diff", "--name-only", "main", "--"]);
  assertEquals(calls[1], ["ls-files", "--others", "--exclude-standard"]);
});

Deno.test("gitChangedFiles defaults the base to HEAD", async () => {
  const calls: string[][] = [];
  const run = (args: string[]): Promise<string> => {
    calls.push(args);
    return Promise.resolve("");
  };
  await gitChangedFiles(undefined, run);
  assertEquals(calls[0][2], "HEAD");
});

Deno.test("runGitProcess returns stdout of a successful process", async () => {
  // Stand in the running `deno` for `git` (always present, shell-free).
  const out = await runGitProcess(
    ["eval", "console.log('src/a.ts'); console.log('src/b.ts')"],
    Deno.execPath(),
  );
  assertEquals(out.trim().split("\n"), ["src/a.ts", "src/b.ts"]);
});

Deno.test("runGitProcess throws with stderr detail on a non-zero exit", async () => {
  const err = await assertRejects(() =>
    runGitProcess(
      ["eval", "console.error('bad revision'); Deno.exit(1)"],
      Deno.execPath(),
    )
  );
  assertStringIncludes(err.message, "failed");
  assertStringIncludes(err.message, "bad revision");
});

Deno.test("runGitProcess throws without detail when a failure prints nothing", async () => {
  const err = await assertRejects(() =>
    runGitProcess(["eval", "Deno.exit(2)"], Deno.execPath())
  );
  assertStringIncludes(err.message, "Is this a git repository");
});

Deno.test("runGitProcess reports a friendly error when git cannot be spawned", async () => {
  const err = await assertRejects(() =>
    runGitProcess(["diff"], "zuke-no-such-binary-xyz")
  );
  assertStringIncludes(err.message, "could not run");
});

/** A reporter that records every emitted line. */
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

Deno.test("execute --affected skips targets a change cannot reach", async () => {
  class B extends Build {
    a = target().inputs("packages/a").executes(() => {});
    b = target().inputs("packages/b").dependsOn(this.a).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.b, {
    silent: true,
    cache: false,
    affected: {
      base: "origin/main",
      changedFiles: () => Promise.resolve(["packages/b/f.ts"]),
    },
  });
  assertEquals(result.executed, ["b"]); // a is unaffected and skipped; b still runs
});

Deno.test("execute --affected reports when nothing is affected", async () => {
  class B extends Build {
    a = target().inputs("packages/a").executes(() => {});
    b = target().inputs("packages/b").dependsOn(this.a).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  const { lines, reporter } = recorder();
  const result = await execute(b, b.b, {
    reporter,
    cache: false,
    // No base → defaults to HEAD; changedFiles injected so no git is needed.
    affected: { changedFiles: () => Promise.resolve(["unrelated/z"]) },
  });
  assertEquals(result.executed, []);
  assertStringIncludes(
    lines.join("\n"),
    "No targets affected by changes since HEAD.",
  );
});
