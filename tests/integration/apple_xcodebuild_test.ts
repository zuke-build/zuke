// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for building and shipping an iOS app: real builds,
 * driven through the CLI `main()` entry point, that archive an app, write its
 * export options and export the `.ipa`, in dependency order — and fail the
 * run when `xcodebuild` does; and a whole TestFlight release that installs a
 * provisioning profile for the signing steps only, uploads, and distributes
 * the build through an App Store Connect API served on loopback.
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
import {
  ProvisioningProfileTasks,
  TestFlightTasks,
  XcodebuildTasks,
} from "../../packages/apple/mod.ts";
import { apiKey } from "../../packages/apple/tests/_asc.ts";
import { base64, profileBytes } from "../../packages/apple/tests/_profile.ts";
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

/** A local App Store Connect: one app whose build is processed. */
function serveAppStoreConnect(calls: string[]): Deno.HttpServer<Deno.NetAddr> {
  return Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    async (request) => {
      const url = new URL(request.url);
      const auth = request.headers.get("Authorization") ?? "";
      calls.push(
        `${request.method} ${url.pathname}${
          auth.startsWith("Bearer ey") ? "" : " (no token)"
        }`,
      );
      if (request.method !== "GET") {
        await request.body?.cancel();
        return new Response(null, { status: 201 });
      }
      const data = url.pathname === "/v1/apps"
        ? [{ id: "app-1", attributes: { bundleId: "com.example.app" } }]
        : url.pathname === "/v1/builds"
        ? [{ id: "build-1", attributes: { processingState: "VALID" } }]
        : [{ id: "g-qa", attributes: { name: "QA" } }];
      return Response.json({ data });
    },
  );
}

Deno.test({
  name: "TestFlight: profile, archive, upload and distribute in one build",
  ignore: Deno.build.os === "windows",
  fn: () =>
    withFakeXcodebuild(async (dir, xcodebuild) => {
      const home = `${dir}/home`;
      const profiles = [
        `${home}/Library/Developer/Xcode/UserData/Provisioning Profiles`,
        `${home}/Library/MobileDevice/Provisioning Profiles`,
      ];
      const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
      const pem = (await apiKey()).pem;
      const calls: string[] = [];
      const server = serveAppStoreConnect(calls);
      const previousHome = Deno.env.get("HOME");
      Deno.env.set("HOME", home);
      let installedDuringArchive: boolean[] = [];
      try {
        class Release extends Build {
          upload = target().executes(async () => {
            await ProvisioningProfileTasks.temporary(
              (s) => s.base64(base64(profileBytes())),
              async ({ profile }) => {
                installedDuringArchive = await Promise.all(
                  profiles.map((p) => exists(`${p}/${uuid}.mobileprovision`)),
                );
                await XcodebuildTasks.archive((s) =>
                  s.toolPath(xcodebuild).cwd(dir).quiet().scheme("App")
                    .archivePath(`${dir}/App.xcarchive`)
                );
                await XcodebuildTasks.writeExportOptions(
                  `${dir}/ExportOptions.plist`,
                  (o) =>
                    o.method("app-store-connect").signingStyle("manual")
                      .provisioningProfile(profile.bundleId, profile.uuid)
                      .destination("upload"),
                );
                await XcodebuildTasks.exportArchive((s) =>
                  s.toolPath(xcodebuild).cwd(dir).quiet()
                    .archivePath(`${dir}/App.xcarchive`).exportPath(
                      `${dir}/ipa`,
                    )
                    .exportOptionsPlist(`${dir}/ExportOptions.plist`)
                );
              },
            );
          });
          testflight = target().dependsOn(this.upload).executes(async () => {
            await TestFlightTasks.distribute((s) =>
              s.apiUrl(`http://127.0.0.1:${server.addr.port}`)
                .issuerId("issuer").keyId("KEY").privateKey(pem)
                .bundleId("com.example.app").buildNumber(42)
                .usesNonExemptEncryption(false).group("QA")
            );
          });
        }
        const { code, err } = await runCli(Release, ["testflight"]);
        assertEquals(code, 0, err);
      } finally {
        if (previousHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", previousHome);
        await server.shutdown();
      }
      // Installed in both of Xcode's directories while signing, gone after.
      assertEquals(installedDuringArchive, [true, true]);
      assertEquals(
        await Promise.all(
          profiles.map((p) => exists(`${p}/${uuid}.mobileprovision`)),
        ),
        [false, false],
      );
      const plist = await Deno.readTextFile(`${dir}/ExportOptions.plist`);
      assertEquals(
        plist.includes(
          `<key>com.example.app</key>\n\t\t<string>${uuid}</string>`,
        ),
        true,
      );
      assertEquals(calls, [
        "GET /v1/apps",
        "GET /v1/builds",
        "PATCH /v1/builds/build-1",
        "GET /v1/betaGroups",
        "POST /v1/builds/build-1/relationships/betaGroups",
      ]);
    }),
});

/** Whether `path` exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
