// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration tests for a run's **initiator** — who asked for the run, as
 * distinct from `actor`, which every resume rewrites with whoever picked the run
 * up.
 *
 * What these prove that a unit test cannot: the whole CLI path stamps the
 * initiator once, a real suspend-and-resume under a *different* actor leaves it
 * alone while moving `actor`, and `runs show` / `runs list --initiator` read it
 * back from the persisted record.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  externalSignal,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** The id of the (single) run the CLI persisted under `dir`. */
async function onlyRunId(dir: string): Promise<string> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const runs = await store.listRuns({});
  assertEquals(runs.length, 1);
  return runs[0].id;
}

/** The persisted record for run `id`. */
async function recordOf(dir: string, id: string) {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const got = await store.getRun(id);
  if (got === null) throw new Error(`no run record for ${id}`);
  return got.record;
}

/** A build that parks on a signal, so a second process can resume it. */
class Gated extends Build {
  approve = target()
    .waitsFor((s) => s.on(externalSignal("go")))
    .executes(() => {});
}

/** A build that just runs, for the non-suspending cases. */
class Simple extends Build {
  deploy = target().description("Deploy").executes(() => {});
}

Deno.test("a run records who started it, beside its last writer", async () => {
  await withStateDir(async (dir) => {
    const { code } = await runCli(Simple, [
      "deploy",
      "--state",
      "--actor",
      "engineer-a",
    ]);
    assertEquals(code, 0);
    const record = await recordOf(dir, await onlyRunId(dir));
    assertEquals(record.actor, "engineer-a");
    assertEquals(record.initiator?.actor, "engineer-a");
    // Unstated, so the conservative default — never inferred from the name.
    assertEquals(record.initiator?.kind, "human");
    assertEquals(record.initiator?.at, record.createdAt);
  });
});

Deno.test("--actor-kind states a service claim", async () => {
  await withStateDir(async (dir) => {
    const { code } = await runCli(Simple, [
      "deploy",
      "--state",
      "--actor",
      "nightly",
      "--actor-kind",
      "service",
    ]);
    assertEquals(code, 0);
    const record = await recordOf(dir, await onlyRunId(dir));
    assertEquals(record.initiator?.kind, "service");
  });
});

Deno.test("a typo in --actor-kind fails the run rather than defaulting", async () => {
  // An explicit flag was typed by someone who meant something by it, so a
  // misspelling is an error — unlike ZUKE_ACTOR_KIND, which stays lenient
  // because it can arrive from anywhere.
  const { code, err } = await runCli(Simple, [
    "deploy",
    "--actor-kind",
    "robot",
  ]);
  assertEquals(code, 1);
  assertStringIncludes(err, "--actor-kind must be one of: human, service");
  assertStringIncludes(err, "robot");
});

Deno.test("a resume moves the actor and leaves the initiator alone", async () => {
  // The guarantee the whole field exists for: an engineer starts a deploy, it
  // parks on a gate, and a sweep's service account resumes it. `actor` becomes
  // the sweep; the answer to "whose run is this" must not.
  await withStateDir(async (dir) => {
    const first = await runCli(Gated, [
      "approve",
      "--state",
      "--actor",
      "engineer-a",
    ]);
    assertEquals(first.code, 0);
    const id = await onlyRunId(dir);
    assertEquals((await recordOf(dir, id)).status, "suspended");

    // A second process, under a different identity, delivers the signal.
    const resumed = await runCli(Gated, [
      "resume",
      id,
      "--signal",
      "go",
      "--actor",
      "sweep-bot",
    ]);
    assertEquals(resumed.code, 0, resumed.err);

    const record = await recordOf(dir, id);
    assertEquals(record.status, "succeeded");
    assertEquals(record.actor, "sweep-bot"); // the last writer moved
    assertEquals(record.initiator?.actor, "engineer-a"); // the owner did not
    assertEquals(record.initiator?.kind, "human");
  });
});

Deno.test("runs show names the initiator, and runs list filters by it", async () => {
  await withStateDir(async (dir) => {
    assertEquals(
      (await runCli(Simple, ["deploy", "--state", "--actor", "engineer-a"]))
        .code,
      0,
    );
    const id = await onlyRunId(dir);

    const shown = await runCli(Simple, ["runs", "show", id]);
    assertEquals(shown.code, 0);
    assertStringIncludes(shown.out, "started:  engineer-a (human)");

    // The filter matches the run its initiator started…
    const mine = await runCli(Simple, [
      "runs",
      "list",
      "--initiator",
      "engineer-a",
    ]);
    assertEquals(mine.code, 0);
    assertStringIncludes(mine.out, id);

    // …and excludes it for anyone else, rather than silently listing everything.
    const theirs = await runCli(Simple, [
      "runs",
      "list",
      "--initiator",
      "someone-else",
    ]);
    assertEquals(theirs.code, 0);
    assertStringIncludes(theirs.out, "No runs found.");
  });
});

