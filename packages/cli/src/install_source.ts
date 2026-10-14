// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * How the running `zuke` was installed.
 *
 * The CLI ships two ways: from JSR with `deno install -g`, and as a
 * `deno compile` binary, which Homebrew and Chocolatey install from the
 * release archives.
 * One machine can hold both, so `zuke --version` says which one answered and
 * `zuke upgrade` refuses to reinstall from JSR when that is not where the
 * running executable came from.
 *
 * The main module cannot tell the two apart. A binary compiled from
 * `jsr:@zuke/cli` keeps reporting that specifier as `Deno.mainModule`, so a
 * check on the specifier alone mistakes the Homebrew binary for the JSR
 * install. Whether this process is a compiled binary is asked first, and only
 * a process running under Deno itself is classified by its main module.
 *
 * A Homebrew binary and one downloaded from the release page are the same
 * bytes, so only where the executable lives separates them: Homebrew keeps
 * every formula under `<prefix>/Cellar/<formula>/<version>/`, and links it
 * onto `PATH` from there. Chocolatey unpacks the package into
 * `<ChocolateyInstall>\lib\<id>\tools\`, and its shim on `PATH` runs the
 * executable from there, so that is the path the binary reports. The link is resolved before the path is read, which
 * in a compiled binary needs read permission: the release binaries are
 * compiled with `-A`, as the JSR install runs with it. Without it the path is
 * the one the OS reported — already resolved on Linux, possibly the link on
 * macOS, where a Homebrew install would then read as a plain binary.
 *
 * @module
 */

// cspell:ignore linuxbrew

/** The JSR package the global command is installed from. */
export const JSR_PACKAGE = "jsr:@zuke/cli";

/** The formula name the tap installs the binary under. */
const FORMULA = "zuke";

/**
 * A Homebrew-installed executable: `<prefix>/Cellar/zuke/<version>/bin/zuke`.
 * Only the tail is matched, since the prefix differs by platform
 * (`/opt/homebrew`, `/usr/local`, `/home/linuxbrew/.linuxbrew`).
 */
const CELLAR_BINARY = new RegExp(`/Cellar/${FORMULA}/[^/]+/bin/${FORMULA}$`);

/**
 * A Chocolatey-installed executable: `<ChocolateyInstall>\lib\zuke\tools\zuke.exe`.
 * Only the tail is matched, since `ChocolateyInstall` can be moved, and
 * without regard to case, since Windows paths have none.
 */
const CHOCOLATEY_BINARY = new RegExp(
  `[\\\\/]lib[\\\\/]${FORMULA}[\\\\/]tools[\\\\/]${FORMULA}\\.exe$`,
  "i",
);

/**
 * Where the running CLI came from:
 * - `jsr`: `deno install -g` of {@link JSR_PACKAGE};
 * - `homebrew`: the compiled binary, installed by Homebrew;
 * - `chocolatey`: the compiled binary, installed by Chocolatey;
 * - `binary`: the compiled binary, installed any other way;
 * - `source`: run under Deno from anything but JSR, e.g. a checkout.
 */
export type InstallKind =
  | "jsr"
  | "homebrew"
  | "chocolatey"
  | "binary"
  | "source";

/** The install the running CLI came from, and where it lives. */
export interface InstallSource {
  /** How it was installed. */
  readonly kind: InstallKind;
  /**
   * The module specifier for `jsr` and `source`, the resolved executable
   * path for the compiled binary's kinds.
   */
  readonly location: string;
}

/**
 * The process facts {@link installSource} reads, injectable so each install
 * kind is testable from a single process.
 */
export interface InstallHost {
  /** Whether this process is a `deno compile` binary (`Deno.build.standalone`). */
  standalone(): boolean;
  /**
   * The running CLI's main module (`Deno.mainModule`). Deno reports a JSR
   * program by its specifier, `jsr:@zuke/cli` or `jsr:@zuke/cli@<version>`.
   */
  mainModule(): string;
  /** The running executable's path (`Deno.execPath()`). */
  execPath(): string;
  /** `path` with every symbolic link resolved (`Deno.realPath`). */
  realPath(path: string): Promise<string>;
}

/** Whether `main` is the JSR package, with or without a version. */
export function isJsrModule(main: string): boolean {
  return main === JSR_PACKAGE || main.startsWith(`${JSR_PACKAGE}@`);
}

/** Classify the running CLI's install. */
export async function installSource(host: InstallHost): Promise<InstallSource> {
  if (host.standalone()) {
    let path = host.execPath();
    try {
      path = await host.realPath(path);
    } catch {
      // Unresolvable: the path as the OS reported it is still the best answer.
    }
    const kind = CELLAR_BINARY.test(path)
      ? "homebrew"
      : CHOCOLATEY_BINARY.test(path)
      ? "chocolatey"
      : "binary";
    return { kind, location: path };
  }
  const main = host.mainModule();
  return { kind: isJsrModule(main) ? "jsr" : "source", location: main };
}

/** The name each install kind is shown under. */
const KIND_LABELS: Readonly<Record<InstallKind, string>> = {
  jsr: "JSR",
  homebrew: "Homebrew",
  chocolatey: "Chocolatey",
  binary: "standalone binary",
  source: "source",
};

/**
 * One line naming the install, for `zuke --version`:
 * `Homebrew (/opt/homebrew/Cellar/zuke/1.14.0/bin/zuke)`. `display` shortens
 * a path for display (the home directory as `~`); a module specifier is shown
 * as it is.
 */
export function installLabel(
  source: InstallSource,
  display: (path: string) => string,
): string {
  const where = source.kind === "jsr" || source.kind === "source"
    ? source.location
    : display(source.location);
  return `${KIND_LABELS[source.kind]} (${where})`;
}
