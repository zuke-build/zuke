/**
 * Install a CLI from a release download so a build can prepare its own
 * environment — fetch the binary one of Zuke's tool wrappers drives, then point
 * the wrapper at it with `.toolPath(...)`.
 *
 * {@link installRelease} resolves a per-platform URL, downloads it (reusing
 * {@link httpDownload}), unpacks a `.tar.gz` (reusing {@link extractTarGzip}) or
 * takes a raw single binary, drops it into a directory, marks it executable, and
 * returns its {@link AbsolutePath}.
 *
 * ```ts
 * import { installRelease } from "jsr:@zuke/core";
 * import { CmdTasks } from "jsr:@zuke/cmd";
 *
 * const bin = await installRelease({
 *   name: "helm",
 *   destDir: ".zuke/bin",
 *   archive: "tar.gz",
 *   binaryPath: "linux-amd64/helm",
 *   url: ({ os, arch }) =>
 *     `https://get.helm.sh/helm-v3.14.0-${os}-${
 *       arch === "aarch64" ? "arm64" : "amd64"
 *     }.tar.gz`,
 * });
 * await CmdTasks.exec(String(bin), (s) => s.args("version"));
 * ```
 *
 * Zip archives are not yet supported (only raw binaries and `.tar.gz`), so this
 * targets the Unix CI runners where most release tarballs are published.
 *
 * @module
 */

import { httpDownload } from "./http.ts";
import { extractTarGzip } from "./compression.ts";
import { type AbsolutePath, absolutePath, type PathLike } from "./path.ts";

/** The host identity used to resolve a platform-specific download URL. */
export interface InstallPlatform {
  /** The operating system, as reported by `Deno.build.os`. */
  os: typeof Deno.build.os;
  /** The CPU architecture, as reported by `Deno.build.arch`. */
  arch: typeof Deno.build.arch;
}

/** The current host's {@link InstallPlatform} (from `Deno.build`). */
export function hostPlatform(): InstallPlatform {
  return { os: Deno.build.os, arch: Deno.build.arch };
}

/** A download function: fetch `url` into the file at `dest`. */
export type DownloadFn = (url: string, dest: PathLike) => Promise<void>;

/** Options for {@link installRelease}. */
export interface InstallReleaseOptions {
  /** The tool name; also the installed binary's filename (`.exe` on Windows). */
  name: string;
  /** Resolve the download URL for the target {@link InstallPlatform}. */
  url: (platform: InstallPlatform) => string;
  /** The directory to install the binary into (created if missing). */
  destDir: PathLike;
  /**
   * The download format. `"raw"` (default) treats the download as the binary
   * itself; `"tar.gz"` unpacks it and takes {@link binaryPath} from inside.
   */
  archive?: "raw" | "tar.gz";
  /**
   * For a `"tar.gz"` archive, the binary's path within the archive. Defaults to
   * {@link name}.
   */
  binaryPath?: string;
  /**
   * The platform to resolve the URL for. Defaults to {@link hostPlatform}.
   * Override it to install a foreign binary or to unit-test URL resolution.
   */
  platform?: InstallPlatform;
  /**
   * The download implementation. Defaults to {@link httpDownload}; override it
   * to unit-test without network access.
   */
  download?: DownloadFn;
}

/** Resolve a possibly-relative directory to an absolute path (against `cwd`). */
function resolveDir(dir: string): AbsolutePath {
  const slashed = dir.replace(/\\/g, "/");
  const isAbsolute = slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed);
  return absolutePath(isAbsolute ? slashed : `${Deno.cwd()}/${slashed}`);
}

/**
 * Download and install a release binary, returning its {@link AbsolutePath}.
 * The path is ready to hand to a wrapper's `.toolPath(...)` (or `CmdTasks`).
 */
export async function installRelease(
  options: InstallReleaseOptions,
): Promise<AbsolutePath> {
  const platform = options.platform ?? hostPlatform();
  const download = options.download ?? httpDownload;
  const url = options.url(platform);

  const dir = resolveDir(String(options.destDir));
  await Deno.mkdir(String(dir), { recursive: true });

  const onWindows = platform.os === "windows";
  const fileName = onWindows && !options.name.endsWith(".exe")
    ? `${options.name}.exe`
    : options.name;
  const target = dir(fileName);

  if ((options.archive ?? "raw") === "tar.gz") {
    const scratch = await Deno.makeTempDir();
    try {
      const archivePath = `${scratch}/download.tar.gz`;
      await download(url, archivePath);
      const unpacked = `${scratch}/unpacked`;
      await extractTarGzip(archivePath, unpacked);
      await Deno.copyFile(
        `${unpacked}/${options.binaryPath ?? options.name}`,
        String(target),
      );
    } finally {
      await Deno.remove(scratch, { recursive: true });
    }
  } else {
    await download(url, target);
  }

  if (!onWindows) await Deno.chmod(String(target), 0o755);
  return target;
}
