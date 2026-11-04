// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Compiling the released `zuke` CLI into standalone binaries.
 *
 * The binaries are compiled from published releases, not from this
 * checkout: the entry `build/cli_binary.ts` renders imports
 * `jsr:@zuke/cli@<version>`, the engine and every wrapper at their exact
 * releases, so what Homebrew installs runs the same code `deno install -g`
 * resolves, and JSR's own provenance covers its source. `-A` matches the JSR
 * install's permissions, and is also what lets a compiled binary resolve its
 * own path to tell a Homebrew install from another
 * (`packages/cli/src/install_source.ts`).
 *
 * Deno looks for a configuration file from the working directory, and this
 * checkout's would map `@zuke/*` onto the workspace instead of JSR, so the
 * entry is written to, and compiled from, an empty temporary directory.
 *
 * @module
 */

import { type DenoCompileSettings, DenoTasks } from "@zuke/deno";
import { type AbsolutePath, absolutePath } from "@zuke/core";
import { $ } from "@zuke/core/shell";
import { binaryPath } from "./cli_package.ts";
import { CLI_TARGETS, type Fetch, WINDOWS_TRIPLE } from "./cli_release.ts";

/** The published package a release's binaries are compiled from. */
export function cliSpecifier(version: string): string {
  return `jsr:@zuke/cli@${version}`;
}

/** The registry document `deno compile` resolves a `@zuke/<pkg>` release against. */
export function jsrMetaUrl(pkg: string): string {
  return `https://jsr.io/@zuke/${pkg}/meta.json`;
}

/** How often {@link awaitJsrListing} asks again, and for how long in all. */
const LISTING_POLL_MS = 5_000;
const LISTING_DEADLINE_MS = 180_000;

/** Pause for `ms`, the default clock of {@link awaitJsrListing}. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until JSR lists `version` of `@zuke/<pkg>`, polling its
 * {@link jsrMetaUrl} every few seconds for up to three minutes.
 *
 * The publish job finishes seconds before the registry's metadata shows the
 * release it accepted, and `deno compile` resolves the specifier against that
 * metadata: the first CLI release compiled right after its publish failed
 * with "Could not find version". `fetcher` and `wait` are injectable so the
 * wait is testable without the registry or the clock.
 *
 * @throws {Error} naming the version, the document and the last answer when
 * the deadline passes.
 */
export async function awaitJsrListing(
  pkg: string,
  version: string,
  fetcher: Fetch = fetch,
  wait: (ms: number) => Promise<void> = pause,
): Promise<void> {
  let last = "";
  for (let waited = 0;; waited += LISTING_POLL_MS) {
    const response = await fetcher(jsrMetaUrl(pkg), { cache: "no-store" });
    if (response.ok) {
      const meta: unknown = await response.json();
      const versions = typeof meta === "object" && meta !== null
        ? Reflect.get(meta, "versions")
        : undefined;
      if (
        typeof versions === "object" && versions !== null &&
        Object.hasOwn(versions, version)
      ) {
        return;
      }
      last = `a document not listing it`;
    } else {
      last = `HTTP ${response.status}`;
    }
    if (waited >= LISTING_DEADLINE_MS) {
      throw new Error(
        `@zuke/${pkg} ${version} is not listed by ${jsrMetaUrl(pkg)} after ` +
          `${LISTING_DEADLINE_MS / 1000}s (last answer: ${last}), so the ` +
          `compile would not resolve it. Re-run the job once the registry ` +
          `shows the release.`,
      );
    }
    await wait(LISTING_POLL_MS);
  }
}

/** One `deno compile`, as {@link compileCliBinaries} runs it. */
export type Compile = (
  configure: (s: DenoCompileSettings) => DenoCompileSettings,
) => Promise<unknown>;

/** The entry module's file name in the compile's temporary directory. */
export const ENTRY_FILE = "zuke.ts";

/**
 * Compile `entry`, the module `build/cli_binary.ts` renders, into every
 * target's binary in `binDir` — absolute, since the compile runs from a
 * temporary directory — then run the one built for this machine, if any, to
 * check it reports `version`.
 */
export async function compileCliBinaries(
  version: string,
  binDir: AbsolutePath,
  entry: string,
  compile: Compile = (configure) => DenoTasks.compile(configure),
): Promise<void> {
  const scratch = await Deno.makeTempDir({ prefix: "zuke-compile-" });
  try {
    await Deno.writeTextFile(`${scratch}/${ENTRY_FILE}`, entry);
    const triples = [...CLI_TARGETS.map((t) => t.triple), WINDOWS_TRIPLE];
    for (const triple of triples) {
      const output = binaryPath(binDir.path, triple);
      await Deno.mkdir(binDir(triple).path, { recursive: true });
      await compile((s) =>
        s.allowAll().target(triple).output(output)
          .script(ENTRY_FILE).cwd(scratch)
      );
    }
    const host = triples.find((triple) => triple === Deno.build.target);
    if (host !== undefined) {
      await assertReportsVersion(
        absolutePath(binaryPath(binDir.path, host)),
        version,
      );
    }
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}

/**
 * Run `binary --version` outside any project and fail unless its first line
 * is exactly `version`.
 *
 * `binary` is absolute because the check runs from an empty temporary
 * directory, where a relative path would name nothing.
 *
 * This is the check that the compile resolved the release it was asked for.
 * A Deno that holds back recently published versions (2.9 does by default)
 * would otherwise build an older CLI under the new version's name.
 */
export async function assertReportsVersion(
  binary: AbsolutePath,
  version: string,
): Promise<void> {
  const scratch = await Deno.makeTempDir({ prefix: "zuke-smoke-" });
  try {
    const reported = (await $`${binary.path} --version`.cwd(scratch).env({
      ZUKE_PLAIN: "1",
    }).text()).split("\n")[0];
    if (reported !== version) {
      throw new Error(
        `${binary.path} reports version ${JSON.stringify(reported)}, not ` +
          `${version}: the compile did not resolve the release it was asked for.`,
      );
    }
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}
