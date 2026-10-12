// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link ChocolateyPublishSettings} and `ChocolateyTasks.publish`: push a
 * package to the community repository, or to another feed.
 *
 * ```ts
 * await ChocolateyTasks.publish((s) => s.package(pkg).apiKey(chocoKey));
 * ```
 *
 * A rendered package is staged and packed in a fresh temporary directory, the
 * `.nupkg` pushed with `choco push`, and the directory removed — whether or
 * not the push succeeded. A `.nupkg` already built is pushed as it is.
 *
 * The API key travels as `--api-key=<key>`: choco reads a key from its
 * argument or from what `choco apikey add` saved, and from nowhere else — no
 * environment variable, no standard input. So the key is registered with the
 * run's redactor, and masked out of every error the push raises, in a run or
 * outside one. On a host shared with other users, who could read it from the
 * process table while the push runs, save it with
 * `ChocoTasks.apikey((s) => s.add()…)` instead and leave {@link
 * ChocolateyPublishSettings.apiKey} unset.
 *
 * @module
 */

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
import { assertHttpsUrl } from "./url.ts";

/** The community repository's push endpoint. */
const COMMUNITY_SOURCE = "https://push.chocolatey.org/";

/** What a `ChocolateyTasks.publish` call pushed, and where. */
export interface ChocolateyPublishResult {
  /** The source pushed to. */
  source: string;
  /** The file name of the `.nupkg` pushed, e.g. `app.1.2.3.nupkg`. */
  nupkg: string;
}

/** Settings for publishing a package. */
export class ChocolateyPublishSettings {
  /** The rendered package to pack and push. Set by {@link package}. */
  package_?: ChocolateyPackage;
  /** A `.nupkg` already built. Set by {@link nupkg}. */
  nupkg_?: string;
  /** The API key. Set by {@link apiKey}. */
  apiKey_?: string;
  /** The source to push to. Set by {@link source}. */
  source_: string = COMMUNITY_SOURCE;
  /** The `choco` binary to run. Set by {@link toolPath}. */
  toolPath_?: string;

  /**
   * The package to publish — what `ChocolateyTasks.package` rendered. It is
   * packed in a temporary directory and the `.nupkg` pushed. Set this or
   * {@link nupkg}, not both.
   */
  package(value: ChocolateyPackage): this {
    this.package_ = value;
    return this;
  }

  /** A `.nupkg` already built, pushed as it is. Set this or {@link package}. */
  nupkg(path: PathLike): this {
    this.nupkg_ = String(path);
    return this;
  }

  /**
   * The source's API key — for the community repository, the one on
   * `https://community.chocolatey.org/account`. Masked in every rendering of
   * the push and in its errors. When unset, choco uses the key saved for the
   * source with `choco apikey add`.
   */
  apiKey(value: string): this {
    this.apiKey_ = value;
    return this;
  }

  /**
   * The source to push to (`https`), defaulting to the community repository,
   * `https://push.chocolatey.org/`. An internal feed's push URL works too.
   */
  source(url: string): this {
    this.source_ = url;
    return this;
  }

  /** The `choco` to run, when it is not on `PATH`. */
  toolPath(path: PathLike): this {
    this.toolPath_ = String(path);
    return this;
  }
}

/** `choco push` one `.nupkg`, from `cwd` when given. */
async function push(
  settings: ChocolateyPublishSettings,
  choco: ChocoCall,
  nupkg: string,
  cwd: string | undefined,
): Promise<void> {
  const apiKey = settings.apiKey_;
  await ChocoTasks.push((s) => {
    choco(s).nupkg(nupkg).source(settings.source_);
    if (apiKey !== undefined) s.apiKey(apiKey);
    if (cwd !== undefined) s.cwd(cwd);
    return s;
  });
}

/** Stage, pack and push a rendered package; the staging is always removed. */
async function publishRendered(
  settings: ChocolateyPublishSettings,
  pkg: ChocolateyPackage,
  choco: ChocoCall,
): Promise<string> {
  assertPackage(pkg);
  const directory = await stagingDirectory("publish");
  let nupkg = "";
  await runAll([
    async () => {
      await writePackage(pkg, directory);
      nupkg = await packPackage(pkg, directory, choco);
      // The file name, from the directory it is in: no absolute path
      // reaches choco as an operand.
      await push(settings, choco, nupkg, directory);
    },
    () => removeStaging(directory),
  ], "publishing the Chocolatey package failed");
  return nupkg;
}

/** Perform the configured publish. */
export async function publishPackage(
  configure: Configure<ChocolateyPublishSettings>,
): Promise<ChocolateyPublishResult> {
  const settings = configure(new ChocolateyPublishSettings());
  const { package_: pkg, nupkg_: file, apiKey_: apiKey } = settings;
  if (pkg !== undefined && file !== undefined) {
    throw new Error(
      "publishing to Chocolatey takes .package(...) or .nupkg(path), not both.",
    );
  }
  if (apiKey === "") {
    throw new Error(
      "publishing to Chocolatey was given an empty .apiKey(...); leave it " +
        "unset to use the key saved with choco apikey add.",
    );
  }
  // An API key over plaintext is a key anyone on the path can read.
  assertHttpsUrl(settings.source_, "Chocolatey publish .source(...)");
  const choco = chocoAt(settings.toolPath_);
  if (pkg !== undefined) {
    const nupkg = await publishRendered(settings, pkg, choco);
    return { source: settings.source_, nupkg };
  }
  if (file === undefined) {
    throw new Error(
      "publishing to Chocolatey requires .package(...) — a rendered " +
        "package — or .nupkg(path).",
    );
  }
  await push(settings, choco, file, undefined);
  return { source: settings.source_, nupkg: file.replace(/^.*[\\/]/, "") };
}
