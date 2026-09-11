// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Forwarding a build command from the global `zuke` to the project's build.
 *
 * The global command (`deno install -A -g -n zuke jsr:@zuke/cli`) owns only
 * `setup`, `import` and `doc`. Everything else — `zuke ci`, `zuke --list`,
 * `zuke graph`, `zuke mcp` — belongs to the build in the current project, so
 * `main` forwards it: it walks up from the working directory to the nearest
 * `zuke.json` (the repository-root marker `zuke setup` writes), then runs
 * `zuke.ts` beside it exactly as the `./zuke` launcher would — `deno run -A`,
 * with `--frozen` once a `deno.lock` exists, from the root, stdio inherited.
 * That is the delegation a global `gradle` makes to a checkout's wrapper: one
 * global word, the project's own build and lock deciding what actually runs.
 *
 * Discovery has a trust gate, because it runs code the caller never named:
 * a `zuke.json` planted in a shared parent (`/tmp`, a shared checkout tree)
 * would otherwise have `zuke ci` in any directory below it run a stranger's
 * `zuke.ts` with `-A`. So, as git's `safe.directory` does, a build whose root
 * directory is owned by another user is refused with an error naming the
 * owner and the two ways forward: run that project's own `./zuke` launcher —
 * an explicit act on a file the caller names — or take ownership. Where the
 * platform has no file ownership to compare (Windows), the gate is inert.
 *
 * Locating and planning are pure given a probe, so the routing is
 * unit-testable; the spawn goes through the injectable {@link BuildRunner}.
 *
 * @module
 */

import { absolutePath, CONFIG_FILE } from "@zuke/core";
import { lstatOrNull } from "./fs.ts";

/** The build file a forwarded command runs, beside {@link CONFIG_FILE}. */
export const BUILD_FILE = "zuke.ts";

/** The lockfile whose presence turns on `--frozen`, as in the launchers. */
export const LOCK_FILE = "deno.lock";

/** Where a forwarded command runs, and how. */
export interface BuildLocation {
  /** The absolute repository root: the directory holding `zuke.json`. */
  root: string;
  /** Whether a `deno.lock` sits at the root, so the run passes `--frozen`. */
  frozen: boolean;
}

/**
 * The filesystem questions discovery asks, injectable so the walk and its
 * trust gate are testable without a filesystem or a second user.
 */
export interface BuildProbe {
  /** Whether a path exists. */
  exists(path: string): Promise<boolean>;
  /**
   * The numeric owner of a path, or `null` where the platform has no file
   * ownership to report (Windows).
   */
  ownerOf(path: string): Promise<number | null>;
  /** The current user's numeric id, or `null` where the platform has none. */
  uid(): number | null;
}

/** The real, `Deno`-backed {@link BuildProbe}. */
export const defaultBuildProbe: BuildProbe = {
  async exists(path: string): Promise<boolean> {
    return await lstatOrNull(path) !== null;
  },
  async ownerOf(path: string): Promise<number | null> {
    return (await Deno.stat(path)).uid;
  },
  uid(): number | null {
    return Deno.uid();
  },
};

/**
 * Thrown when the build discovery found belongs to another user — see the
 * module docs for why that is refused rather than run.
 */
export class UntrustedBuildError extends Error {
  /** The error's name, as reported by `String(error)` and stack traces. */
  override name = "UntrustedBuildError";

  /**
   * @param root The directory holding the `zuke.json` that was found.
   * @param owner The numeric owner of that directory.
   * @param uid The current user's numeric id.
   * @param args The forwarded arguments, echoed in the suggested launcher run.
   */
  constructor(
    readonly root: string,
    readonly owner: number,
    readonly uid: number,
    args: string[],
  ) {
    const launcher = ["./zuke", ...args].join(" ");
    super(
      `zuke: refusing to run the build at ${root}: the directory is owned by ` +
        `user ${owner}, not you (${uid}), so a \`zuke.json\` there could have ` +
        `been planted by someone else. If you trust it, run its own launcher ` +
        `there (cd ${root} && ${launcher}), or take ownership of the directory.`,
    );
  }
}

/**
 * Walk up from `cwd` to the nearest directory holding {@link CONFIG_FILE},
 * asking `probe`. Returns `null` when no ancestor has one — the caller is not
 * inside a Zuke project.
 *
 * @throws {UntrustedBuildError} when the root found is owned by another user
 *   (see the module docs). `args` is only echoed in that error's advice.
 */
export async function locateBuild(
  cwd: string,
  probe: BuildProbe,
  args: string[],
): Promise<BuildLocation | null> {
  let dir = absolutePath(cwd);
  while (true) {
    if (await probe.exists(dir(CONFIG_FILE).path)) {
      await assertTrusted(dir.path, probe, args);
      return {
        root: dir.path,
        frozen: await probe.exists(dir(LOCK_FILE).path),
      };
    }
    if (dir.isRoot) return null;
    dir = dir.parent();
  }
}

/**
 * The trust gate: refuse a root owned by a different user. Inert when either
 * side has no id to compare — the platform reports no owner or no user.
 */
async function assertTrusted(
  root: string,
  probe: BuildProbe,
  args: string[],
): Promise<void> {
  const uid = probe.uid();
  if (uid === null) return;
  const owner = await probe.ownerOf(root);
  if (owner === null || owner === uid) return;
  throw new UntrustedBuildError(root, owner, uid, args);
}

/**
 * The `deno` argv for a forwarded command — the launchers' invocation, with
 * `--frozen` only when the location has a lockfile to verify against. Pure.
 */
export function buildRunArgs(
  location: BuildLocation,
  args: string[],
): string[] {
  return [
    "run",
    "-A",
    ...(location.frozen ? ["--frozen"] : []),
    BUILD_FILE,
    ...args,
  ];
}

/**
 * The launchers' notice for a run without a lockfile: a fresh scaffold has
 * none, so the first run must be allowed to write one, and saying so keeps a
 * deleted lockfile from downgrading verification silently.
 */
export const NO_LOCK_NOTICE =
  `zuke: no ${LOCK_FILE} here yet — running without lockfile verification so Deno can write one.`;

/**
 * Runs `deno <denoArgs>` from `root` and resolves to its exit code — the
 * injectable subprocess seam, so the forwarding is testable without a build.
 */
export type BuildRunner = (
  root: string,
  denoArgs: string[],
) => Promise<number>;

/**
 * The default {@link BuildRunner}: spawn the running Deno with stdio inherited
 * — `zuke mcp` speaks JSON-RPC over the same stdin/stdout, and a build may
 * prompt — and, as the launchers do, put that Deno first on the child's `PATH`
 * so CLIs the build provisions with `deno install` can find it by name.
 */
export const defaultBuildRunner: BuildRunner = async (root, denoArgs) => {
  const deno = Deno.execPath();
  const separator = Deno.build.os === "windows" ? ";" : ":";
  const inherited = Deno.env.get("PATH");
  const binDir = absolutePath(deno).parent().path;
  const path = inherited === undefined
    ? binDir
    : `${binDir}${separator}${inherited}`;
  const child = new Deno.Command(deno, {
    args: denoArgs,
    cwd: root,
    env: { PATH: path },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const { code } = await child.status;
  return code;
};
