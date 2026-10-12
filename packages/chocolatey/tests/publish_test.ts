// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `ChocolateyTasks.publish`, against a fake `choco` process:
 * a rendered package is packed and pushed from a staging directory that is
 * always removed, a built `.nupkg` is pushed as it is, and the API key never
 * appears in an error.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { type ChocolateyPackage, ChocolateyTasks } from "../mod.ts";
import { FAKE_CHOCO_UNSUPPORTED, fakeChoco } from "./_fake_choco.ts";

/** A rendered package to publish. */
const PKG: ChocolateyPackage = ChocolateyTasks.package((s) =>
  s.id("app").version("1.2.3").authors("Acme")
    .projectUrl("https://example.com")
    .description("Command-line tool that builds and ships widgets")
    .url64bit("https://example.com/app.zip").checksum64("ab".repeat(32))
);

/** Whether `path` exists. */
function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name:
    "publish: a rendered package is packed and pushed to the community feed",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco();
    try {
      await withEnv(choco.env, async () => {
        const result = await ChocolateyTasks.publish((s) =>
          s.package(PKG).apiKey("hidden-key").toolPath(choco.choco)
        );
        assertEquals(result, {
          source: "https://push.chocolatey.org/",
          nupkg: "app.1.2.3.nupkg",
        });
      });
      const calls = choco.calls();
      assertEquals(calls.map((call) => call.args[0]), ["pack", "push"]);
      const staging = calls[0].cwd;
      // Pushed by file name, from the directory it was packed in.
      assertEquals(calls[1].cwd, staging);
      assertEquals(calls[1].args, [
        "push",
        "app.1.2.3.nupkg",
        "--source=https://push.chocolatey.org/",
        "--api-key=hidden-key",
      ]);
      assertEquals(exists(staging), false);
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name: "publish: a built .nupkg is pushed as it is, to the source given",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco();
    try {
      await withEnv(choco.env, async () => {
        const result = await ChocolateyTasks.publish((s) =>
          s.nupkg("dist/app.1.2.3.nupkg").source("https://feed.example.com/")
            .toolPath(choco.choco)
        );
        assertEquals(result, {
          source: "https://feed.example.com/",
          nupkg: "app.1.2.3.nupkg",
        });
      });
      // No key given: choco looks up the one saved for the source.
      assertEquals(choco.calls().map((call) => call.args), [[
        "push",
        "dist/app.1.2.3.nupkg",
        "--source=https://feed.example.com/",
      ]]);
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name: "publish: a failed push masks the key, and still removes the staging",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco(["push"]);
    try {
      await withEnv(choco.env, async () => {
        const error = await assertRejects(
          () =>
            ChocolateyTasks.publish((s) =>
              s.package(PKG).apiKey("hidden-key-abc").toolPath(choco.choco)
            ),
          Error,
          "--api-key=[redacted]",
        );
        assertEquals(String(error).includes("hidden-key-abc"), false);
        assertStringIncludes(String(error), "choco push");
      });
      assertEquals(exists(choco.calls()[0].cwd), false);
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name: "publish: a failed pack pushes nothing",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco(["pack"]);
    try {
      await withEnv(choco.env, async () => {
        await assertRejects(
          () =>
            ChocolateyTasks.publish((s) =>
              s.package(PKG).apiKey("k").toolPath(choco.choco)
            ),
          Error,
          "choco pack",
        );
      });
      assertEquals(choco.calls().map((call) => call.args[0]), ["pack"]);
    } finally {
      choco.dispose();
    }
  },
});

Deno.test("publish: what to push, and where, is checked before choco runs", async () => {
  const cases: Array<
    [Parameters<typeof ChocolateyTasks.publish>[0], string]
  > = [
    [(s) => s.apiKey("k"), "requires .package(...)"],
    [(s) => s.package(PKG).nupkg("x.nupkg"), "not both"],
    [(s) => s.package(PKG).apiKey(""), "empty .apiKey(...)"],
    [
      (s) => s.nupkg("x.nupkg").source("http://feed.example.com/"),
      "must be an https:// URL",
    ],
    [(s) => s.nupkg("x.nupkg").source("C:\\feed"), "not c://"],
    [(s) => s.nupkg("x.nupkg").source("feed"), "well-formed https://"],
    [(s) => s.package({ ...PKG, id: "../x" }), "invalid package id"],
  ];
  for (const [configure, message] of cases) {
    await assertRejects(
      () =>
        ChocolateyTasks.publish((s) => configure(s).toolPath("/nonexistent")),
      Error,
      message,
    );
  }
});
