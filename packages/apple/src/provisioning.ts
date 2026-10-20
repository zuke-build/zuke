// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `ProvisioningProfileTasks` — read a provisioning profile, and install it
 * where Xcode looks for one, so an archive or export on a CI machine can sign
 * with it.
 *
 * ```ts
 * import { ProvisioningProfileTasks, XcodebuildTasks } from "@zuke/apple";
 *
 * await ProvisioningProfileTasks.temporary(
 *   (s) => s.base64(profileBase64),
 *   async ({ profile }) => {
 *     await XcodebuildTasks.writeExportOptions("ExportOptions.plist", (o) =>
 *       o.method("app-store-connect").signingStyle("manual")
 *         .provisioningProfile(profile.bundleId, profile.uuid)
 *     );
 *   },
 * );
 * ```
 *
 * A profile is installed as `<uuid>.mobileprovision` into both directories
 * Xcode has read profiles from — `~/Library/Developer/Xcode/UserData/
 * Provisioning Profiles` (Xcode 16 and later) and `~/Library/MobileDevice/
 * Provisioning Profiles` (earlier) — unless `.directory()` names others.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import { ProvisioningProfileError } from "./errors.ts";
import {
  defaultProvisioningHost,
  type ProvisioningHost,
} from "./provisioning_host.ts";
import {
  type ProvisioningProfile,
  readProvisioningProfile,
} from "./provisioning_profile.ts";

/** The directories under the home directory Xcode reads profiles from. */
const PROFILE_DIRECTORIES = [
  "Library/Developer/Xcode/UserData/Provisioning Profiles",
  "Library/MobileDevice/Provisioning Profiles",
];

/** Settings for `ProvisioningProfileTasks`. */
export class ProvisioningProfileSettings {
  /** The profile file (set by {@link file}). */
  file_?: string;
  /** The profile as base64 (set by {@link base64}). */
  base64_?: string;
  /** Directories to install into (set by {@link directory}). */
  directories_: string[] = [];
  /** Whether an expired profile may be installed (set by {@link allowExpired}). */
  allowExpired_ = false;
  /** The file-system seam (set by {@link host}). */
  host_: ProvisioningHost = defaultProvisioningHost;
  /** The clock, in epoch ms (set by {@link now}). */
  now_: () => number = Date.now;

  /** Read the profile from a `.mobileprovision` file. */
  file(path: PathLike): this {
    this.file_ = String(path);
    return this;
  }

  /**
   * Take the profile as base64 — how a CI secret usually holds it
   * (`base64 -i profile.mobileprovision`).
   */
  base64(text: string): this {
    this.base64_ = text;
    return this;
  }

  /**
   * Install into this directory instead of Xcode's two defaults; repeatable.
   */
  directory(path: PathLike): this {
    this.directories_.push(String(path));
    return this;
  }

  /** Install the profile even if it has expired. */
  allowExpired(): this {
    this.allowExpired_ = true;
    return this;
  }

  /** Work through `host` instead of the real file system — the test seam. */
  host(host: ProvisioningHost): this {
    this.host_ = host;
    return this;
  }

  /** Read the time from `clock` (epoch ms) instead of `Date.now`. */
  now(clock: () => number): this {
    this.now_ = clock;
    return this;
  }
}

/** An installed provisioning profile. */
export interface InstalledProvisioningProfile {
  /** What the profile says about itself. */
  readonly profile: ProvisioningProfile;
  /** Every file it was installed as. */
  readonly paths: readonly string[];
}

/** The profile's bytes, from whichever source was set. */
async function profileBytes(
  settings: ProvisioningProfileSettings,
): Promise<Uint8Array> {
  const { file_, base64_ } = settings;
  if (file_ !== undefined && base64_ === undefined) {
    return await settings.host_.readFile(file_);
  }
  if (base64_ !== undefined && file_ === undefined) {
    try {
      return Uint8Array.from(
        atob(base64_.replace(/\s+/g, "")),
        (c) => c.charCodeAt(0),
      );
    } catch {
      throw new ProvisioningProfileError("the .base64() value is not base64.");
    }
  }
  throw new ProvisioningProfileError(
    "set exactly one of .file() and .base64().",
  );
}

