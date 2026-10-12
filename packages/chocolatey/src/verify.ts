// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link ChocolateyVerifySettings} and `ChocolateyTasks.verify`: install a
 * rendered package the way a user would, run the binary it puts on `PATH`,
 * and remove it again.
 *
 * ```ts
 * verifyPackage = target().executes(() =>
 *   ChocolateyTasks.verify((s) =>
 *     s.package(pkg).binary("app").command("--version").expectVersion()
 *   )
 * );
 * ```
 *
 * The package is staged in a fresh temporary directory, which is also the
 * only source the install reads from:
 *
 * 1. write `<id>.nuspec` and `tools/chocolateyinstall.ps1` into it
 * 2. `choco pack <id>.nuspec --output-directory=<dir>`
 * 3. `choco install <id> --source=<dir> --version=<version> --yes --force
 *    --no-progress` — `--force` so a copy of the package already on the
 *    machine is replaced by the one being verified rather than reported as
 *    installed
 * 4. run the shim: `<binary> <command…>`, and check what it printed
 * 5. `choco uninstall <id> --version=<version> --yes --no-progress` once
 *    installed, then remove the directory — always, whether or not the steps
 *    before it succeeded
 *
 * A failure is raised first, and a cleanup failure alongside it in an
 * `AggregateError`, never instead of it.
 *
 * @module
 */

import { DynamicToolSettings, runSettings } from "@zuke/core/tooling";
import type { Configure, PathLike } from "@zuke/core/tooling";
import { ChocoTasks } from "./choco.ts";
import type { ChocolateyPackage } from "./package.ts";
import {
  assertPackage,
  chocoAt,
  type ChocoCall,
  packPackage,
  removeStaging,
  runAll,
  stagingDirectory,
  writePackage,
} from "./stage.ts";

/** The most of a binary's output an expectation failure quotes. */
const MAX_QUOTED_OUTPUT = 500;

/** What the binary's output must contain: the package version, or a text. */
export type ChocolateyVerifyExpectation = { kind: "version" } | {
  kind: "output";
  text: string;
};

/** Settings for verifying a rendered package. */
export class ChocolateyVerifySettings {
  /** The package to verify. Set by {@link package}. */
  package_?: ChocolateyPackage;
  /** The shim to run once installed. Set by {@link binary}. */
  binary_?: string;
  /** The arguments to run it with. Set by {@link command}. */
  args_: string[] = [];
  /** What its output must contain. Set by {@link expectVersion}/{@link expectOutput}. */
  expectation_?: ChocolateyVerifyExpectation;
  /** The `choco` binary to run. Set by {@link toolPath}. */
  toolPath_?: string;

  /** The package to verify (required) — what `ChocolateyTasks.package` rendered. */
  package(value: ChocolateyPackage): this {
    this.package_ = value;
    return this;
  }

  /**
   * The command the package puts on `PATH` (required), e.g. `app` — choco
   * names each shim after the `.exe` it found in the zip.
   */
  binary(name: string): this {
    this.binary_ = name;
    return this;
  }

  /** The arguments to run the binary with, e.g. `"--version"`. */
  command(...args: string[]): this {
    this.args_.push(...args);
    return this;
  }

  /** Require the binary's output to contain the package version. */
  expectVersion(): this {
    this.expectation_ = { kind: "version" };
    return this;
  }

  /** Require the binary's output to contain `text`. */
  expectOutput(text: string): this {
    this.expectation_ = { kind: "output", text };
    return this;
  }

  /** The `choco` to run, when it is not on `PATH`. */
  toolPath(path: PathLike): this {
    this.toolPath_ = String(path);
    return this;
  }
}

/**
 * Run the installed binary and hold its output to the expectation. Without
 * one, the binary only has to exit 0.
 */
async function checkBinary(
  binary: string,
  args: readonly string[],
  expected: string | undefined,
): Promise<void> {
  const output = await runSettings(
    new DynamicToolSettings(binary),
    (s) => s.arg(...args),
  );
  if (expected === undefined) return;
  const printed = `${output.stdout}\n${output.stderr}`;
  if (!printed.includes(expected)) {
    const quoted = printed.trim().slice(0, MAX_QUOTED_OUTPUT);
    throw new Error(
      `${[binary, ...args].join(" ")} did not print ` +
        `${JSON.stringify(expected)}; it printed: ${JSON.stringify(quoted)}`,
    );
  }
}

/** Install, check, uninstall: the steps after the staging directory exists. */
async function verifyStaged(
  pkg: ChocolateyPackage,
  settings: ChocolateyVerifySettings,
  binary: string,
  choco: ChocoCall,
  directory: string,
): Promise<void> {
  const expectation = settings.expectation_;
  const expected = expectation === undefined
    ? undefined
    : expectation.kind === "version"
    ? pkg.version
    : expectation.text;
  let installed = false;
  await runAll([
    async () => {
      await writePackage(pkg, directory);
      await packPackage(pkg, directory, choco);
      await ChocoTasks.install((s) =>
        choco(s).packages(pkg.id).source(directory).version(pkg.version)
          .yes().force().noProgress()
      );
      // Only after it succeeded: uninstalling a package that is not there
      // fails and would bury the install's own error. Choco rolls a failed
      // install back itself.
      installed = true;
      await checkBinary(binary, settings.args_, expected);
    },
    async () => {
      if (installed) {
        await ChocoTasks.uninstall((s) =>
          choco(s).packages(pkg.id).version(pkg.version).yes().noProgress()
        );
      }
    },
    () => removeStaging(directory),
  ], "verifying the Chocolatey package failed");
}

/** Perform the configured verification. */
export async function verifyPackage(
  configure: Configure<ChocolateyVerifySettings>,
): Promise<void> {
  const settings = configure(new ChocolateyVerifySettings());
  const pkg = settings.package_;
  if (pkg === undefined) {
    throw new Error("verifying a Chocolatey package requires .package(...).");
  }
  const binary = settings.binary_;
  if (binary === undefined || binary === "") {
    throw new Error(
      "verifying a Chocolatey package requires .binary(...) — the command " +
        "it puts on PATH.",
    );
  }
  // Validated before anything is written: the id and version reach choco,
  // and the file paths are written under the staging directory.
  assertPackage(pkg);
  const directory = await stagingDirectory("verify");
  await verifyStaged(
    pkg,
    settings,
    binary,
    chocoAt(settings.toolPath_),
    directory,
  );
}
