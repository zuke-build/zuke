// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The engine as a compiled binary carries it. The global `zuke` command is a
 * `deno compile` binary, and such a binary cannot import a module it was not
 * compiled with: the dynamic `jsr:` import {@link importTool} makes fails with
 * "Module not found". So the binary holds every wrapper release it serves,
 * each behind a literal import the compile embeds, and answers a `tool.call`
 * from those. A release serves a call that asks for the same major version
 * and no newer one; anything else is refused with what to do about it, since
 * the binary has no other release to offer: a newer `zuke`, which for a
 * project's launcher is `zuke upgrade --engine`.
 *
 * @module
 */

import type { ToolResolver } from "./tools.ts";

/** One wrapper release compiled into the binary. */
export interface EmbeddedRelease {
  /** The release's version, such as `1.4.0`. */
  readonly version: string;
  /** Load the release's module: a literal `import(...)` the compile embeds. */
  readonly load: () => Promise<Record<string, unknown>>;
}

/** An exact release's numeric `major.minor.patch` and its prerelease, if any. */
interface Release {
  readonly numbers: readonly [number, number, number];
  readonly prerelease: string | undefined;
}

/** `version` read as an exact release, or `undefined`. */
function parseRelease(version: string): Release | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  return match === null ? undefined : {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4],
  };
}

/**
 * Whether the release `carried` serves what was asked for as `wanted`: the
 * same major version, and no older than `wanted`, which semantic versioning
 * says is compatible. A prerelease is older than its release, so it serves
 * only an older release or itself. A version that is not an exact release
 * serves nothing and is served by nothing.
 */
export function servesRelease(carried: string, wanted: string): boolean {
  const have = parseRelease(carried);
  const want = parseRelease(wanted);
  if (have === undefined || want === undefined) return false;
  const [major, minor, patch] = have.numbers;
  if (major !== want.numbers[0]) return false;
  if (minor !== want.numbers[1]) return minor > want.numbers[1];
  if (patch !== want.numbers[2]) return patch > want.numbers[2];
  return have.prerelease === undefined || carried === wanted;
}

/** What to do about a release the binary cannot serve. */
const REMEDY = "update this zuke to a release that carries it; a project's " +
  "launchers move to the latest with `zuke upgrade --engine`";

/**
 * The {@link ToolResolver} of a binary holding `releases`, by package name
 * after `@zuke/`. A package it does not hold, or a release that does not
 * serve the version asked for, is refused with a message naming both and the
 * two ways past it.
 */
export function embeddedTools(
  releases: Readonly<Record<string, EmbeddedRelease>>,
): ToolResolver {
  return async (pkg, version) => {
    // Own keys only, so a name such as `constructor` is not found on the
    // prototype.
    const release = Object.hasOwn(releases, pkg) ? releases[pkg] : undefined;
    if (release === undefined) {
      throw new Error(`this zuke carries no @zuke/${pkg}: ${REMEDY}`);
    }
    if (!servesRelease(release.version, version)) {
      throw new Error(
        `this zuke carries @zuke/${pkg} ${release.version}, which cannot ` +
          `serve ${version}: ${REMEDY}`,
      );
    }
    return await release.load();
  };
}