/** Read and parse the profile `settings` names. */
async function read(
  settings: ProvisioningProfileSettings,
): Promise<{ profile: ProvisioningProfile; bytes: Uint8Array }> {
  const bytes = await profileBytes(settings);
  return { profile: readProvisioningProfile(bytes), bytes };
}

/**
 * Remove `paths`, attempting every one; throw a
 * {@link ProvisioningProfileError} naming each that failed, with `cause` when
 * an earlier error led here.
 */
async function removeAll(
  host: ProvisioningHost,
  paths: readonly string[],
  options?: ErrorOptions,
): Promise<void> {
  const failed: string[] = [];
  for (const path of paths) {
    try {
      await host.remove(path);
    } catch (error) {
      failed.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (failed.length > 0) {
    throw new ProvisioningProfileError(
      `could not remove ${failed.join("; ")}`,
      options,
    );
  }
}

/**
 * Install the profile `settings` names; return it and its paths. If one
 * write fails, the files already written are removed before it throws.
 */
async function install(
  settings: ProvisioningProfileSettings,
): Promise<InstalledProvisioningProfile> {
  const { profile, bytes } = await read(settings);
  if (
    !settings.allowExpired_ &&
    profile.expirationDate.getTime() <= settings.now_()
  ) {
    throw new ProvisioningProfileError(
      `"${profile.name}" (${profile.uuid}) expired on ` +
        `${profile.expirationDate.toISOString()}; renew it, or pass ` +
        `.allowExpired().`,
    );
  }
  // The UUID names the installed file, so it must not be able to leave the
  // directory.
  if (!/^[0-9A-Fa-f-]+$/.test(profile.uuid)) {
    throw new ProvisioningProfileError(
      `the UUID ${JSON.stringify(profile.uuid)} cannot name a file.`,
    );
  }
  const host = settings.host_;
  const directories = settings.directories_.length > 0
    ? settings.directories_
    : PROFILE_DIRECTORIES.map((dir) => `${host.home()}/${dir}`);
  const paths: string[] = [];
  try {
    for (const directory of directories) {
      await host.makeDirectory(directory);
      const path = `${directory}/${profile.uuid}.mobileprovision`;
      await host.writeFile(path, bytes);
      paths.push(path);
    }
  } catch (error) {
    await removeAll(host, paths, { cause: error });
    throw error;
  }
  return { profile, paths };
}

/** The shape of {@link ProvisioningProfileTasks}. */
export interface ProvisioningProfileTasksApi {
  /** Read what a profile says about itself, without installing it. */
  inspect(
    configure: Configure<ProvisioningProfileSettings>,
  ): Promise<ProvisioningProfile>;
  /**
   * Install a profile where Xcode looks for it, named by its UUID. Refuses an
   * expired profile unless `.allowExpired()`.
   */
  install(
    configure: Configure<ProvisioningProfileSettings>,
  ): Promise<InstalledProvisioningProfile>;
  /**
   * Install a profile, run `fn`, then remove every file installed — even when
   * `fn` throws. Returns what `fn` returns.
   *
   * @throws {ProvisioningProfileError} when a file could not be removed; if
   *   `fn` had thrown first, its error is the cause.
   */
  temporary<T>(
    configure: Configure<ProvisioningProfileSettings>,
    fn: (installed: InstalledProvisioningProfile) => Promise<T>,
  ): Promise<T>;
}

/** Read and install provisioning profiles. */
export const ProvisioningProfileTasks: ProvisioningProfileTasksApi = {
  async inspect(configure) {
    return (await read(configure(new ProvisioningProfileSettings()))).profile;
  },
  install(configure) {
    return install(configure(new ProvisioningProfileSettings()));
  },
  async temporary(configure, fn) {
    const settings = configure(new ProvisioningProfileSettings());
    const installed = await install(settings);
    let result;
    try {
      result = await fn(installed);
    } catch (error) {
      await removeAll(settings.host_, installed.paths, { cause: error });
      throw error;
    }
    await removeAll(settings.host_, installed.paths);
    return result;
  },
};
