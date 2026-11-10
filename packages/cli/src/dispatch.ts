// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Forwarding a build command from the global `zuke` to the project's build.
 *
 * The global command (`deno install -A -g -n zuke jsr:@zuke/cli`) owns only
 * `setup`, `import`, `doc` and `upgrade`. Everything else — `zuke ci`, `zuke --list`,
 * `zuke graph`, `zuke mcp` — belongs to the build in the current project, so
 * `main` forwards it: it walks up from the working directory to the nearest
 * `zuke.json` (the repository-root marker `zuke setup` writes), then runs the
 * executable `./zuke` launcher beside it, from the root, stdio inherited.
 * That is the delegation a global `gradle` makes to a checkout's wrapper: one
 * global word, the project's own launcher, build and lock deciding what
 * actually runs — a pinned Deno, an exported environment variable, a lock kept
 * somewhere other than `./deno.lock` all apply to `zuke` exactly as to
 * `./zuke`. A root with no executable launcher (and every root on Windows,
 * whose files report no mode) gets the launcher's own invocation instead:
 * `deno run -A zuke.ts`, with `--frozen` once a `deno.lock` exists.
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
 * (Windows), the gate is inert. A hosted build's launcher starts `zuke` in
 * the root it sits in, so that root, named in {@link LAUNCHER_ROOT_ENV}, is
 * not judged either: running the launcher was the explicit act.
 *
 * A build another SDK hosts (a `zuke.json` and no `zuke.ts`) needs nothing
 * from Deno's stack. The standalone binary runs it on its built-in engine,
 * or, for a pin that engine cannot serve, through the project's launcher,
 * which downloads the `zuke` release it pins; it never falls back to Deno.
 *
 * Locating and planning are pure given a probe, so the routing is
 * unit-testable; the spawn goes through the injectable {@link BuildRunner}.
 *
 * @module
 */

import { type AbsolutePath, absolutePath, CONFIG_FILE } from "@zuke/core";
import { exists } from "./fs.ts";
import { noLockNotice } from "./launcher.ts";
import { BINARY_INSTALL_DOCS } from "./binary_pin.ts";
import { BUILD_FILE, buildFileNamed } from "./build_file.ts";
import { QUIET_DENO_ENV, spawnDeno } from "./deno_path.ts";
import { EMBEDDED_ENGINE_ENV, type EmbeddedEngine } from "./embedded_engine.ts";

/**
 * Deno's own config files, in the order it prefers them: a `deno.json` wins
 * over a `deno.jsonc` beside it.
 */
export const DENO_CONFIG_FILES = ["deno.json", "deno.jsonc"] as const;

/** The lockfile whose presence turns on `--frozen`, as in the launchers. */
export const LOCK_FILE = "deno.lock";

/** The POSIX launcher a forwarded command runs, beside {@link CONFIG_FILE}. */
export const LAUNCHER_FILE = "zuke";

/**
 * Set to `1` in a launcher's environment, so a launcher that itself calls the
 * global `zuke` gets the bare `deno run` instead of itself again, endlessly.
 */
export const FORWARDED_ENV = "ZUKE_FORWARDED";

/**
 * Set by a hosted build's launcher to its own directory, so the `zuke` it
 * starts does not refuse that root at the trust gate: the caller named the
 * project by running the launcher inside it.
 */
export const LAUNCHER_ROOT_ENV = "ZUKE_LAUNCHER_ROOT";

