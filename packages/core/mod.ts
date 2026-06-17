/**
 * Zuke — a code-first, strongly-typed build automation system for Deno.
 *
 * Public API. Define a build by extending {@link Build}, declare targets with
 * the {@link target} fluent builder, and make the file runnable with
 * {@link run}:
 *
 * ```ts
 * import { Build, target, run } from "jsr:@zuke/core";
 * import { $ } from "jsr:@zuke/core/shell";
 *
 * class MyBuild extends Build {
 *   test = target()
 *     .description("Run the test suite")
 *     .executes(async () => { await $`deno test -A`; });
 * }
 *
 * if (import.meta.main) { await run(MyBuild); }
 * ```
 *
 * The shell helper `$` lives in the `./shell` submodule
 * (`jsr:@zuke/core/shell`).
 *
 * @module
 */

export {
  Build,
  type BuildResult,
  discoverGroups,
  discoverTargets,
  type TargetStatus,
} from "./src/build.ts";
export { ciHost, isCI } from "./src/host.ts";
export {
  type Condition,
  Group,
  group,
  type Target,
  target,
  TargetBuilder,
  type TargetFn,
} from "./src/target.ts";
export { run } from "./src/cli.ts";
export { execute, type ExecuteOptions, type Reporter } from "./src/executor.ts";
export type { BuildCache } from "./src/cache.ts";
export { type AbsolutePath, absolutePath, type PathLike } from "./src/path.ts";
export { CONFIG_FILE, repoRoot } from "./src/config.ts";
export {
  type AnyParameter,
  discoverParameters,
  Parameter,
  parameter,
  ParameterError,
  type ParamValue,
} from "./src/params.ts";
export {
  executionSet,
  findCycle,
  GraphError,
  plan,
  validateGraph,
} from "./src/graph.ts";
export { glob, type GlobOptions, globToRegExp } from "./src/glob.ts";
export {
  assert,
  assertDirectoryExists,
  assertExists,
  assertFileExists,
  AssertionError,
  fail,
} from "./src/assert.ts";
export {
  httpDownload,
  HttpError,
  httpJson,
  type HttpOptions,
  httpText,
} from "./src/http.ts";
export {
  createTarGzip,
  extractTarGzip,
  gunzip,
  gzip,
  tar,
  type TarEntry,
  untar,
} from "./src/compression.ts";
export {
  type DownloadFn,
  hostPlatform,
  type InstallPlatform,
  installRelease,
  type InstallReleaseOptions,
} from "./src/install.ts";
