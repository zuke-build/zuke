// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { defaultPrompter, main, type UpgradeHost } from "../mod.ts";
import {
  acceptsMinimumDependencyAge,
  defaultUpgradeHost,
  installArgs,
  parseUpgradeFlags,
} from "../src/upgrade.ts";
import { VERSION } from "../src/version.ts";
import { FakeHost, FakeStarActions, noProjectProbe } from "./_fakes.ts";
import { withTemp } from "../../core/tests/_temp.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { absolutePath } from "@zuke/core";

/** The main module Deno reports for an installed CLI. */
const FROM_JSR = "jsr:@zuke/cli";

/** The fake install root's `bin` directory. */
const BIN = "/home/me/.deno/bin";

/** A release that is never the running one. */
const NEWER = "999.0.0";

/** A Deno that applies a minimum dependency age, as 2.9 does. */
const DENO = "2.9.3";

/** A recording {@link UpgradeHost} with a canned registry document. */
class FakeUpgradeHost implements UpgradeHost {
  /** Every argv passed to {@link install}. */
  readonly installs: string[][] = [];

  constructor(
    readonly metaDoc: unknown = {
      latest: NEWER,
      versions: {
        [NEWER]: {},
        [VERSION]: {},
        "1.0.0": {},
        "1.1.0": { yanked: true },
      },
    },
    readonly running: string = FROM_JSR,
    readonly exit: number = 0,
  ) {}

  /** What {@link binDir} answers. */
  bin: string | undefined = BIN;
  /** Whether a global install exists under {@link bin}. */
  present = true;
  /** What {@link windows} answers. */
  onWindows = false;
  /** Every path passed to {@link exists}. */
  readonly probed: string[] = [];

  mainModule(): string {
    return this.running;
  }

  binDir(): string | undefined {
    return this.bin;
  }

  exists(path: string): Promise<boolean> {
    this.probed.push(path);
    return Promise.resolve(this.present);
  }

  windows(): boolean {
    return this.onWindows;
  }

  meta(): Promise<unknown> {
    return this.metaDoc instanceof Error
      ? Promise.reject(this.metaDoc)
      : Promise.resolve(this.metaDoc);
  }

  install(denoArgs: string[]): Promise<number> {
    this.installs.push(denoArgs);
    return Promise.resolve(this.exit);
  }

  /** What {@link denoVersion} answers. */
  deno = DENO;

  denoVersion(): string {
    return this.deno;
  }

  /**
   * The version the install's lock resolves, when it is not the one asked
   * for; by default the lock resolves exactly what the last install named.
   */
  resolves: string | undefined;
  /** Whether the lock cannot be read at all. */
  lockMissing = false;
  /** Whether the lock names the target only under another specifier. */
  otherEntry = false;
  /** Every path passed to {@link readText}. */
  readonly read: string[] = [];

  readText(path: string): Promise<string> {
    this.read.push(path);
    if (this.lockMissing) return Promise.reject(new Error("no lock"));
    const spec = this.installs.at(-1)?.at(-1) ?? "";
    const pinned = /@zuke\/cli@(.+)$/.exec(spec);
    const latest = this.metaDoc instanceof Error
      ? ""
      : String(Reflect.get(Object(this.metaDoc), "latest"));
    const version = this.resolves ?? (pinned === null ? latest : pinned[1]);
    return Promise.resolve(JSON.stringify({
      version: "5",
      specifiers: {
        [
          this.otherEntry
            ? "jsr:@zuke/cli@^0"
            : pinned === null
            ? "jsr:@zuke/cli@*"
            : spec
        ]: version,
      },
    }));
  }
}

/** Run `zuke upgrade <args>` against `fake`, outside any project. */
async function upgrade(
  args: string[],
  fake: FakeUpgradeHost,
): Promise<{ code: number; logs: string[] }> {
  const host = new FakeHost();
  const code = await main(
    ["upgrade", ...args],
    host,
    defaultPrompter,
    () => Promise.resolve(0),
    new FakeStarActions(false),
    () => Promise.reject(new Error("the build must not run")),
    noProjectProbe,
    fake,
  );
  return { code, logs: host.logs };
}

Deno.test("parseUpgradeFlags reads the version and both flags", () => {
  assertEquals(parseUpgradeFlags([]), { dryRun: false, force: false });
  assertEquals(parseUpgradeFlags(["1.2.3", "--dry-run", "-f"]), {
    version: "1.2.3",
    dryRun: true,
    force: true,
  });
  assertEquals(parseUpgradeFlags(["--force"]).force, true);
  assertEquals(parseUpgradeFlags(["2.0.0-rc.1+b5"]).version, "2.0.0-rc.1+b5");
});

