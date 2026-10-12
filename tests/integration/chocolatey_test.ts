// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `@zuke/chocolatey`: a real build, driven through the
 * CLI `main()`, renders a package in one target, verifies it in the next and
 * publishes it in a third — against a fake `choco` found on `PATH` the way the
 * real one would be, with no `.toolPath(...)`. The API key is a secret
 * parameter, so the run's own redactor masks it in what the build prints.
 *
 * The fake is a POSIX shim that runs a TypeScript stand-in with the running
 * `deno` (`Deno.execPath()`), so the test needs nothing else installed. It is
 * skipped on Windows, which cannot launch the shell shims.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { withEnv } from "../../packages/core/tests/_env.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import {
  type ChocolateyPackage,
  type ChocolateyPublishResult,
  ChocolateyTasks,
} from "../../packages/chocolatey/mod.ts";
import {
  FAKE_CHOCO_UNSUPPORTED,
  fakeChoco,
} from "../../packages/chocolatey/tests/_fake_choco.ts";
import { runCli } from "./_harness.ts";

/** A stand-in Chocolatey API key: the test checks it never reaches the output. */
const API_KEY = "integration-key-123"; // gitleaks:allow — a test stand-in, not a credential

/** The package every build here renders. */
function render(): ChocolateyPackage {
  return ChocolateyTasks.package((s) =>
    s.id("app").version("1.2.3").authors("Acme")
      .projectUrl("https://example.com")
      .description("Command-line tool that builds and ships widgets")
      .url64bit("https://example.com/app-1.2.3.zip")
      .checksum64("cd".repeat(32))
  );
}

Deno.test({
  name:
    "chocolatey: a build renders, verifies and publishes with choco from PATH",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco();
    const ran: string[] = [];
    let published: ChocolateyPublishResult | undefined;

    class Release extends Build {
      chocoApiKey = parameter("Chocolatey API key").secret();
      pkg?: ChocolateyPackage;
      render = target().description("render the package").executes(() => {
        ran.push("render");
        this.pkg = render();
      });
      verify = target().description("install, run and uninstall it")
        .dependsOn(this.render)
        .executes(async () => {
          ran.push("verify");
          const pkg = this.pkg;
          if (pkg === undefined) throw new Error("not rendered");
          await ChocolateyTasks.verify((s) =>
            s.package(pkg).binary("app").command("--version").expectVersion()
          );
        });
      publish = target().description("push it").dependsOn(this.verify)
        .executes(async () => {
          ran.push("publish");
          const pkg = this.pkg;
          if (pkg === undefined) throw new Error("not rendered");
          published = await ChocolateyTasks.publish((s) =>
            s.package(pkg).apiKey(this.chocoApiKey.value ?? "")
          );
        });
    }

    try {
      await withEnv(
        {
          ...choco.env,
          PATH: `${choco.binDir}:${Deno.env.get("PATH") ?? ""}`,
          CHOCO_API_KEY: API_KEY,
          // On an Actions runner the build prints `::add-mask::<secret>` so
          // the runner masks it — the one place the key is meant to appear.
          // Run as a local build, so the assertion below covers every line.
          GITHUB_ACTIONS: undefined,
        },
        async () => {
          const result = await runCli(Release, ["publish"]);
          assertEquals(result.code, 0, result.err);
          assertEquals(
            `${result.out}\n${result.err}`.includes(API_KEY),
            false,
          );
        },
      );
      assertEquals(ran, ["render", "verify", "publish"]);
      assertEquals(published, {
        source: "https://push.chocolatey.org/",
        nupkg: "app.1.2.3.nupkg",
      });
      const calls = choco.calls();
      assertEquals(calls.map((call) => call.args[0]), [
        "pack",
        "install",
        "uninstall",
        "pack",
        "push",
      ]);
      assertEquals(
        calls[4].args.includes(`--api-key=${API_KEY}`),
        true,
      );
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name:
    "chocolatey: a failing verification fails the build and still cleans up",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco(["shim"]);

    class Release extends Build {
      verify = target().executes(() =>
        ChocolateyTasks.verify((s) =>
          s.package(render()).binary("app").command("--version")
        )
      );
    }

    try {
      await withEnv(
        {
          ...choco.env,
          PATH: `${choco.binDir}:${Deno.env.get("PATH") ?? ""}`,
        },
        async () => {
          const result = await runCli(Release, ["verify"]);
          assertEquals(result.code, 1);
        },
      );
      const verbs = choco.calls().map((call) => call.args[0]);
      assertEquals(verbs, ["pack", "install", "uninstall"]);
    } finally {
      choco.dispose();
    }
  },
});
