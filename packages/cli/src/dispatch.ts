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
 * `zuke.ts` with `-A`. So, as git's `safe.directory` does, a build is refused
 * when its root directory is owned by another user or is world-writable (so
 * anyone could have planted the files in it). Deno then does a walk of its
 * own — it discovers `deno.json` and `package.json` in the root's ancestors,
 * and an import map planted there rewrites what `zuke.ts` imports — so the
 * gate also refuses any such ancestor config file owned by another user. The
 * error names what was refused and the two ways forward: run that project's
 * own `./zuke` launcher — an explicit act on a file the caller names — or fix
 * the ownership. Where the platform has no file ownership to compare
 * (Windows), the gate is inert.
 *
 * Locating and planning are pure given a probe, so the routing is
 * unit-testable; the spawn goes through the injectable {@link BuildRunner}.
 *
 * @module
 */

import { type AbsolutePath, absolutePath, CONFIG_FILE } from "@zuke/core";
import { exists } from "./fs.ts";
import { noLockNotice } from "./launcher.ts";

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

/** What the trust gate needs to know about a filesystem entry. */
export interface Ownership {
  /** The numeric owner, or `null` where the platform reports none (Windows). */
  uid: number | null;
  /** The permission bits, or `null` where the platform reports none. */
  mode: number | null;
}

/**
 * The filesystem questions discovery asks, injectable so the walk and its
 * trust gate are testable without a filesystem or a second user.
 */
export interface BuildProbe {
  /** Whether a path exists (the link itself, not its target). */
  exists(path: string): Promise<boolean>;
  /**
   * The owner and mode of what a path resolves to, or `null` when nothing is
   * there.
   */
  ownership(path: string): Promise<Ownership | null>;
  /** The current user's numeric id, or `null` where the platform has none. */
  uid(): number | null;
}

/**
 * `Deno.stat` a path, or `null` when nothing is there. Follows links, since
 * the gate judges the directory the build actually runs in. A `NotFound` maps
 * to `null`; any other error is rethrown rather than masked as absence.
 */
