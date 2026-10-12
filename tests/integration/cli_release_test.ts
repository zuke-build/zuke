// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The CLI's standalone release, end to end through a real build: a run that
 * plans, packages, and verifies the formula the way release.yml's jobs do,
 * driven through the CLI `main()` — with GitHub and `brew` replaced by fakes
 * that serve and check what the earlier targets wrote.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";
import { Build, gunzip, sha256Hex, target, untar } from "@zuke/core";
import { HomebrewVerifySettings } from "@zuke/homebrew";
import { runCli } from "./_harness.ts";
import {
  archiveName,
  CHECKSUMS,
  CLI_TARGETS,
  parseChecksums,
  planCliRelease,
  releaseAssetUrl,
} from "../../build/cli_release.ts";
import { binaryPath, packageCliArchives } from "../../build/cli_package.ts";
import { verifyCliFormula } from "../../build/cli_publish.ts";
import { writeStepOutputs } from "../../build/step_outputs.ts";

const VERSION = "1.14.0";

Deno.test("a release run plans, packages, and verifies the formula that pins what it packed", async () => {
  await withTemp(async (dir) => {
    const bin = `${dir}/bin`;
    const release = `${dir}/release`;
    const outputs = `${dir}/github_output`;
    for (const t of CLI_TARGETS) {
      await Deno.mkdir(`${bin}/${t.triple}`, { recursive: true });
      await Deno.writeTextFile(
        binaryPath(bin, t.triple),
        `zuke for ${t.triple}`,
      );
    }
    // GitHub, as the release looks once `package`'s output is uploaded: the
    // release exists and serves the manifest and archives this run wrote.
    const published = new Set<string>();
    const github: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      for (const name of published) {
        if (url === releaseAssetUrl(VERSION, name)) {
          return new Response(await Deno.readFile(`${release}/${name}`));
        }
      }
      return new Response("", {
        status: url.endsWith("/releases/tag/cli-v1.14.0") ? 200 : 404,
      });
    };
    const installed: string[] = [];

    class ReleaseRun extends Build {
      plan = target().executes(async () => {
        const plan = await planCliRelease(VERSION, {
          releaseExists: async () =>
            (await github(
              "https://github.com/zuke-build/zuke/releases/tag/cli-v1.14.0",
            )).ok,
          checksumsPublished: () => Promise.resolve(published.has(CHECKSUMS)),
          tapFormula: () => Promise.resolve(undefined),
        });
        await writeStepOutputs(
          { build: String(plan.build), tap: String(plan.tap) },
          outputs,
        );
      });
      package = target().dependsOn(this.plan).executes(async () => {
        await packageCliArchives(VERSION, bin, release);
        for (const t of CLI_TARGETS) published.add(archiveName(VERSION, t));
        published.add(CHECKSUMS);
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
    }

    const result = await runCli(ReleaseRun, ["verify"]);
    assertEquals(result.code, 0, result.err);
    // The plan ran before anything was published, so everything was owed.
    assertEquals(await Deno.readTextFile(outputs), "build=true\ntap=true\n");
    assertEquals(
      installed,
      CLI_TARGETS.map((t) => `zuke for ${t.triple}`),
    );
    const manifest = parseChecksums(
      await Deno.readTextFile(`${release}/${CHECKSUMS}`),
    );
    assertEquals(manifest.size, CLI_TARGETS.length);
    assertStringIncludes(
      await Deno.readTextFile(`${dir}/zuke.rb`),
      "class Zuke < Formula",
    );

    // Once published, a second run's plan owes no build — only the tap,
    // whose formula this fake never received.
    const again = await runCli(ReleaseRun, ["plan"]);
    assertEquals(again.code, 0, again.err);
    assertStringIncludes(
      await Deno.readTextFile(outputs),
      "build=false\ntap=true\n",
    );
  });
});
