/**
 * `@zuke/gcloud` — a typed `gcloud` (Google Cloud SDK) task wrapper for Zuke
 * builds.
 *
 * A flexible command builder: name the command with `.command(...)`, set common
 * global flags fluently, and pass anything else with `.flag(...)`.
 *
 * ```ts
 * import { GcloudTasks } from "jsr:@zuke/gcloud";
 * await GcloudTasks.run((s) => s.command("auth", "list").format("json"));
 * ```
 *
 * @module
 */

export * from "./src/gcloud.ts";
