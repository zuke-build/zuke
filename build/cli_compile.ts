// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Compiling the released `zuke` CLI into standalone binaries.
 *
 * The binaries are compiled from the published `jsr:@zuke/cli@<version>`,
 * not from this checkout: what Homebrew installs is then the same program
 * `deno install -g` installs, resolved the same way, and JSR's own provenance
 * covers its source. `-A` matches the JSR install's permissions, and is also
 * what lets a compiled binary resolve its own path to tell a Homebrew install
 * from another (`packages/cli/src/install_source.ts`).
 *
 * Deno looks for a configuration file from the working directory, and this
 * checkout's would map `@zuke/*` onto the workspace instead of JSR, so the
 * compile runs from an empty temporary directory.
 *
 * @module
 */

import { type DenoCompileSettings, DenoTasks } from "@zuke/deno";
import { $ } from "@zuke/core/shell";
import { binaryPath } from "./cli_package.ts";
import { CLI_TARGETS } from "./cli_release.ts";

/** The published package a release's binaries are compiled from. */
export function cliSpecifier(version: string): string {
  return `jsr:@zuke/cli@${version}`;
}

/** One `deno compile`, as {@link compileCliBinaries} runs it. */
export type Compile = (
  configure: (s: DenoCompileSettings) => DenoCompileSettings,
) => Promise<unknown>;

/**
 * Compile every target's binary into `binDir` — an absolute path, since the
 * compile runs from a temporary directory — then run the one built for this
 * machine, if any, to check it reports `version`.
 */
export async function compileCliBinaries(
  version: string,
  binDir: string,
  compile: Compile = (configure) => DenoTasks.compile(configure),
): Promise<void> {
  const scratch = await Deno.makeTempDir({ prefix: "zuke-compile-" });
  try {
    for (const target of CLI_TARGETS) {
      const output = binaryPath(binDir, target.triple);
      await Deno.mkdir(`${binDir}/${target.triple}`, { recursive: true });
      await compile((s) =>
        s.allowAll().target(target.triple).output(output)
          .script(cliSpecifier(version)).cwd(scratch)
      );
    }
    const host = CLI_TARGETS.find((t) => t.triple === Deno.build.target);
    if (host !== undefined) {
      await assertReportsVersion(binaryPath(binDir, host.triple), version);
    }
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}

/**
 * Run `binary --version` outside any project and fail unless its first line
 * is exactly `version`.
 *
 * This is the check that the compile resolved the release it was asked for.
 * A Deno that holds back recently published versions (2.9 does by default)
 * would otherwise build an older CLI under the new version's name.
 */
export async function assertReportsVersion(
  binary: string,
  version: string,
): Promise<void> {
  const scratch = await Deno.makeTempDir({ prefix: "zuke-smoke-" });
  try {
    const reported = (await $`${binary} --version`.cwd(scratch).env({
      ZUKE_PLAIN: "1",
    }).text()).split("\n")[0];
    if (reported !== version) {
      throw new Error(
        `${binary} reports version ${JSON.stringify(reported)}, not ` +
          `${version}: the compile did not resolve the release it was asked for.`,
      );
    }
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}
