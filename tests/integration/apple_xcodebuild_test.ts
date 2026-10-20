// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `XcodebuildTasks`: a real build, driven through the
 * CLI `main()` entry point, that archives an iOS app, writes its export
 * options and exports the `.ipa`, in dependency order — and fails the run when
 * `xcodebuild` does.
 *
 * The export step proves the pieces meet: the fake `xcodebuild` reads the
 * `ExportOptions.plist` the build wrote and reports its export method.
 *
 * Hermetic per AGENTS.md guideline 5: `xcodebuild` is a POSIX shell shim that
 * runs a small script with the running `deno`. Like `xcodebuild` itself, the
 * shim does not run on Windows.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { XcodebuildTasks } from "../../packages/apple/mod.ts";
import { runCli } from "./_harness.ts";

/**
 * The fake `xcodebuild`: prints its argv, plus the export method of the plist
 * an `-exportArchive` names, and exits 65 (xcodebuild's build failure) when
 * its action equals `FAKE_FAIL_ON`.
 */
const FAKE = `
const args = Deno.args;
let method = "";
const plist = args.indexOf("-exportOptionsPlist");
if (plist >= 0) {
  const text = await Deno.readTextFile(args[plist + 1]);
  method = /<key>method<\\/key>\\s*<string>([^<]*)<\\/string>/.exec(text)?.[1] ?? "?";
}
console.log(JSON.stringify({ args, method }));
if (args.includes(Deno.env.get("FAKE_FAIL_ON") ?? "")) Deno.exit(65);
`;

/** Run `fn` in a temp dir holding a fake `xcodebuild`, removed afterwards. */
async function withFakeXcodebuild(
  fn: (dir: string, xcodebuild: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-xcodebuild-" });
  try {
    await Deno.writeTextFile(`${dir}/fake.ts`, FAKE);
    const shim = `${dir}/xcodebuild`;
    await Deno.writeTextFile(
      shim,
      `#!/bin/sh\nexec "${Deno.execPath()}" run --no-config --no-lock -A ` +
        `"${dir}/fake.ts" "$@"\n`,
    );
    await Deno.chmod(shim, 0o755);
    await fn(dir, shim);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Archive, write the export options, export; recording what the fake printed. */
function iosRelease(
  dir: string,
  xcodebuild: string,
  printed: Array<{ args: string[]; method: string }>,
  failOn = "-",
) {
  const env = { FAKE_FAIL_ON: failOn };
  const record = (stdout: string) => printed.push(JSON.parse(stdout));
  return class Release extends Build {
    archive = target().executes(async () => {
      const out = await XcodebuildTasks.archive((s) =>
        s.toolPath(xcodebuild).env(env).cwd(dir).quiet()
          .workspace("App.xcworkspace").scheme("App").configuration("Release")
          .destination("generic/platform=iOS")
          .archivePath(`${dir}/App.xcarchive`)
          .buildSetting("DEVELOPMENT_TEAM", "ABCDE12345")
      );
      record(out.stdout);
    });
    ipa = target().dependsOn(this.archive).executes(async () => {
      await XcodebuildTasks.writeExportOptions(
        `${dir}/ExportOptions.plist`,
        (o) => o.method("app-store-connect").teamId("ABCDE12345"),
      );
      const out = await XcodebuildTasks.exportArchive((s) =>
        s.toolPath(xcodebuild).env(env).cwd(dir).quiet()
          .archivePath(`${dir}/App.xcarchive`).exportPath(`${dir}/ipa`)
          .exportOptionsPlist(`${dir}/ExportOptions.plist`)
      );
      record(out.stdout);
    });
  };
}

Deno.test({
  name: "xcodebuild: a build archives, writes export options, then exports",
  ignore: Deno.build.os === "windows",
  fn: () =>
    withFakeXcodebuild(async (dir, xcodebuild) => {
      const printed: Array<{ args: string[]; method: string }> = [];
      const { code, err } = await runCli(
        iosRelease(dir, xcodebuild, printed),
        ["ipa"],
      );
      assertEquals(code, 0, err);
      assertEquals(printed, [
        {
          args: [
            "-workspace",
            "App.xcworkspace",
            "-scheme",
            "App",
            "-configuration",
            "Release",
            "-destination",
            "generic/platform=iOS",
            "archive",
            "-archivePath",
            `${dir}/App.xcarchive`,
            "DEVELOPMENT_TEAM=ABCDE12345",
          ],
          method: "",
        },
        {
          args: [
            "-exportArchive",
            "-archivePath",
            `${dir}/App.xcarchive`,
            "-exportPath",
            `${dir}/ipa`,
            "-exportOptionsPlist",
            `${dir}/ExportOptions.plist`,
          ],
          method: "app-store-connect",
        },
      ]);
    }),
});

Deno.test({
  name: "xcodebuild: a failed archive fails the run before exporting",
  ignore: Deno.build.os === "windows",
  fn: () =>
    withFakeXcodebuild(async (dir, xcodebuild) => {
      const printed: Array<{ args: string[]; method: string }> = [];
      const { code } = await runCli(
        iosRelease(dir, xcodebuild, printed, "archive"),
        ["ipa"],
      );
      assertEquals(code, 1);
      assertEquals(printed, []);
    }),
});
