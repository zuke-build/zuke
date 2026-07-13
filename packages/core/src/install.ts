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

/** Hex SHA-256 of raw bytes, via the built-in Web Crypto API (no dependency). */
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Read a file's bytes, or `null` when it does not exist. */
async function readFileOrNull(path: string): Promise<Uint8Array | null> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

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
  /**
   * The expected **SHA-256** (hex) of the downloaded artifact — the `.tar.gz`
   * for an archive, or the binary itself for a `"raw"` download; this is what
   * release pages publish as the checksum. When set, the download is verified
   * against it (a mismatch throws and nothing is installed) and the checksum
   * doubles as a **cache key**: a prior install whose recorded checksum matches
   * is reused without downloading again. Omit it and the tool is downloaded
   * every time and not verified.
   *
   * Because {@link url} resolves a different artifact per platform, each has its
   * own hash — so pass a resolver `({ os, arch }) => string` (like `url`) to pin
   * a checksum per platform, or a plain string when a single artifact is
   * installed.
   */
  checksum?: string | ((platform: InstallPlatform) => string);
}

/** The marker file recording the verified checksum of an installed tool. */
function markerPath(target: AbsolutePath): string {
  return `${String(target)}.sha256`;
}

/**
 * Whether `target` is already installed and verified against `checksum`: the
 * binary exists and the sidecar marker records the same checksum.
 */
async function cachedInstall(
  target: AbsolutePath,
  checksum: string,
): Promise<boolean> {
  const recorded = await readFileOrNull(markerPath(target));
  if (recorded === null) return false;
  if (new TextDecoder().decode(recorded).trim() !== checksum) return false;
  return await readFileOrNull(String(target)) !== null;
}

/** Resolve the expected checksum for `platform` (a literal or a resolver), lowercased. */
function resolveChecksum(
  checksum: InstallReleaseOptions["checksum"],
  platform: InstallPlatform,
): string | undefined {
  if (checksum === undefined) return undefined;
  const value = typeof checksum === "function" ? checksum(platform) : checksum;
  return value.toLowerCase();
}

/** Verify `bytes` hash to `checksum`, throwing a descriptive error otherwise. */
async function verifyChecksum(
  name: string,
  bytes: Uint8Array,
  checksum: string,
): Promise<void> {
  const actual = await sha256(bytes);
  if (actual !== checksum) {
    throw new Error(
      `checksum mismatch for "${name}": expected ${checksum}, got ${actual}. ` +
        `The download may be corrupt or tampered with; nothing was installed.`,
    );
  }
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
 *
 * With a {@link InstallReleaseOptions.checksum}, the download is verified before
 * anything is installed, and a matching prior install is reused without
 * downloading again — so pinning a checksum makes the install both **hermetic**
 * (tamper-evident) and **cached**.
 */
export async function installRelease(
  options: InstallReleaseOptions,
): Promise<AbsolutePath> {
  const platform = options.platform ?? hostPlatform();
  const download = options.download ?? httpDownload;
  const checksum = resolveChecksum(options.checksum, platform);

  const dir = resolveDir(String(options.destDir));
  const onWindows = platform.os === "windows";
  const fileName = onWindows && !options.name.endsWith(".exe")
    ? `${options.name}.exe`
    : options.name;
  const target = dir(fileName);

  // Cache hit: a prior install verified against the same checksum is reused.
  if (checksum !== undefined && await cachedInstall(target, checksum)) {
    return target;
  }

  const url = options.url(platform);
  await Deno.mkdir(String(dir), { recursive: true });

  if ((options.archive ?? "raw") === "tar.gz") {
    const scratch = await Deno.makeTempDir();
    try {
      const archivePath = `${scratch}/download.tar.gz`;
      await download(url, archivePath);
      if (checksum !== undefined) {
        await verifyChecksum(
          options.name,
          await Deno.readFile(archivePath),
          checksum,
        );
      }
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
    if (checksum !== undefined) {
      try {
        await verifyChecksum(
          options.name,
          await Deno.readFile(String(target)),
          checksum,
        );
      } catch (error) {
        // Don't leave an unverified binary on disk to be picked up later.
        await Deno.remove(String(target)).catch(() => {});
        throw error;
      }
    }
  }

  if (!onWindows) await Deno.chmod(String(target), 0o755);
  // Record the verified checksum so a later run can skip the download.
  if (checksum !== undefined) {
    await Deno.writeTextFile(markerPath(target), `${checksum}\n`);
  }
  return target;
}
