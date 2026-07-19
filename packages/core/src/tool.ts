/**
 * `ToolTasks` and `toolchain()` — provision the external CLIs a build drives,
 * in Zuke's fluent settings-lambda style. A build fetches the tools it needs
 * (pinned, checksum-verified, cached) instead of assuming they're on `PATH`, so
 * it fully describes its own environment.
 *
 * Configure a tool with the same `(s) => s.method(...)` lambda the tool wrappers
 * use. {@link ToolTasks.install} fetches one tool; {@link toolchain} declares a
 * whole set as a build field and {@link Toolchain.install} fetches them all.
 * Each returns the installed binary's {@link AbsolutePath}, ready for a
 * wrapper's `.toolPath(...)`.
 *
 * ```ts
 * import { Build, target, toolchain, ToolTasks } from "jsr:@zuke/core";
 * import { HelmTasks } from "jsr:@zuke/helm";
 *
 * class Deploy extends Build {
 *   tools = toolchain((t) =>
 *     t.tool((s) =>
 *       s.name("helm").archive("tar.gz").binaryPath("linux-amd64/helm")
 *         .checksum(helmSha).url(({ arch }) => helmUrl(arch))
 *     )
 *   );
 *
 *   deploy = target().executes(async () => {
 *     const bin = await this.tools.install();
 *     await HelmTasks.version((s) => s.toolPath(bin.get("helm")));
 *     // …or a one-off:
 *     const kubectl = await ToolTasks.install((s) => s.name("kubectl").url(kubectlUrl));
 *   });
 * }
 * ```
 *
 * @module
 */

import type { AbsolutePath, PathLike } from "./path.ts";
import {
  type DownloadFn,
  type InstallPlatform,
  installRelease,
  type InstallReleaseOptions,
  type Platform,
} from "./install.ts";
import {
  installNpmTool,
  type InstallNpmToolOptions,
  type NpmRunner,
  type NpmToolSpec,
} from "./npm_tool.ts";
import type { Configure } from "./tooling.ts";

/** The default directory a {@link Toolchain} (and {@link ToolTasks}) installs into. */
export const DEFAULT_TOOLS_DIR = ".zuke/tools";

/**
 * Fluent settings for installing a release tool. Configure it in a
 * settings-lambda (`(s) => s.name(...).url(...)`), the same shape as Zuke's tool
 * wrappers. `name` and `url` are required; everything else is optional and
 * mirrors {@link InstallReleaseOptions}.
 */
export class ToolInstallSettings {
  /** The tool name, and the installed filename. Set by {@link name}. */
  name_?: string;
  /** Resolves the per-platform download URL. Set by {@link url}. */
  url_?: (platform: Platform) => string;
  /** Install directory (overrides the toolchain's). Set by {@link destDir}. */
  destDir_?: PathLike;
  /** Download format. Set by {@link archive}. */
  archive_?: "raw" | "tar.gz" | "zip";
  /** The binary's path within a `tar.gz`. Set by {@link binaryPath}. */
  binaryPath_?: string;
  /** Expected SHA-256 (or a per-platform resolver). Set by {@link checksum}. */
  checksum_?: string | ((platform: Platform) => string);
  /** The platform to resolve for. Set by {@link platform}. */
  platform_?: InstallPlatform;
  /** The download implementation. Set by {@link download}. */
  download_?: DownloadFn;

  /** The tool name; also the installed binary's filename (`.exe` on Windows). */
  name(name: string): this {
    this.name_ = name;
    return this;
  }

  /** Resolve the download URL for the target {@link Platform}. */
  url(resolve: (platform: Platform) => string): this {
    this.url_ = resolve;
    return this;
  }

  /** The directory to install the binary into (created if missing). */
  destDir(dir: PathLike): this {
    this.destDir_ = dir;
    return this;
  }

  /**
   * Treat the download as a `"tar.gz"` or `"zip"` to unpack (default `"raw"`,
   * the bare binary). Pair with {@link binaryPath} for the binary inside.
   */
  archive(format: "raw" | "tar.gz" | "zip"): this {
    this.archive_ = format;
    return this;
  }

  /** For an archive, the binary's path within it (defaults to the name). */
  binaryPath(path: string): this {
    this.binaryPath_ = path;
    return this;
  }

  /**
   * The expected SHA-256 (hex) of the downloaded artifact — verifies and caches
   * the install. Pass a `({ os, arch }) => string` resolver to pin it per
   * platform (see {@link InstallReleaseOptions.checksum}).
   */
  checksum(sha256: string | ((platform: Platform) => string)): this {
    this.checksum_ = sha256;
    return this;
  }

  /** Resolve for a specific platform instead of the host (a foreign install). */
  platform(platform: InstallPlatform): this {
    this.platform_ = platform;
    return this;
  }

  /** Override the downloader (defaults to an HTTPS download; a test seam). */
  download(fn: DownloadFn): this {
    this.download_ = fn;
    return this;
  }