// cspell:ignore dryrun
Deno.test("parseUpgradeFlags refuses what it cannot read rather than reinstalling anyway", () => {
  assertThrows(() => parseUpgradeFlags(["--dryrun"]), Error, "unknown option");
  assertThrows(() => parseUpgradeFlags(["1.0.0", "1.1.0"]), Error, "one");
  assertThrows(() => parseUpgradeFlags(["latest"]), Error, "not a version");
  assertThrows(() => parseUpgradeFlags(["v1.0.0"]), Error, "not a version");
});

Deno.test("installArgs keeps the documented unversioned spec for latest, pins otherwise", () => {
  assertEquals(installArgs("2.0.0", true, "2.8.3"), [
    "install",
    "--global",
    "--force",
    "--allow-all",
    "--minimum-dependency-age=0",
    "--name",
    "zuke",
    "--reload=jsr:@zuke/cli",
    "jsr:@zuke/cli",
  ]);
  assertEquals(installArgs("1.0.0", false, "2.9.3"), [
    "install",
    "--global",
    "--force",
    "--allow-all",
    "--minimum-dependency-age=0",
    "--name",
    "zuke",
    "jsr:@zuke/cli@1.0.0",
  ]);
});

Deno.test("installArgs leaves the dependency-age flag off a Deno that would reject it", () => {
  // Deno 2.5 and older fail the whole install on an unknown flag.
  for (const old of ["2.5.6", "2.4.5", "1.46.3", "nightly"]) {
    const args = installArgs("2.0.0", true, old);
    assertEquals(args.includes("--minimum-dependency-age=0"), false, old);
  }
  for (const current of ["2.6.0", "2.10.1", "3.0.0"]) {
    const args = installArgs("2.0.0", true, current);
    assertEquals(args.includes("--minimum-dependency-age=0"), true, current);
  }
});

Deno.test("acceptsMinimumDependencyAge reads the major and minor", () => {
  assertEquals(acceptsMinimumDependencyAge("2.6.0"), true);
  assertEquals(acceptsMinimumDependencyAge("2.5.9"), false);
  assertEquals(acceptsMinimumDependencyAge("garbage"), false);
});

Deno.test("zuke upgrade fails when the install resolved another release than it asked for", async () => {
  // Deno 2.9's dependency-age window made an unversioned install of 1.12.0
  // land on 1.8.0, and the command still said "Done — 1.12.0 is installed".
  const fake = new FakeUpgradeHost();
  fake.resolves = "1.8.0";
  const { code, logs } = await upgrade([], fake);
  assertEquals(code, 1);
  const text = logs.join("\n");
  assertStringIncludes(text, `resolves @zuke/cli to 1.8.0, not ${NEWER}`);
  assertEquals(text.includes("Done"), false);
  assertEquals(fake.read, [`${BIN}/.zuke/deno.lock`]);

  // Another @zuke/cli entry cannot stand in for the one the install wrote.
  const other = new FakeUpgradeHost();
  other.otherEntry = true;
  const stale = await upgrade([], other);
  assertEquals(stale.code, 1);
  assertStringIncludes(stale.logs.join("\n"), "@zuke/cli to nothing");

  const unreadable = new FakeUpgradeHost();
  unreadable.lockMissing = true;
  const missing = await upgrade([], unreadable);
  assertEquals(missing.code, 1);
  assertStringIncludes(missing.logs.join("\n"), "@zuke/cli to nothing");
});

Deno.test("zuke upgrade installs the latest release with an unversioned spec", async () => {
  const fake = new FakeUpgradeHost();
  const { code, logs } = await upgrade([], fake);
  assertEquals(code, 0);
  assertEquals(fake.installs, [installArgs(NEWER, true, DENO)]);
  assertStringIncludes(logs.join("\n"), `${VERSION} with ${NEWER}`);
  assertEquals(fake.probed, [`${BIN}/.zuke/deno.json`]);
  assertStringIncludes(logs.join("\n"), `zuke ${NEWER} is installed`);
});

