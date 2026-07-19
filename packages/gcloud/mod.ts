/**
 * `@zuke/gcloud` — typed Google Cloud tooling for Zuke builds: the `gcloud`
 * (Google Cloud SDK) CLI wrapper, plus **GCS** and **Secret Manager** REST task
 * groups that share `gcloud`-based auth (no Google SDK dependency).
 *
 * ```ts
 * import { GcloudTasks, GcsTasks, SecretManagerTasks } from "jsr:@zuke/gcloud";
 *
 * await GcloudTasks.run((s) => s.containerImagesAddTag(src, dst)); // CLI
 * await GcsTasks.writeJson("bucket", "state.json", { slot: "sit-7" }); // REST
 * const pw = await SecretManagerTasks.access("db-password", { project }); // REST
 * ```
 *
 * The CLI wrapper builds a discrete argv array (never a shell string), and the
 * REST groups take an injectable `fetch`, so both are testable without network
 * or a real cluster.
 *
 * @module
 */

export * from "./src/gcloud.ts";
export {
  type AccessTokenProvider,
  gcloudAccessToken,
  type GcloudRunner,
  resolveAccessToken,
} from "./src/auth.ts";
export {
  type GcsListOptions,
  type GcsOptions,
  GcsTasks,
  type GcsTasksApi,
} from "./src/gcs.ts";
export {
  type SecretManagerAccessOptions,
  type SecretManagerOptions,
  SecretManagerTasks,
  type SecretManagerTasksApi,
} from "./src/secret_manager.ts";
export { type GcpRestOptions } from "./src/rest.ts";
