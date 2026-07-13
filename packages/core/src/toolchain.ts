/**
 * Declare a build's external tools in one place and install them together —
 * pinned, checksum-verified, and cached — so the build file fully describes the
 * environment it needs instead of assuming tools are already on `PATH`.
 *
 * A {@link Toolchain} bundles several {@link "./install.ts".installRelease}
 * specs; {@link Toolchain.install} fetches them all (concurrently, reusing any
 * cached copy) and returns each tool's {@link AbsolutePath}, ready to hand to a
 * wrapper's `.toolPath(...)`.
 *
 * ```ts
 * import { Build, target, toolchain } from "jsr:@zuke/core";
 * import { HelmTasks } from "jsr:@zuke/helm";
 *
 * class Deploy extends Build {
 *   tools = toolchain((t) =>
 *     t.tool({
 *       name: "helm",
 *       archive: "tar.gz",
 *       binaryPath: "linux-amd64/helm",
 *       checksum: "f43e1c3…", // pins + verifies + caches
 *       url: ({ arch }) =>
 *         `https://get.helm.sh/helm-v3.15.2-linux-${arch === "aarch64" ? "arm64" : "amd64"}.tar.gz`,
 *     })
 *   );
 *
 *   deploy = target().executes(async () => {
 *     const bin = await this.tools.install();
 *     await HelmTasks.version((s) => s.toolPath(bin.get("helm")));
 *   });
 * }
 * ```
 *
 * @module
 */

import type { AbsolutePath, PathLike } from "./path.ts";
import {
  type DownloadFn,
  installRelease,
  type InstallReleaseOptions,
} from "./install.ts";

/** The default directory a {@link Toolchain} installs tools into. */
export const DEFAULT_TOOLS_DIR = ".zuke/tools";

/**
 * One tool in a {@link Toolchain}: an {@link installRelease} spec whose
 * `destDir` and `download` are supplied by {@link Toolchain.install} (a per-tool
 * `destDir` may still override the toolchain's).
 */
export type ToolSpec =
  & Omit<InstallReleaseOptions, "destDir" | "download">
  & {
    /** Install this tool somewhere other than the toolchain's directory. */
    destDir?: PathLike;
  };

/** Options for {@link Toolchain.install}. */
export interface ToolchainInstallOptions {
  /** Where tools without their own `destDir` are installed. Defaults to `.zuke/tools`. */
  destDir?: PathLike;
  /** The download implementation for every tool (defaults per {@link installRelease}). */
  download?: DownloadFn;
}

/**
 * A declared set of external tools. Add tools with {@link Toolchain.tool} and
 * fetch them all with {@link Toolchain.install}. Build one with {@link toolchain}.
 */
export class Toolchain {
  readonly #tools: ToolSpec[] = [];

  /** Add a tool to the set. Chainable. */
  tool(spec: ToolSpec): this {
    this.#tools.push(spec);
    return this;
  }

  /** The declared tools, in declaration order. */
  get tools(): readonly ToolSpec[] {
    return this.#tools;
  }

  /**
   * Install every declared tool concurrently — reusing a cached copy where a
   * pinned checksum matches — and return a map of tool name to its installed
   * {@link AbsolutePath}.
   */
  async install(
    options: ToolchainInstallOptions = {},
  ): Promise<Map<string, AbsolutePath>> {
    const destDir = options.destDir ?? DEFAULT_TOOLS_DIR;
    const installed = new Map<string, AbsolutePath>();
    await Promise.all(this.#tools.map(async (spec) => {
      const path = await installRelease({
        ...spec,
        destDir: spec.destDir ?? destDir,
        download: options.download,
      });
      installed.set(spec.name, path);
    }));
    return installed;
  }
}

/**
 * Create a {@link Toolchain}. Configure it inline with a callback, or chain
 * {@link Toolchain.tool} on the returned instance.
 *
 * ```ts
 * const tools = toolchain((t) => t.tool(helmSpec).tool(kubectlSpec));
 * ```
 */
export function toolchain(configure?: (t: Toolchain) => void): Toolchain {
  const chain = new Toolchain();
  configure?.(chain);
  return chain;
}
