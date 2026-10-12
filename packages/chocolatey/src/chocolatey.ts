// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `ChocolateyTasks` — shipping a prebuilt Windows binary through Chocolatey:
 * render the package, verify it installs, publish it, and the CI job that
 * runs the verification on Windows.
 *
 * @module
 */

import type { CiInvocation } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import {
  type ChocolateyPackage,
  type ChocolateyPackageSettings,
  renderPackage,
} from "./package.ts";
import {
  type ChocolateyPublishResult,
  type ChocolateyPublishSettings,
  publishPackage,
} from "./publish.ts";
import { type ChocolateyVerifySettings, verifyPackage } from "./verify.ts";
import { type ChocolateyVerifyJobSettings, verifyJob } from "./ci.ts";

/** The shape of {@link ChocolateyTasks}. */
export interface ChocolateyTasksApi {
  /**
   * The files of a package that installs a prebuilt binary from a zip on a
   * release: `<id>.nuspec` and `tools/chocolateyinstall.ps1`. Pure: nothing
   * is read or written.
   *
   * @throws {Error} naming the setter whose value is missing or invalid.
   */
  package(configure: Configure<ChocolateyPackageSettings>): ChocolateyPackage;
  /**
   * Pack a rendered package in a temporary directory, install it from there,
   * run the binary it puts on `PATH`, then uninstall it and remove the
   * directory — the cleanup runs whether or not the install and check
   * succeeded.
   */
  verify(configure: Configure<ChocolateyVerifySettings>): Promise<void>;
  /**
   * Push a package — rendered, or a `.nupkg` already built — to the community
   * repository or another source, with its API key masked.
   */
  publish(
    configure: Configure<ChocolateyPublishSettings>,
  ): Promise<ChocolateyPublishResult>;
  /**
   * The CI job that runs a verifying target on Windows runners, ready to
   * list in `cicd({ invokes: [...] })`.
   */
  verifyJob(configure: Configure<ChocolateyVerifyJobSettings>): CiInvocation;
}

/** Tasks for shipping a prebuilt Windows binary through Chocolatey. */
export const ChocolateyTasks: ChocolateyTasksApi = {
  package(
    configure: Configure<ChocolateyPackageSettings>,
  ): ChocolateyPackage {
    return renderPackage(configure);
  },
  verify(configure: Configure<ChocolateyVerifySettings>): Promise<void> {
    return verifyPackage(configure);
  },
  publish(
    configure: Configure<ChocolateyPublishSettings>,
  ): Promise<ChocolateyPublishResult> {
    return publishPackage(configure);
  },
  verifyJob(configure: Configure<ChocolateyVerifyJobSettings>): CiInvocation {
    return verifyJob(configure);
  },
};