Deno.test("zuke upgrade <version> pins an older release, and its own latest stays unversioned", async () => {
  const older = new FakeUpgradeHost();
  assertEquals((await upgrade(["1.0.0"], older)).code, 0);
  assertEquals(older.installs, [installArgs("1.0.0", false, DENO)]);

  const latest = new FakeUpgradeHost();
  assertEquals((await upgrade([NEWER], latest)).code, 0);
  assertEquals(latest.installs, [installArgs(NEWER, true, DENO)]);
});

Deno.test("zuke upgrade on the latest release says so and installs nothing, unless forced", async () => {
  const current = { latest: VERSION, versions: { [VERSION]: {} } };
  const idle = new FakeUpgradeHost(current);
  const quiet = await upgrade([], idle);
  assertEquals(quiet.code, 0);
  assertEquals(idle.installs, []);
  assertStringIncludes(quiet.logs.join("\n"), "already the latest release");

  const pinned = new FakeUpgradeHost();
  const same = await upgrade([VERSION], pinned);
  assertEquals(pinned.installs, []);
  assertStringIncludes(same.logs.join("\n"), "already installed");

  const forced = new FakeUpgradeHost(current);
  assertEquals((await upgrade(["--force"], forced)).code, 0);
  assertEquals(forced.installs, [installArgs(VERSION, true, DENO)]);
});

Deno.test("zuke upgrade --dry-run names the command and installs nothing", async () => {
  const fake = new FakeUpgradeHost();
  const { code, logs } = await upgrade(["--dry-run"], fake);
  assertEquals(code, 0);
  assertEquals(fake.installs, []);
  assertStringIncludes(
    logs.join("\n"),
    `Would replace zuke ${VERSION} with ${NEWER}: deno install --global`,
  );
});

Deno.test("zuke upgrade refuses an unpublished or yanked version", async () => {
  const missing = new FakeUpgradeHost();
  const gone = await upgrade(["0.0.1"], missing);
  assertEquals(gone.code, 1);
  assertStringIncludes(gone.logs.join("\n"), "0.0.1 is not published");

  const yanked = new FakeUpgradeHost();
  const pulled = await upgrade(["1.1.0"], yanked);
  assertEquals(pulled.code, 1);
  assertStringIncludes(pulled.logs.join("\n"), "1.1.0 has been yanked");
  assertEquals([...missing.installs, ...yanked.installs], []);
});

Deno.test("zuke upgrade fails cleanly when JSR cannot answer", async () => {
  const offline = new FakeUpgradeHost(new Error("connection refused"));
  const down = await upgrade([], offline);
  assertEquals(down.code, 1);
  assertStringIncludes(down.logs.join("\n"), "connection refused");

  // A thrown non-Error is reported too, not lost.
  const odd = new FakeUpgradeHost();
  odd.meta = () => Promise.reject("teapot");
  assertStringIncludes((await upgrade([], odd)).logs.join("\n"), "teapot");

  for (const doc of [null, {}, { latest: 3 }]) {
    const garbled = new FakeUpgradeHost(doc);
    const result = await upgrade([], garbled);
    assertEquals(result.code, 1);
    assertStringIncludes(result.logs.join("\n"), "no latest version");
    assertEquals(garbled.installs, []);
  }
});

Deno.test("zuke upgrade accepts a pinned JSR main module", async () => {
  const fake = new FakeUpgradeHost(undefined, "jsr:@zuke/cli@1.0.0");
  assertEquals((await upgrade([], fake)).code, 0);
  assertEquals(fake.installs.length, 1);
});

Deno.test("zuke upgrade refuses a CLI that does not run from JSR", async () => {
  for (
    const running of [
      "file:///src/zuke/packages/cli/mod.ts",
      "jsr:@zuke/cli-evil",
      "jsr:@zuke/core@1.0.0",
      "https://jsr.io/@zuke/cli/1.0.0/mod.ts",
    ]
  ) {
    const fake = new FakeUpgradeHost(undefined, running);
    const { code, logs } = await upgrade([], fake);
    assertEquals(code, 1);
    assertStringIncludes(logs.join("\n"), "not jsr:@zuke/cli");
    assertEquals(fake.installs, []);
  }
});

Deno.test("zuke upgrade refuses when there is no global install to replace", async () => {
  const absent = new FakeUpgradeHost();
  absent.present = false;
  const none = await upgrade([], absent);
  assertEquals(none.code, 1);
  assertStringIncludes(none.logs.join("\n"), `no ${BIN}/.zuke/deno.json`);
  assertEquals(absent.installs, []);

  const rootless = new FakeUpgradeHost();
  rootless.bin = undefined;
  const lost = await upgrade([], rootless);
  assertEquals(lost.code, 1);
  assertStringIncludes(lost.logs.join("\n"), "DENO_INSTALL_ROOT");
  assertEquals(rootless.probed, []);
});

