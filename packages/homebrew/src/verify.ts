// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link HomebrewVerifySettings} and `HomebrewTasks.verify`: install a formula
 * file the way a user would, run its test, and remove it again.
 *
 * ```ts
 * verifyFormula = target().executes(async () => {
 *   await HomebrewTasks.verify((s) => s.formulaFile("dist/app.rb").name("app"));
 * });
 * ```
 *
 * Current Homebrew will not install a formula from a file path: it reports
 * "Homebrew requires formulae to be in a tap" unless `HOMEBREW_DEVELOPER` is
 * set (`HOMEBREW_FORBID_PACKAGES_FROM_PATHS` defaults on; Homebrew/brew#20414).
 * So the formula is put where Homebrew wants it — a throwaway local tap made
 * with `brew tap-new --no-git`, the same thing the tap-new docs suggest — and
 * installed by its tap-qualified name:
 *
 * 1. `brew tap-new --no-git zuke-verify/verify-<random>`
 * 2. copy the file to `<tap directory>/Formula/<name>.rb` (the directory comes
 *    from `brew --repository <tap>`)
 * 3. `brew install --formula zuke-verify/verify-<random>/<name>`
 * 4. `brew test zuke-verify/verify-<random>/<name>`
 * 5. `brew uninstall --formula …` once installed, then `brew untap --force …`
 *    — always, whether or not the steps before it succeeded
 *
 * The tap name is random so a run interrupted before its cleanup leaves no tap
 * behind that the next run would collide with. Every `brew` call runs with
 * `HOMEBREW_NO_AUTO_UPDATE=1`, so a verification checks this formula rather
 * than first updating every tap on the machine.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import type { Configure, PathLike } from "@zuke/core/tooling";
import { BrewTasks } from "./brew.ts";
import type { BrewSettings } from "./brew_settings.ts";
import { assertDefinesFormula, formulaClassName } from "./formula_name.ts";

/** The user part of the throwaway tap. */
const TAP_USER = "zuke-verify";

/** The environment every `brew` call in a verification runs with. */
const BREW_ENV = {
  HOMEBREW_NO_AUTO_UPDATE: "1",
  HOMEBREW_NO_ENV_HINTS: "1",
};

/** Settings for verifying a formula file. */
export class HomebrewVerifySettings {
  /** The formula file to verify. Set by {@link formulaFile}. */
  formulaFile_?: string;
  /** The formula's name. Set by {@link name}. */
  name_?: string;
  /** The `brew` binary to run. Set by {@link toolPath}. */
  toolPath_?: string;

  /** The formula's Ruby source on disk (required), e.g. `dist/app.rb`. */
  formulaFile(path: PathLike): this {
    this.formulaFile_ = String(path);
    return this;
  }

  /**
   * The formula's name (required) — the class the file defines is derived
   * from it, and it is installed and tested under it.
   */
  name(value: string): this {
    this.name_ = value;
    return this;
  }

  /**
   * The `brew` to run, when it is not on `PATH` — on a GitHub Linux runner
   * Homebrew is installed but not on `PATH`:
   * `/home/linuxbrew/.linuxbrew/bin/brew`.
   */
  toolPath(path: PathLike): this {
    this.toolPath_ = String(path);
    return this;
  }
}

/** A short random suffix for the throwaway tap. */
function randomSuffix(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

/**
 * Run `steps` in order, every one even when an earlier one failed, and raise
 * what failed: the one error itself, or an `AggregateError` of several.
 */
async function runAll(steps: Array<() => Promise<unknown>>): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "verifying the formula failed");
  }
}

/** Perform the configured verification. */
export async function verifyFormula(
  configure: Configure<HomebrewVerifySettings>,
): Promise<void> {
  const settings = configure(new HomebrewVerifySettings());
  const { formulaFile_: file, name_: name, toolPath_: toolPath } = settings;
  if (file === undefined) {
    throw new Error("verifying a formula requires .formulaFile(path).");
  }
  if (name === undefined) {
    throw new Error("verifying a formula requires .name(...).");
  }
  // Validated before anything runs: the name becomes a file name in the tap.
  formulaClassName(name);
  const source = await FileTasks.readText(file);
  assertDefinesFormula(source, name);

  /** Apply the shared environment and binary to one `brew` call. */
  const brew = <S extends BrewSettings>(s: S): S => {
    s.env(BREW_ENV);
    if (toolPath !== undefined) s.toolPath(toolPath);
    return s;
  };
  const tap = `${TAP_USER}/verify-${randomSuffix()}`;
  const qualified = `${tap}/${name}`;

  await BrewTasks.tapNew((s) => brew(s).name(tap).noGit());
  let installed = false;
  await runAll([
    async () => {
      const directory = await BrewTasks.repository((s) => brew(s).tap(tap));
      await FileTasks.writeText(`${directory}/Formula/${name}.rb`, source);
      await BrewTasks.install((s) => brew(s).formula().formulae(qualified));
      // Only after it succeeded: uninstalling a keg that is not there fails
      // and would bury the install's own error. A half-finished install is
      // still removed — `untap --force` uninstalls whatever the tap installed.
      installed = true;
      await BrewTasks.test((s) => brew(s).formulae(qualified));
    },
    async () => {
      if (installed) {
        await BrewTasks.uninstall((s) =>
          brew(s).formula().force().formulae(qualified)
        );
      }
    },
    () => BrewTasks.untap((s) => brew(s).force().taps(tap)),
  ]);
}
