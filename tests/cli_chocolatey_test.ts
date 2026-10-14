// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the CLI's Chocolatey package: what it pins, what it says about
 * signing, and what the verify and push stages hand to `@zuke/chocolatey`.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../packages/core/tests/_assert.ts";
import {
  ChocolateyPublishSettings,
  ChocolateyVerifySettings,
} from "@zuke/chocolatey";
import {
  CHECKSUMS,
  checksumsText,
  releaseAssetUrl,
  windowsArchiveName,
} from "../build/cli_release.ts";
import {
  CHOCOLATEY_OWNER,
  cliChocolateyPackage,
  ICON_URL,
  publishCliChocolatey,
  verifyCliChocolatey,
} from "../build/cli_chocolatey.ts";

const VERSION = "1.15.0";
const SHA = "c".repeat(64);
const ZIP = windowsArchiveName(VERSION);

/** A fetch serving only the release's manifest, listing the Windows zip. */
const github: typeof fetch = (input) =>
  Promise.resolve(
    String(input) === releaseAssetUrl(VERSION, CHECKSUMS)
      ? new Response(checksumsText([{ name: ZIP, sha256: SHA }]))
      : new Response("not found", { status: 404 }),
  );

Deno.test("cliChocolateyPackage pins the release's Windows zip, and says it is unsigned", () => {
  const pkg = cliChocolateyPackage(VERSION, new Map([[ZIP, SHA]]));
  assertEquals([pkg.id, pkg.version], ["zuke", VERSION]);
  const script = pkg.files["tools/chocolateyinstall.ps1"];
  assertStringIncludes(script, `'${releaseAssetUrl(VERSION, ZIP)}'`);
  assertStringIncludes(script, `'${SHA}'`);
  const nuspec = pkg.files["zuke.nuspec"];
  assertStringIncludes(nuspec, "not Authenticode-signed yet");
  assertStringIncludes(nuspec, "releases/tag/cli-v1.15.0");
  assertStringIncludes(nuspec, `<iconUrl>${ICON_URL}</iconUrl>`);
  assertStringIncludes(nuspec, `<owners>${CHOCOLATEY_OWNER}</owners>`);
});

Deno.test("cliChocolateyPackage refuses checksums without the Windows zip", () => {
  assertThrows(
    () => cliChocolateyPackage(VERSION, new Map()),
    Error,
    `lists no ${ZIP}`,
  );
});

Deno.test("verifyCliChocolatey runs zuke --version from the package the release pins", async () => {
  let seen: ChocolateyVerifySettings | undefined;
  await verifyCliChocolatey(VERSION, github, {
    verify: (configure) => {
      seen = configure(new ChocolateyVerifySettings());
      return Promise.resolve();
    },
  });
  assertEquals(
    seen?.package_?.files["tools/chocolateyinstall.ps1"]
      .includes(SHA),
    true,
  );
  assertEquals([seen?.binary_, seen?.args_], ["zuke", ["--version"]]);
  assertEquals(seen?.expectation_, { kind: "version" });
});

Deno.test("publishCliChocolatey pushes the pinned package with the API key", async () => {
  let seen: ChocolateyPublishSettings | undefined;
  await publishCliChocolatey(VERSION, "choco-key", github, {
    publish: (configure) => {
      seen = configure(new ChocolateyPublishSettings());
      return Promise.resolve({
        source: seen.source_,
        nupkg: "zuke.1.15.0.nupkg",
      });
    },
  });
  assertEquals(seen?.apiKey_, "choco-key");
  assertEquals(seen?.package_?.version, VERSION);
  assertEquals(seen?.source_, "https://push.chocolatey.org/");
});