Deno.test("zuke upgrade on Windows refuses to pin a version, but moves to latest", async () => {
  const pinned = new FakeUpgradeHost();
  pinned.onWindows = true;
  const refused = await upgrade(["1.0.0"], pinned);
  assertEquals(refused.code, 1);
  assertStringIncludes(
    refused.logs.join("\n"),
    "from another shell instead: deno install --global --force --allow-all " +
      "--minimum-dependency-age=0 --name zuke jsr:@zuke/cli@1.0.0",
  );
  assertEquals(pinned.installs, []);

  const latest = new FakeUpgradeHost();
  latest.onWindows = true;
  assertEquals((await upgrade([], latest)).code, 0);
  assertEquals(latest.installs, [installArgs(NEWER, true, DENO)]);
});

Deno.test("zuke upgrade treats a non-object version entry as unpublished", async () => {
  const fake = new FakeUpgradeHost({
    latest: NEWER,
    versions: { "1.0.0": null, "1.2.0": "yes" },
  });
  for (const version of ["1.0.0", "1.2.0"]) {
    const { code, logs } = await upgrade([version], fake);
    assertEquals(code, 1);
    assertStringIncludes(logs.join("\n"), "is not published");
  }
  assertEquals(fake.installs, []);
});

Deno.test("zuke upgrade propagates a failed deno install", async () => {
  const fake = new FakeUpgradeHost(undefined, FROM_JSR, 7);
  const { code, logs } = await upgrade([], fake);
  assertEquals(code, 7);
  assertStringIncludes(logs.join("\n"), "deno install exited 7");
});

Deno.test("zuke upgrade reports a bad flag before reaching JSR", async () => {
  const fake = new FakeUpgradeHost();
  fake.meta = () => Promise.reject(new Error("must not be fetched"));
  const { code, logs } = await upgrade(["--dryrun"], fake);
  assertEquals(code, 1);
  assertStringIncludes(logs.join("\n"), "unknown option --dryrun");
});

Deno.test("zuke --help lists upgrade and its options", async () => {
  const host = new FakeHost();
  await main(
    ["--help"],
    host,
    defaultPrompter,
    () => Promise.resolve(0),
    new FakeStarActions(false),
    () => Promise.resolve(0),
    noProjectProbe,
  );
  const help = host.logs.join("\n");
  assertStringIncludes(help, "upgrade [<version>]");
  assertStringIncludes(help, "--dry-run");
});

Deno.test("the default upgrade host reports its main module and runs deno in isolation", async () => {
  assertEquals(defaultUpgradeHost.mainModule(), Deno.mainModule);
  assertEquals(
    defaultUpgradeHost.windows(),
    Deno.build.os === "windows",
  );
  // `deno --version` stands in for the install: the same isolated runner,
  // with no network and nothing installed.
  assertEquals(await defaultUpgradeHost.install(["--version"]), 0);
});

Deno.test("the default upgrade host finds the install root the way deno install does", async () => {
  await withTemp(async (dir) => {
    const root = absolutePath(dir);
    await withEnv({ DENO_INSTALL_ROOT: root.path }, () => {
      assertEquals(defaultUpgradeHost.binDir(), root("bin").path);
      return Promise.resolve();
    });
    await withEnv(
      { DENO_INSTALL_ROOT: undefined, HOME: root.path, USERPROFILE: undefined },
      () => {
        assertEquals(defaultUpgradeHost.binDir(), root(".deno", "bin").path);
        return Promise.resolve();
      },
    );
    await withEnv(
      {
        DENO_INSTALL_ROOT: "relative",
        HOME: undefined,
        USERPROFILE: undefined,
      },
      () => {
        assertEquals(defaultUpgradeHost.binDir(), undefined);
        return Promise.resolve();
      },
    );
    await withEnv(
      { DENO_INSTALL_ROOT: undefined, HOME: undefined, USERPROFILE: undefined },
      () => {
        assertEquals(defaultUpgradeHost.binDir(), undefined);
        return Promise.resolve();
      },
    );
    assertEquals(await defaultUpgradeHost.exists(dir), true);
    assertEquals(await defaultUpgradeHost.exists(`${dir}/missing`), false);
  });
});
