// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The CLI's standalone release, end to end through a real build: a run that
 * plans, packages, and verifies the formula and the Chocolatey package the
 * way release.yml's jobs do, driven through the CLI `main()` — with GitHub,
 * `brew` and `choco` replaced by fakes that serve and check what the earlier
 * targets wrote.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { withTemp, withTempCwd } from "../../packages/core/tests/_temp.ts";
import {
  absolutePath,
  Build,
  gunzip,
  sha256Hex,
  target,
  untar,
  unzip,
} from "@zuke/core";
import { ChocolateyVerifySettings } from "@zuke/chocolatey";
import { HomebrewVerifySettings } from "@zuke/homebrew";
import { runCli } from "./_harness.ts";
import {
  archiveName,
  CHECKSUMS,
  CLI_TARGETS,
  parseChecksums,
  planCliRelease,
  releaseAssetUrl,
  WINDOWS_TRIPLE,
  windowsArchiveName,
} from "../../build/cli_release.ts";
import { verifyCliChocolatey } from "../../build/cli_chocolatey.ts";
import { binaryPath, packageCliArchives } from "../../build/cli_package.ts";
import { verifyCliFormula } from "../../build/cli_publish.ts";
import { assertReportsVersion } from "../../build/cli_compile.ts";
import { writeStepOutputs } from "../../build/step_outputs.ts";

const VERSION = "1.14.0";