  /**
   * Build the {@link InstallReleaseOptions}, using `fallbackDestDir` when no
   * {@link destDir} was set. Throws if a required field is missing.
   */
  options_(fallbackDestDir: PathLike): InstallReleaseOptions {
    if (this.name_ === undefined) {
      throw new Error("a tool install requires .name(...).");
    }
    if (this.url_ === undefined) {
      throw new Error(`tool "${this.name_}" requires .url(...).`);
    }
    return {
      name: this.name_,
      url: this.url_,
      destDir: this.destDir_ ?? fallbackDestDir,
      archive: this.archive_,
      binaryPath: this.binaryPath_,
      checksum: this.checksum_,
      platform: this.platform_,
      download: this.download_,
    };
  }
}

/** The task surface of {@link ToolTasks}. */
export interface ToolTasksApi {
  /**
   * Install a single release tool, configured through a
   * {@link ToolInstallSettings} lambda, and resolve to its installed path.
   * Defaults the install directory to `.zuke/tools`.
   */
  install(
    configure: Configure<ToolInstallSettings>,
  ): Promise<AbsolutePath>;
  /**
   * Provision a single npm-registry package as a version-pinned, cached tool and
   * resolve to its installed bin path. Defaults the install root to
   * `.zuke/tools`. See {@link installNpmTool}; group several with
   * {@link Toolchain.npm}.
   */
  npm(
    spec: NpmToolSpec,
    options?: InstallNpmToolOptions,
  ): Promise<AbsolutePath>;
}

/**
 * Provision external CLIs from a build. `ToolTasks.install((s) => …)` fetches a
 * single release binary and `ToolTasks.npm(...)` a single npm package; group
 * several of either with {@link toolchain}.
 */
export const ToolTasks: ToolTasksApi = {
  install(configure) {
    const settings = configure(new ToolInstallSettings());
    return installRelease(settings.options_(DEFAULT_TOOLS_DIR));
  },
  npm(spec, options) {
    return installNpmTool(spec, options);
  },
};

/** Options for {@link Toolchain.install}. */
export interface ToolchainInstallOptions {
  /** Where tools without their own `destDir` install. Defaults to `.zuke/tools`. */
  destDir?: PathLike;
  /** The download implementation for every release tool (defaults per {@link installRelease}). */
  download?: DownloadFn;
  /** The npm-install runner for npm-package tools (defaults to the ambient `npm`; a test seam). */
  npmRun?: NpmRunner;
}

/**
 * A declared set of external tools. Add tools with {@link Toolchain.tool} (a
 * {@link ToolInstallSettings} lambda) and fetch them all with
 * {@link Toolchain.install}. Build one with {@link toolchain}.
 */
export class Toolchain {
  readonly #tools: ToolInstallSettings[] = [];
  readonly #npmTools: NpmToolSpec[] = [];

  /** Add a release tool, configured through a settings-lambda. Chainable. */
  tool(configure: Configure<ToolInstallSettings>): this {
    this.#tools.push(configure(new ToolInstallSettings()));
    return this;
  }

  /**
   * Add an npm-registry package to provision as a version-pinned tool —
   * installed under `<destDir>/npm/<name>@<version>` and keyed in
   * {@link install}'s result by its {@link NpmToolSpec.name}. See
   * {@link installNpmTool}. Chainable.
   */
  npm(spec: NpmToolSpec): this {
    this.#npmTools.push(spec);
    return this;
  }

  /** The configured release tools, in declaration order. */
  get tools(): readonly ToolInstallSettings[] {
    return this.#tools;
  }

  /** The configured npm-package tools, in declaration order. */
  get npmTools(): readonly NpmToolSpec[] {
    return this.#npmTools;
  }

  /**
   * Install every declared tool concurrently — reusing a cached copy where a
   * release tool's pinned checksum, or an npm tool's `name@version` marker,
   * matches — and return a map of tool name to installed {@link AbsolutePath}.
   */
  async install(
    options: ToolchainInstallOptions = {},
  ): Promise<Map<string, AbsolutePath>> {
    const destDir = options.destDir ?? DEFAULT_TOOLS_DIR;
    const installed = new Map<string, AbsolutePath>();
    await Promise.all([
      ...this.#tools.map(async (settings) => {
        const spec = settings.options_(destDir);
        const path = await installRelease(
          options.download === undefined
            ? spec
            : { ...spec, download: options.download },
        );
        installed.set(spec.name, path);
      }),
      ...this.#npmTools.map(async (spec) => {
        const path = await installNpmTool(spec, {
          destDir,
          run: options.npmRun,
        });
        installed.set(spec.name, path);
      }),
    ]);
    return installed;
  }
}

/**
 * Create a {@link Toolchain}. Configure it inline with a callback, or chain
 * {@link Toolchain.tool} on the returned instance.
 *
 * ```ts
 * const tools = toolchain((t) =>
 *   t.tool((s) => s.name("helm").url(helmUrl))
 *    .tool((s) => s.name("kubectl").url(kubectlUrl))
 * );
 * ```
 */
export function toolchain(configure?: (t: Toolchain) => void): Toolchain {
  const chain = new Toolchain();
  configure?.(chain);
  return chain;
}