/** Where a forwarded command runs, and how. */
export interface BuildLocation {
  /** The absolute repository root: the directory holding `zuke.json`. */
  root: string;
  /** Whether a `deno.lock` sits at the root, so the run passes `--frozen`. */
  frozen: boolean;
  /**
   * The absolute path of the executable `zuke` launcher at the root, run in
   * place of `deno run` — or `null` when there is none, or the platform
   * reports no file mode to tell (Windows).
   */
  launcher: string | null;
  /**
   * The build file's name: the one the root's `zuke.json` names in its
   * `build` field, `zuke.ts` when it names none.
   */
  build: string;
  /**
   * The `@zuke/engine` release that runs the build when the root has no
   * build file: the `engine` field of its `zuke.json`, which then describes a
   * build another SDK hosts. `null` when the root has its own build file.
   */
  engine: string | null;
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
  /** The path with every link resolved. */
  realPath(path: string): Promise<string>;
  /**
   * The target a symlink names, exactly as written in the link (possibly
   * relative to the link's directory), or `null` when `path` is not a link.
   */
  readLink(path: string): Promise<string | null>;
  /** The current user's numeric id, or `null` where the platform has none. */
  uid(): number | null;
  /** The text of a file. */
  readText(path: string): Promise<string>;
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
  realPath(path: string): Promise<string> {
    return Deno.realPath(path);
  },
  async readLink(path: string): Promise<string | null> {
    const info = await Deno.lstat(path);
    return info.isSymlink ? await Deno.readLink(path) : null;
  },
  uid(): number | null {
    return Deno.uid();
  },
  readText(path: string): Promise<string> {
    return Deno.readTextFile(path);
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
const ANCESTOR_CONFIG_FILES = [...DENO_CONFIG_FILES, "package.json"];

/**
 * The files in the root itself that decide what runs: the marker, the default
 * build file, the launcher, the lockfile, and the root's own config. A build
 * file the marker names is judged on top of these, never in place of
 * `zuke.ts`: a launcher written before the marker named one still runs it. Owning the directory
 * is not owning these — a `chown` of the directory alone leaves them as they
 * were. The probe follows links, so a symlinked launcher is judged by the
 * file it points at.
 */
const ROOT_FILES = [
  CONFIG_FILE,
  BUILD_FILE,
  LAUNCHER_FILE,
  LOCK_FILE,
  ...ANCESTOR_CONFIG_FILES,
];

/** The world-writable permission bit. */
const WORLD_WRITABLE = 0o002;

/** The file-type bits of a mode, and the value that marks a regular file. */
const FILE_TYPE = 0o170000;
const REGULAR_FILE = 0o100000;

/** Any of the execute permission bits. */
const EXECUTABLE = 0o111;

/**
 * The root's launcher, resolved through any link, when it is an executable
 * regular file, else `null`. Where the gate is inert (no user id: Windows)
 * there is no launcher either, so nothing runs that the gate did not judge.
 * The file itself was judged with the root's files; a link's target
 * directory is judged here, since whoever can write there can swap the file.
 *
 * @throws {UntrustedBuildError} when the target's directory fails the gate.
 */
async function launcherAt(
  root: AbsolutePath,
  probe: BuildProbe,
): Promise<string | null> {
  const uid = probe.uid();
  if (uid === null) return null;
  const path = root(LAUNCHER_FILE).path;
  const mode = (await probe.ownership(path))?.mode ?? null;
  if (mode === null) return null;
  const runnable = (mode & FILE_TYPE) === REGULAR_FILE &&
    (mode & EXECUTABLE) !== 0;
  if (!runnable) return null;
  // Only the target's own directory, not its ancestors — the root's
  // ancestors are not judged as directories either.
  const real = await probe.realPath(path);
  const home = absolutePath(real).parent();
  assertEntry(await probe.ownership(home.path), home.path, uid, root);
  // Run it by its path under the root, not the resolved one. A launcher finds
  // the project it builds from the path it was called by (`dirname "$0"`), so
  // a `zuke` symlinked to a launcher shared across repos, called by its
  // resolved path, would build the shared launcher's own directory instead.
  const link = await probe.readLink(path);
  if (link === null) return path;
  // Running the link re-resolves it, so it is only the file that was judged
  // if the link is one hop straight to it: re-pointing that hop needs write
  // access to the root, which the gate refuses to anyone but you. A chain
  // through another directory could be re-pointed by whoever writes there,
  // after the check. Rather than judge every hop, a chain gets the launcher's
  // own `deno run` — the right project, and only files the gate judged.
  //
  // A relative link is read against the root's real path, not the root as
  // written: the root's own ancestors are not judged (macOS's `/var` is a link
  // to `/private/var`, so every temp directory is reached through one), while
  // any link inside the target — the hops that matter — still leaves the
  // lexical path short of the real one, and falls back.
  const target = link.startsWith("/")
    ? absolutePath(link)
    : absolutePath(await probe.realPath(root.path))(link);
  return target.path === real ? path : null;
}

/**
 * Refuse an entry owned by someone other than `uid`, or writable by everyone;
 * an absent entry, or a property the platform does not report, passes.
 * `subject` names the entry in the refusal.
 */
function assertEntry(
  own: Ownership | null,
  subject: string,
  uid: number,
  root: AbsolutePath,
): void {
  if (own === null) return;
  if (own.uid !== null && own.uid !== uid) {
    throw new UntrustedBuildError(
      root.path,
      `${subject} is owned by user ${own.uid}, not you (${uid})`,
    );
  }
  if (own.mode !== null && (own.mode & WORLD_WRITABLE) !== 0) {
    throw new UntrustedBuildError(
      root.path,
      `${subject} is writable by everyone`,
    );
  }
}

/**
 * Walk up from `cwd` to the nearest directory holding {@link CONFIG_FILE},
 * asking `probe`. Returns `null` when no ancestor has one — the caller is not
 * inside a Zuke project. A root equal to `vouched`, the directory of the
 * launcher that started this process ({@link LAUNCHER_ROOT_ENV}), is not
 * held to the trust gate.
 *
 * @throws {UntrustedBuildError} when the root found fails the trust gate (see
 *   the module docs).
 */
export async function locateBuild(
  cwd: string,
  probe: BuildProbe,
  vouched: string | undefined = Deno.env.get(LAUNCHER_ROOT_ENV),
): Promise<BuildLocation | null> {
  let dir = absolutePath(cwd);
  while (true) {
    if (await probe.exists(dir(CONFIG_FILE).path)) {
      // The root a launcher started this from was named by running it, and
      // that launcher is the one running, so it is neither judged nor rerun.
      const named = vouched !== undefined && dir.path === vouched;
      if (!named) await assertTrusted(dir, probe);
      // Read only once the marker passed the gate, and then hold the file it
      // names to the same gate: it is the one that runs.
      const build = buildFileNamed(
        await probe.readText(dir(CONFIG_FILE).path),
      );
      const uid = probe.uid();
      if (!named && uid !== null && build !== BUILD_FILE) {
        await assertFilesOwned(dir, [build], uid, probe, dir);
      }
      return {
        root: dir.path,
        build,
        frozen: await probe.exists(dir(LOCK_FILE).path),
        launcher: named ? null : await launcherAt(dir, probe),
        engine: await probe.exists(dir(build).path)
          ? null
          : await hostedEngine(dir, build, probe),
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
  assertEntry(await probe.ownership(root.path), "the directory", uid, root);
  await assertFilesOwned(root, ROOT_FILES, uid, probe, root);
  for (let dir = root; !dir.isRoot;) {
    dir = dir.parent();
    await assertFilesOwned(dir, ANCESTOR_CONFIG_FILES, uid, probe, root);
  }
}

/**
 * Refuse when any of `names` in `dir` exists and is owned by someone other
 * than `uid` or writable by everyone — see {@link assertEntry}.
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
    assertEntry(await probe.ownership(file), file, uid, root);
  }
}

/** The field of `zuke.json` naming the `@zuke/engine` release that runs a build with no `zuke.ts`. */
export const ENGINE_FIELD = "engine";

/** One exact release, since a range would float the engine between runs. */
const ENGINE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

/**
 * The `engine` a root with no build file pins: such a root holds a build
 * another SDK hosts, and nothing could run it without one — in particular
 * not Deno, which a hosted build never needs.
 * @throws when `zuke.json` names none, or names one that is not exact.
 */
async function hostedEngine(
  root: AbsolutePath,
  build: string,
  probe: BuildProbe,
): Promise<string> {
  const engine = await engineVersion(root, probe);
  if (engine === null) {
    throw new Error(
      `zuke: ${root.path} has no ${build}, and its ${CONFIG_FILE} ` +
        `names no '${ENGINE_FIELD}' release to run its 'sdk' build with`,
    );
  }
  return engine;
}

/** The refusal of an `engine` value that is not an exact version. */
function badEngineNotice(value: string): string {
  return `zuke: zuke.json names '${ENGINE_FIELD}': '${value}', which is not ` +
    `an exact version like 1.2.3`;
}

/**
 * The `engine` field of the root's `zuke.json`: the `@zuke/engine` release
 * that runs a build with no `zuke.ts`, or `null` when the file names none.
 *
 * @throws when the file is not JSON or the version is not exact, saying which.
 */
async function engineVersion(
  root: AbsolutePath,
  probe: BuildProbe,
): Promise<string | null> {
  const path = root(CONFIG_FILE).path;
  let config: unknown;
  try {
    config = JSON.parse(await probe.readText(path));
  } catch (error) {
    throw new Error(
      `zuke: ${path} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const engine = typeof config === "object" && config !== null &&
      ENGINE_FIELD in config
    ? config[ENGINE_FIELD]
    : undefined;
  if (typeof engine !== "string" || engine === "") return null;
  if (!ENGINE_VERSION.test(engine)) throw new Error(badEngineNotice(engine));
  return engine;
}

/**
 * The build `location` runs, as the CLI names it to a person: the root's
 * `zuke.ts`, or for a build another SDK hosts its `zuke.json` and the engine
 * that runs it: the binary's own `engine` when it serves the pin, else the
 * release the file pins.
 */
export function buildLabel(
  location: BuildLocation,
  engine?: EmbeddedEngine,
): string {
  if (location.engine === null) return `${location.root}/${location.build}`;
  const serving = servingEngine(location, engine);
  return `${location.root}/${CONFIG_FILE}, on ${
    serving === undefined
      ? `@zuke/engine ${location.engine}`
      : `the built-in @zuke/engine ${serving.version}`
  }`;
}

/** The module that runs a build another SDK hosts: `@zuke/engine` at `version`. */
export function engineSpecifier(version: string): string {
  return `jsr:@zuke/engine@${version}`;
}

/** What a forwarded command runs: the build file, or the engine release for a root without one. */
function buildModule(location: BuildLocation): string {
  return location.engine === null
    ? location.build
    : engineSpecifier(location.engine);
}

/**
 * The `deno` argv for a forwarded command — the launchers' invocation, with
 * `--frozen` only when the location has a lockfile to verify against. Pure.
 */
export function buildRunArgs(
  location: BuildLocation,
  args: string[],
): string[] {
  // Deno finds a lock only beside a Deno config, which a hosted build has no
  // reason to keep, so the engine route names it; the build file's lock sits
  // beside its config as always.
  const lock = location.engine === null ? [] : [`--lock=${LOCK_FILE}`];
  return [
    "run",
    "-A",
    ...(location.frozen ? [...lock, "--frozen"] : []),
    buildModule(location),
    ...args,
  ];
}

/**
 * The binary's `engine`, when it is the one to run `location`: a hosted build
 * whose pinned release it serves. `undefined` for a `zuke.ts` build, for a
 * run without an embedded engine, and for a pin it cannot serve.
 */
export function servingEngine(
  location: BuildLocation,
  engine: EmbeddedEngine | undefined,
): EmbeddedEngine | undefined {
  return location.engine !== null && engine?.serves(location.engine)
    ? engine
    : undefined;
}

/** Whether a forwarded command goes to the root's launcher rather than running here. */
function viaLauncher(location: BuildLocation): boolean {
  return location.launcher !== null && Deno.env.get(FORWARDED_ENV) !== "1";
}

/**
 * Run a forwarded command through `runner`. A hosted build whose pin the
 * binary's own `engine` serves runs on it: the binary again, in engine mode,
 * with `args` as they are, launcher or not. Otherwise the root's launcher with
 * `args` when it has one and this is not already a launcher's own `zuke` call
 * (see {@link FORWARDED_ENV}), else Deno with {@link buildRunArgs} — except a
 * hosted build in the binary, which never falls back to Deno: a project
 * another SDK hosts needs nothing from Deno's stack.
 * @throws {Error} for a hosted build the binary cannot serve and no launcher
 * can run, naming how to get a zuke that does.
 */
export function runBuild(
  runner: BuildRunner,
  location: BuildLocation,
  args: string[],
  env?: Readonly<Record<string, string>>,
  engine?: EmbeddedEngine,
): Promise<number> {
  const serving = servingEngine(location, engine);
  if (serving !== undefined) {
    return runner(location.root, args, serving.program, {
      ...env,
      [EMBEDDED_ENGINE_ENV]: "1",
    });
  }
  if (location.launcher !== null && viaLauncher(location)) {
    return runner(location.root, args, location.launcher, env);
  }
  if (engine !== undefined && location.engine !== null) {
    throw new Error(
      `zuke: this zuke's built-in @zuke/engine ${engine.version} cannot run ` +
        `${CONFIG_FILE}'s ${location.engine}. Install a zuke release that ` +
        `carries it (${BINARY_INSTALL_DOCS}), run the project's download ` +
        "launcher (./zuke, or .\\zuke.ps1 on Windows), which fetches the " +
        "release it pins, or move the project with `zuke upgrade --engine`.",
    );
  }
  return runner(location.root, buildRunArgs(location, args), undefined, env);
}

/**
 * The stderr line for a hosted build the binary's own `engine` cannot serve,
 * which then goes to the project's launcher; `undefined` when there is
 * nothing to say: no engine compiled in, a `zuke.ts` build, a pin it serves,
 * or no launcher to go to, which {@link runBuild} refuses instead.
 */
export function embeddedEngineNotice(
  location: BuildLocation,
  engine: EmbeddedEngine | undefined,
): string | undefined {
  if (
    engine === undefined || location.engine === null ||
    servingEngine(location, engine) !== undefined || !viaLauncher(location)
  ) {
    return undefined;
  }
  return `zuke: this zuke's built-in @zuke/engine ${engine.version} cannot ` +
    `run ${CONFIG_FILE}'s ${location.engine}, so the project's launcher ` +
    "runs it";
}

/** The launchers' notice for a run without a lockfile, verbatim. */
export const NO_LOCK_NOTICE: string = noLockNotice("—");

/**
 * The stderr line naming the build a forwarded command runs, printed when
 * that build is not in the working directory — so a run that discovery chose
 * is never silent about what it chose.
 */
export function runningNotice(
  location: BuildLocation,
  engine?: EmbeddedEngine,
): string {
  if (location.engine === null) {
    return `zuke: running ${location.root}/${location.build}`;
  }
  const serving = servingEngine(location, engine);
  return `zuke: running ${location.root}/${CONFIG_FILE} with ${
    serving === undefined
      ? buildModule(location)
      : `the built-in @zuke/engine ${serving.version}`
  }`;
}

/**
 * Runs `program <args>` from `root` — Deno when `program` is omitted, else the
 * project's launcher at that path — and resolves to its exit code: the
 * injectable subprocess seam, so the forwarding is testable without a build.
 * `env` adds variables to the environment the child inherits.
 */
export type BuildRunner = (
  root: string,
  args: string[],
  program?: string,
  env?: Readonly<Record<string, string>>,
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
 * The default {@link BuildRunner}: spawn the launcher as-is, since choosing a
 * Deno is its job, or else Deno — {@link spawnDeno} finds it, and puts it
 * first on the child's `PATH` as the launchers do. Stdio is inherited, because
 * `zuke mcp` speaks JSON-RPC over the same stdin/stdout and a build may
 * prompt. For the build's lifetime the parent handles signals as
 * {@link signalPlan} says, so an interrupted build is never orphaned with its
 * exit code lost.
 */
export const defaultBuildRunner: BuildRunner = async (
  root,
  args,
  program,
  env,
): Promise<number> => {
  const options: Deno.CommandOptions = {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  };
  const child = program === undefined
    ? spawnDeno(args, { ...options, env })
    : new Deno.Command(program, {
      ...options,
      args,
      env: { ...env, ...QUIET_DENO_ENV, [FORWARDED_ENV]: "1" },
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
