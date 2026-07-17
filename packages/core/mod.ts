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
 * await run(MyBuild);
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
export {
  type Architecture,
  type CiHost,
  ciHost,
  detectCiHost,
  isCI,
  type OperatingSystem,
  operatingSystem,
} from "./src/host.ts";
export {
  type Condition,
  Group,
  group,
  type JsonValue,
  LockSettings,
  type Remediation,
  type RemediationContext,
  type RemediationResult,
  type Target,
  target,
  TargetBuilder,
  type TargetContext,
  type TargetFn,
  type TargetStateHandle,
  type Validation,
  type ValidationContext,
} from "./src/target.ts";
export { run, type RunOptions } from "./src/cli.ts";
export {
  type CliCommandInfo,
  type CliDescription,
  type CliFlagInfo,
  type CliParameterInfo,
  type CliTargetInfo,
  describeCli,
} from "./src/describe.ts";
export type { Plugin } from "./src/plugin.ts";
export {
  type AffectedOptions,
  affectedTargets,
  type ChangedFilesFn,
  gitChangedFiles,
} from "./src/affected.ts";
export { execute, type ExecuteOptions, type Reporter } from "./src/executor.ts";
export {
  defaultRenderer,
  type Renderer,
  type TargetReport,
} from "./src/renderer.ts";
export type { Style } from "./src/render.ts";
export type { BuildCache, OpenCacheOptions } from "./src/cache.ts";
export {
  archiveOutputs,
  envCacheStore,
  FileSystemCacheStore,
  HttpCacheStore,
  type HttpCacheStoreOptions,
  type OutputHost,
  remoteCacheKey,
  type RemoteCacheStore,
  resolveRemoteStore,
  restoreOutputs,
} from "./src/remote_cache.ts";
export {
  defaultStateHost,
  type LockResult,
  type PutResult,
  type StateHost,
  type StateStore,
} from "./src/state/store.ts";
export {
  LockConflictError,
  type LockHolder,
  lockKey,
} from "./src/state/lock.ts";
export { parseDuration } from "./src/duration.ts";
export {
  type RunGraphNode,
  type RunQuery,
  type RunRecord,
  type RunStatus,
  type RunSummary,
  type TargetRunState,
  type TargetRunStatus,
} from "./src/state/types.ts";
export { FileSystemStateStore } from "./src/state/fs_store.ts";
export {
  HttpStateStore,
  type HttpStateStoreOptions,
} from "./src/state/http_store.ts";
export {
  envStateStore,
  type ResolveStateOptions,
  resolveStateStore,
} from "./src/state/resolve.ts";
export { type AbsolutePath, absolutePath, type PathLike } from "./src/path.ts";
export { CONFIG_FILE, repoRoot } from "./src/config.ts";
export {
  type AnyParameter,
  discoverParameters,
  envVarName,
  Parameter,
  parameter,
  ParameterError,
  type ParamKind,
  type ParamValue,
} from "./src/params.ts";
export {
  execSecret,
  ExecSecretSettings,
  fileSecret,
  FileSecretSettings,
  SecretError,
  type SecretSource,
} from "./src/secret.ts";
export { REDACTED, Redactor } from "./src/redact.ts";
export {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_READY_TIMEOUT_MS,
  type RunningService,
  service,
  ServiceBuilder,
  ServiceError,
  type ServiceHandle,
  ServiceRegistry,
  tcpReachable,
} from "./src/service.ts";
export {
  executionSet,
  findCycle,
  GraphError,
  plan,
  validateGraph,
} from "./src/graph.ts";
export { glob, type GlobOptions, globToRegExp } from "./src/glob.ts";
export {
  type CopyOptions,
  type CreateDirectoryOptions,
  FileTasks,
  type FileTasksApi,
  type RemoveOptions,
} from "./src/file.ts";
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
  AnnounceError,
  type Announcement,
  type AnnouncementField,
  type AnnouncementLevel,
  type AnnouncementLink,
  AnnouncementSettings,
  AnnounceTasks,
  type AnnounceTasksApi,
  DiscordAnnouncementSettings,
  SlackAnnouncementSettings,
  SlackApiError,
  TeamsAnnouncementSettings,
} from "./src/announce.ts";
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
  type Platform,
} from "./src/install.ts";
export {
  DEFAULT_TOOLS_DIR,
  Toolchain,
  toolchain,
  type ToolchainInstallOptions,
  ToolInstallSettings,
  ToolTasks,
  type ToolTasksApi,
} from "./src/tool.ts";
export {
  cicd,
  type CiConcurrency,
  CiFile,
  type CiFileSpec,
  type CiJob,
  type CiPipeline,
  type CiProvider,
  type CiStep,
  type CiTriggers,
  type FanOutOptions,
  fanOutPipeline,
  generateCi,
} from "./src/ci.ts";