Deno.test("a resumed run is still found by the person who started it", async () => {
  // The filter reads the initiator, not the actor — so a run a sweep has
  // touched is still the engineer's when they go looking for it.
  await withStateDir(async (dir) => {
    assertEquals(
      (await runCli(Gated, ["approve", "--state", "--actor", "engineer-a"]))
        .code,
      0,
    );
    const id = await onlyRunId(dir);
    assertEquals(
      (await runCli(Gated, [
        "resume",
        id,
        "--signal",
        "go",
        "--actor",
        "sweep",
      ]))
        .code,
      0,
    );

    const mine = await runCli(Gated, [
      "runs",
      "list",
      "--initiator",
      "engineer-a",
    ]);
    assertStringIncludes(mine.out, id);

    // The sweep that resumed it did not become its owner.
    const sweep = await runCli(Gated, ["runs", "list", "--initiator", "sweep"]);
    assertStringIncludes(sweep.out, "No runs found.");
  });
});

// ---- Regressions from the adversarial review -------------------------------

Deno.test("a legacy record keeps its starter when a resume would erase it", async () => {
  // A record written before initiators existed still knows who started it — in
  // `actor`, right until a resume overwrites that. Without a backfill the run
  // would silently become the sweep's, which is the exact confusion the field
  // exists to prevent.
  await withStateDir(async (dir) => {
    assertEquals(
      (await runCli(Gated, ["approve", "--state", "--actor", "engineer-a"]))
        .code,
      0,
    );
    const id = await onlyRunId(dir);

    // Strip the field, so the record reads as one written before this shipped.
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const before = await store.getRun(id);
    if (before === null) throw new Error("no record");
    const legacy = { ...before.record };
    delete legacy.initiator;
    await store.putRun(legacy, before.version);
    assertEquals((await recordOf(dir, id)).initiator, undefined);

    // A sweep resumes it under its own identity.
    assertEquals(
      (await runCli(Gated, [
        "resume",
        id,
        "--signal",
        "go",
        "--actor",
        "sweeper-bot",
      ])).code,
      0,
    );

    const record = await recordOf(dir, id);
    assertEquals(record.actor, "sweeper-bot");
    // Captured from the actor at the moment it was about to be overwritten,
    // dated to the original run rather than to the backfill.
    assertEquals(record.initiator?.actor, "engineer-a");
    assertEquals(record.initiator?.kind, "human");
    assertEquals(record.initiator?.at, record.createdAt);

    // And the filter now answers correctly in both directions.
    assertStringIncludes(
      (await runCli(Gated, ["runs", "list", "--initiator", "engineer-a"])).out,
      id,
    );
    assertStringIncludes(
      (await runCli(Gated, ["runs", "list", "--initiator", "sweeper-bot"])).out,
      "No runs found.",
    );
  });
});

Deno.test("--initiator with --limit returns that actor's newest, not nothing", async () => {
  // `--limit` is applied by the store and the initiator filter runs after it,
  // so truncating first would answer "whose runs are among the newest N" —
  // usually none of them — when the question was "this actor's newest N".
  await withStateDir(async (dir) => {
    assertEquals(
      (await runCli(Simple, ["deploy", "--state", "--actor", "alice"])).code,
      0,
    );
    for (let i = 0; i < 3; i++) {
      assertEquals(
        (await runCli(Simple, ["deploy", "--state", "--actor", "bob"])).code,
        0,
      );
    }
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const all = await store.listRuns({});
    assertEquals(all.length, 4);
    const aliceRun = all.find((s) => s.initiator?.actor === "alice");
    if (aliceRun === undefined) throw new Error("no run for alice");

    // Alice's single run is the oldest of the four, so a store-side limit of 2
    // would have hidden it entirely.
    const limited = await runCli(Simple, [
      "runs",
      "list",
      "--initiator",
      "alice",
      "--limit",
      "2",
    ]);
    assertEquals(limited.code, 0);
    assertStringIncludes(limited.out, aliceRun.id);

    // The limit still bounds the result for an actor who has more than it.
    const bobs = await runCli(Simple, [
      "runs",
      "list",
      "--initiator",
      "bob",
      "--limit",
      "2",
    ]);
    assertEquals(bobs.out.trim().split("\n").length, 3); // header + 2 rows
  });
});

Deno.test("both new flags are in the CLI surface", async () => {
  // They drive `--list --json` and the generated shell completions, so a flag
  // missing from the registry is invisible to every tool that reads it.
  const { code, out } = await runCli(Simple, ["--list", "--json"]);
  assertEquals(code, 0);
  const surface = JSON.parse(out);
  const names = surface.flags.map((f: { name: string }) => f.name);
  assertEquals(names.includes("--actor-kind"), true, out);
  assertEquals(names.includes("--initiator"), true, out);
});