Deno.test("a release run plans, packages, and verifies the formula and package that pin what it packed", async () => {
  await withTemp(async (dir) => {
    const bin = `${dir}/bin`;
    const release = `${dir}/release`;
    const outputs = `${dir}/github_output`;
    for (
      const triple of [...CLI_TARGETS.map((t) => t.triple), WINDOWS_TRIPLE]
    ) {
      await Deno.mkdir(`${bin}/${triple}`, { recursive: true });
      await Deno.writeTextFile(binaryPath(bin, triple), `zuke for ${triple}`);
    }
    // GitHub, as the release looks once `package`'s output is attached and
    // the draft published: it serves the manifest and archives this run wrote.
    const published = new Set<string>();
    const github: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      for (const name of published) {
        if (url === releaseAssetUrl(VERSION, name)) {
          return new Response(await Deno.readFile(`${release}/${name}`));
        }
      }
      return new Response("", { status: 404 });
    };
    const installed: string[] = [];

    class ReleaseRun extends Build {
      plan = target().executes(async () => {
        const plan = await planCliRelease(VERSION, {
          // The draft is published once its assets are attached.
          releasePublished: () => Promise.resolve(published.has(CHECKSUMS)),
          checksumsPublished: () => Promise.resolve(published.has(CHECKSUMS)),
          tapFormula: () => Promise.resolve(undefined),
          windowsArchivePublished: () =>
            Promise.resolve(published.has(windowsArchiveName(VERSION))),
          chocolateyPublished: () => Promise.resolve(false),
        });
        await writeStepOutputs({
          build: String(plan.build),
          tap: String(plan.tap),
          chocolatey: String(plan.chocolatey),
        }, outputs);
      });
      package = target().dependsOn(this.plan).executes(async () => {
        await packageCliArchives(VERSION, bin, release);
        for (const t of CLI_TARGETS) published.add(archiveName(VERSION, t));
        published.add(windowsArchiveName(VERSION));
        published.add(CHECKSUMS);
      });
      chocolatey = target().dependsOn(this.package).executes(async () => {
        await verifyCliChocolatey(VERSION, github, {
          verify: async (configure) => {
            // Stand in for `choco install`: fetch the zip the install script
            // names and check it against the checksum it pins.
            const settings = configure(new ChocolateyVerifySettings());
            const script =
              settings.package_?.files["tools/chocolateyinstall.ps1"] ?? "";
            const url = /url64bit\s+= '([^']+)'/.exec(script)?.[1] ?? "";
            const sha256 = /checksum64\s+= '([0-9a-f]{64})'/.exec(script)
              ?.[1];
            const bytes = new Uint8Array(
              await (await github(url)).arrayBuffer(),
            );
            assertEquals(await sha256Hex(bytes), sha256, url);
            const [exe] = await unzip(bytes);
            assertEquals(exe.name, "zuke.exe");
            assertEquals(settings.binary_, "zuke");
            installed.push(new TextDecoder().decode(exe.data));
          },
        });
      });
      verify = target().dependsOn(this.package).executes(async () => {
        await verifyCliFormula(VERSION, `${dir}/zuke.rb`, {
          homebrew: {
            verify: async (configure) => {
              // Stand in for `brew install`: fetch each archive the formula
              // names and check it against the sha256 the formula pins.
              const settings = configure(new HomebrewVerifySettings());
              const formula = await Deno.readTextFile(
                settings.formulaFile_ ?? "",
              );
              const pinned = [
                ...formula.matchAll(/url "([^"]+)"\s+sha256 "([0-9a-f]{64})"/g),
              ];
              assertEquals(pinned.length, CLI_TARGETS.length);
              for (const [, url, sha256] of pinned) {
                const bytes = new Uint8Array(
                  await (await github(url)).arrayBuffer(),
                );
                assertEquals(await sha256Hex(bytes), sha256, url);
                const [binary] = untar(await gunzip(bytes));
                installed.push(new TextDecoder().decode(binary.data));
              }
            },
          },
          signatures: () => Promise.resolve(),
          fetch: github,
          os: "linux",
        });
      });
      // The two jobs that read the upload, as release.yml runs them.
      release = target().dependsOn(this.verify, this.chocolatey).executes(
        () => {},
      );
    }

    const result = await runCli(ReleaseRun, ["release"]);
    assertEquals(result.code, 0, result.err);
    // The plan ran before anything was published, so everything was owed.
    assertEquals(
      await Deno.readTextFile(outputs),
      "build=true\ntap=true\nchocolatey=true\n",
    );
    assertEquals(
      installed.sort(),
      [
        ...CLI_TARGETS.map((t) => `zuke for ${t.triple}`),
        `zuke for ${WINDOWS_TRIPLE}`,
      ].sort(),
    );
    const manifest = parseChecksums(
      await Deno.readTextFile(`${release}/${CHECKSUMS}`),
    );
    assertEquals(manifest.size, CLI_TARGETS.length + 1);
    assertStringIncludes(
      await Deno.readTextFile(`${dir}/zuke.rb`),
      "class Zuke < Formula",
    );

    // Once published, a second run's plan owes no build — only the tap and
    // the Chocolatey package, which these fakes never received.
    const again = await runCli(ReleaseRun, ["plan"]);
    assertEquals(again.code, 0, again.err);
    assertStringIncludes(
      await Deno.readTextFile(outputs),
      "build=false\ntap=true\nchocolatey=true\n",
    );
  });
});

Deno.test("a signing run checks the signed binary it names relative to the checkout", async () => {
  // As cliSign does: the binaries directory is relative to the build's
  // working directory, while the version check runs from a temporary one.
  if (Deno.build.os === "windows") return;
  await withTempCwd(async () => {
    const triple = "aarch64-apple-darwin";
    await Deno.mkdir(`dist/cli/bin/${triple}`, { recursive: true });
    await Deno.symlink(Deno.execPath(), binaryPath("dist/cli/bin", triple));
    const { stdout } = await new Deno.Command(Deno.execPath(), {
      args: ["--version"],
    }).output();
    const version = new TextDecoder().decode(stdout).split("\n")[0];

    class SignRun extends Build {
      smoke = target().executes(async () => {
        await assertReportsVersion(
          absolutePath(Deno.cwd(), binaryPath("dist/cli/bin", triple)),
          version,
        );
      });
    }

    const result = await runCli(SignRun, ["smoke"]);
    assertEquals(result.code, 0, result.err);
  });
});
