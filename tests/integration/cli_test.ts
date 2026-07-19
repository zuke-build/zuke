/**
 * Integration: the CLI reserved-command surface, driven through the real CLI
 * `main()` (via {@link runCli}) rather than the unit-level `parseArgs`/`format*`
 * helpers. Covers `--list`/`--list --json`, `graph` (text and HTML), `generate-ci`
 * (write and `--check` drift), `completions print`, `--help`, and the
 * unknown-target error path.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, cicd, target } from "../../packages/core/mod.ts";
import { FakeGraphHost } from "../../packages/core/tests/_fakes.ts";
import { CONFIG_FILE } from "../../packages/core/src/config.ts";
import { runCli } from "./_harness.ts";

/** Run `fn` with the process cwd set to a fresh temp dir, cleaning up after. */
async function inTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-cli-" });
  const prev = Deno.cwd();
  Deno.chdir(dir);
  try {
    await fn(dir);
  } finally {
    Deno.chdir(prev);
    await Deno.remove(dir, { recursive: true });
  }
}

class Demo extends Build {
  clean = target().description("Remove artifacts").executes(() => {});
  build = target().description("Compile").dependsOn(this.clean).executes(
    () => {},
  );
}

Deno.test("--list names the declared targets", async () => {
  const { code, out } = await runCli(Demo, ["--list"]);
  assertEquals(code, 0);
  assertStringIncludes(out, "clean");
  assertStringIncludes(out, "build");
});

Deno.test("--list --json emits a valid, complete build-surface document", async () => {
  const { code, out } = await runCli(Demo, ["--list", "--json"]);
  assertEquals(code, 0);
  const surface = JSON.parse(out);
  const targetNames = surface.targets.map((t: { name: string }) => t.name);
  assertEquals(targetNames, ["clean", "build"]);
  assertEquals(surface.commands.length > 0, true);
  assertEquals(surface.flags.length > 0, true);
  assertEquals(Array.isArray(surface.parameters), true);
});

Deno.test("graph prints a dependency graph containing the target names", async () => {
  const { code, out } = await runCli(Demo, ["graph"]);
  assertEquals(code, 0);
  assertStringIncludes(out, "Dependency graph:");
  assertStringIncludes(out, "clean");
  assertStringIncludes(out, "build → clean");
});

Deno.test("graph --output=html renders through the injected GraphHost", async () => {
  const host = new FakeGraphHost("/repo", [`/repo/${CONFIG_FILE}`]);
  const { code } = await runCli(
    Demo,
    ["graph", "--output=html", "--no-open"],
    { graphHost: host },
  );
  assertEquals(code, 0);
  const written = host.files.get("/repo/.zuke/graph.html");
  assertEquals(written !== undefined, true);
  assertStringIncludes(written ?? "", "<html");
  assertEquals(host.opened, []); // --no-open: never handed to the browser opener
});

/** A build declaring a GitHub Actions workflow via `cicd(...)`. */
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

Deno.test("generate-ci writes the declared CI file", async () => {
  // Runs with cwd pointed at a throwaway temp dir so this never writes
  // `.github/...` into the repo tree.
  await inTempDir(async (dir) => {
    const { code, out } = await runCli(CiBuild, ["generate-ci"]);
    assertEquals(code, 0);
    assertStringIncludes(out, "Generated");
    const content = await Deno.readTextFile(
      `${dir}/.github/workflows/zuke.yml`,
    );
    assertStringIncludes(content, "name: CI");
  });
});

Deno.test("generate-ci --check reports drift when the file is absent", async () => {
  await inTempDir(async () => {
    const { code, err } = await runCli(CiBuild, ["generate-ci", "--check"]);
    assertEquals(code, 1);
    assertStringIncludes(err, "out of date");
  });
});

Deno.test("generate-ci --check reports drift when the file is stale", async () => {
  await inTempDir(async (dir) => {
    await Deno.mkdir(`${dir}/.github/workflows`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/.github/workflows/zuke.yml`,
      "stale content",
    );
    const { code, err } = await runCli(CiBuild, ["generate-ci", "--check"]);
    assertEquals(code, 1);
    assertStringIncludes(err, "out of date");
  });
});

/** A build whose workflow declares a daylight-saving-zone schedule. */
class ScheduledBuild extends Build {
  ci = cicd({
    provider: "github",
    path: ".github/workflows/nightly.yml",
    pipeline: {
      triggers: { schedule: [{ cron: "30 9 * * 1-4", tz: "Europe/Sofia" }] },
      jobs: [{ id: "test", steps: [{ run: "deno task ci" }] }],
    },
  });
  build = target().executes(() => {});
}

Deno.test("generate-ci writes a timezone-aware scheduled workflow", async () => {
  await inTempDir(async (dir) => {
    const first = await runCli(ScheduledBuild, ["generate-ci"]);
    assertEquals(first.code, 0);
    const content = await Deno.readTextFile(
      `${dir}/.github/workflows/nightly.yml`,
    );
    // A DST zone → dual UTC crons plus a guard job the real job waits on.
    assertStringIncludes(content, "schedule:");
    assertStringIncludes(content, "zuke-schedule-guard:");
    assertStringIncludes(content, "TZ='Europe/Sofia' date");
    // Deterministic: a --check immediately after writing sees no drift.
    const check = await runCli(ScheduledBuild, ["generate-ci", "--check"]);
    assertEquals(check.code, 0);
  });
});

for (const shell of ["bash", "zsh", "fish"]) {
  Deno.test(`completions print ${shell} emits a non-empty script naming the targets`, async () => {
    const { code, out } = await runCli(Demo, ["completions", "print", shell]);
    assertEquals(code, 0);
    assertEquals(out.length > 0, true);
    assertStringIncludes(out, "zuke");
    assertStringIncludes(out, "build");
  });
}

Deno.test("--help prints usage", async () => {
  const { code, out } = await runCli(Demo, ["--help"]);
  assertEquals(code, 0);
  assertStringIncludes(out, "Usage:");
});

Deno.test("an unknown target exits 1 with a helpful message", async () => {
  const { code, err } = await runCli(Demo, ["nope"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "Unknown target: nope");
  assertStringIncludes(err, "Targets:");
});