async function statOrNull(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/** The real, `Deno`-backed {@link BuildProbe}. */
export const defaultBuildProbe: BuildProbe = {
  exists,
  async ownership(path: string): Promise<Ownership | null> {
    const info = await statOrNull(path);
    return info === null ? null : { uid: info.uid, mode: info.mode };
  },
  uid(): number | null {
    return Deno.uid();
  },
};

/**
 * Thrown when the build discovery found cannot be trusted — see the module
 * docs for why it is refused rather than run.
 */
export class UntrustedBuildError extends Error {
  /** The error's name, as reported by `String(error)` and stack traces. */
  override name = "UntrustedBuildError";

  /**
   * Build the refusal for `root`, explaining `reason` and the ways forward.
   *
   * @param root The directory holding the `zuke.json` that was found.
   * @param reason What the gate refused, as a clause: "the directory … ".
   */
  constructor(readonly root: string, readonly reason: string) {
    // Prose only — never a rendered shell line to paste, since `root` is
    // whatever the filesystem says and the launcher there belongs to whoever
    // owns it.
    super(
      `zuke: refusing to run the build at ${root}: ${reason}, so the files ` +
        `there could have been planted by someone else. If you trust it, run ` +
        `its own launcher from that directory (./zuke), or fix the ownership.`,
    );
  }
}

/**
 * The config files Deno discovers in a root's ancestors — an import map in any
 * of them rewrites what `zuke.ts` imports, so they are gated like the root.
 */
const ANCESTOR_CONFIG_FILES = ["deno.json", "deno.jsonc", "package.json"];

/**
 * The files in the root itself that decide what runs: the build, its marker,
 * its lockfile, and the root's own config. Owning the directory is not owning
 * these — a `chown` of the directory alone leaves them as they were.
 */
const ROOT_FILES = [
  CONFIG_FILE,
  BUILD_FILE,
  LOCK_FILE,
  ...ANCESTOR_CONFIG_FILES,
];

/** The world-writable permission bit. */
const WORLD_WRITABLE = 0o002;

/**
 * Walk up from `cwd` to the nearest directory holding {@link CONFIG_FILE},
 * asking `probe`. Returns `null` when no ancestor has one — the caller is not
 * inside a Zuke project.
 *
 * @throws {UntrustedBuildError} when the root found fails the trust gate (see
 *   the module docs).
 */
export async function locateBuild(
  cwd: string,
  probe: BuildProbe,
): Promise<BuildLocation | null> {
  let dir = absolutePath(cwd);
  while (true) {
    if (await probe.exists(dir(CONFIG_FILE).path)) {
      await assertTrusted(dir, probe);
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
 * The trust gate. Inert when the platform reports no user id; otherwise the
 * root must be owned by the current user and not world-writable, the files in
 * it that decide what runs must be the user's too, and no ancestor may hold a
 * Deno- or npm-discovered config file owned by someone else. An entry the
 * platform reports without an owner or mode is not judged on that property.
 */
async function assertTrusted(
  root: AbsolutePath,
  probe: BuildProbe,
): Promise<void> {
  const uid = probe.uid();
  if (uid === null) return;
  const own = await probe.ownership(root.path);
  if (own !== null) {
    if (own.uid !== null && own.uid !== uid) {
      throw new UntrustedBuildError(
        root.path,
        `the directory is owned by user ${own.uid}, not you (${uid})`,
      );
    }
    if (own.mode !== null && (own.mode & WORLD_WRITABLE) !== 0) {
      throw new UntrustedBuildError(
        root.path,
        "the directory is writable by everyone",
      );
    }
  }
  await assertFilesOwned(root, ROOT_FILES, uid, probe, root);
  for (let dir = root; !dir.isRoot;) {
    dir = dir.parent();
    await assertFilesOwned(dir, ANCESTOR_CONFIG_FILES, uid, probe, root);
  }
}

/**
 * Refuse when any of `names` in `dir` exists and is owned by someone other
 * than `uid`; an absent file, or one the platform reports without an owner,
 * passes.
 */
async function assertFilesOwned(
  dir: AbsolutePath,
  names: string[],
  uid: number,
  probe: BuildProbe,
  root: AbsolutePath,
): Promise<void> {
  for (const name of names) {
    const file = dir(name).path;
    const own = await probe.ownership(file);
    if (own !== null && own.uid !== null && own.uid !== uid) {
      throw new UntrustedBuildError(
        root.path,
        `${file} is owned by user ${own.uid}, not you (${uid})`,
      );
    }
  }
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

/** The launchers' notice for a run without a lockfile, verbatim. */
export const NO_LOCK_NOTICE: string = noLockNotice("—");

/**
 * Runs `deno <denoArgs>` from `root` and resolves to its exit code — the
 * injectable subprocess seam, so the forwarding is testable without a build.
 */
export type BuildRunner = (
  root: string,
  denoArgs: string[],
) => Promise<number>;

/**
 * The signals the forwarding parent handles while the build runs, and how.
 *
 * The launcher `exec`s Deno, so there the shell waits on the build itself. A
 * forwarding parent cannot exec, so it must not die first: a Ctrl-C reaches
 * the whole foreground group, and the build's own handler cancels it
 * gracefully (a second Ctrl-C force-exits), so the parent only **ignores**
 * SIGINT — forwarding it would deliver that second signal — and stays to
 * report the build's exit code. SIGTERM is addressed to one process, so it is
 * **forwarded** to the build. Windows has no SIGTERM to listen for; its
 * Ctrl-Break is ignored like Ctrl-C.
 */
function signalPlan(
  child: Deno.ChildProcess,
): Array<[Deno.Signal, () => void]> {
  const ignore = (): void => {};
  const forward = (signal: Deno.Signal) => (): void => {
    try {
      child.kill(signal);
    } catch {
      // The build already exited; its status is what the caller awaits.
    }
  };
  return Deno.build.os === "windows"
    ? [["SIGINT", ignore], ["SIGBREAK", ignore]]
    : [["SIGINT", ignore], ["SIGTERM", forward("SIGTERM")]];
}

/**
 * The default {@link BuildRunner}: spawn the running Deno with stdio inherited
 * — `zuke mcp` speaks JSON-RPC over the same stdin/stdout, and a build may
 * prompt — and, as the launchers do, put that Deno first on the child's `PATH`
 * so CLIs the build provisions with `deno install` can find it by name. For
 * the build's lifetime the parent handles signals as {@link signalPlan} says,
 * so an interrupted build is never orphaned with its exit code lost.
 */
export const defaultBuildRunner: BuildRunner = async (
  root,
  denoArgs,
): Promise<number> => {
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
  const plan = signalPlan(child);
  for (const [signal, handler] of plan) {
    Deno.addSignalListener(signal, handler);
  }
  try {
    const { code } = await child.status;
    return code;
  } finally {
    for (const [signal, handler] of plan) {
      Deno.removeSignalListener(signal, handler);
    }
  }
};
